// The collector: every 2 s it asks tmux for the pane's title, width and directory, finds the
// Codex thread the title names, reads what the session has written since last time, renders the
// two status rows, and hands them to tmux through two files.

import { Database } from "bun:sqlite";
import { readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { resolveConfig } from "../../application/config.ts";
import { renderStatusline } from "../../application/render-statusline.ts";
import { Ambient } from "../../infrastructure/ambient.ts";
import { AppearanceAdapter } from "../../infrastructure/appearance.ts";
import { FileCache } from "../../infrastructure/cache.ts";
import { defaultConfigPath, readConfigFile } from "../../infrastructure/config-file.ts";
import { EnvAdapter, tmuxTarget } from "../../infrastructure/env-chips.ts";
import { findGitRoot, parseNumstat, parsePorcelain } from "../../infrastructure/git.ts";
import { PrAdapter } from "../../infrastructure/pr.ts";
import { run as exec } from "../../infrastructure/process.ts";
import { readTodayCost } from "../../infrastructure/stats/today.ts";
import type { GitState } from "../../domain/model/snapshot.ts";
import { readManifest, ROOT } from "./manifest.ts";
import { snapshotFor, threadIdFromTitle } from "./payload.ts";
import { RolloutReader, type RolloutState } from "./rollout.ts";
import { ansiToTmux, runTmux } from "./tmux.ts";

const LOOP_MS = 2000;
const STATUS_TTL_MS = 5000;
const NUMSTAT_TTL_MS = 10_000;
const STATE_DB = /^state_.*\.sqlite$/;

export interface ThreadRow {
	id: string;
	rollout_path: string;
	cwd: string;
	model: string;
	reasoning_effort: string;
}

/**
 * The thread whose id starts with `prefix`, searched in the newest `state_*.sqlite` first. A
 * prefix that matches several threads (or none) selects nothing: a wrong guess would show another
 * session's numbers.
 */
export function findThread(codexHome: string, prefix: string): ThreadRow | null {
	let files: string[];
	try {
		files = readdirSync(codexHome).filter((name) => STATE_DB.test(name));
	} catch {
		return null;
	}
	for (const file of files.sort().reverse()) {
		let db: Database | undefined;
		try {
			db = new Database(path.join(codexHome, file), { readonly: true });
			db.exec("PRAGMA busy_timeout = 200");
			const rows = db
				.query<ThreadRow, [number, string]>("SELECT id, rollout_path, cwd, model, reasoning_effort FROM threads WHERE substr(id, 1, ?) = ? LIMIT 2")
				.all(prefix.length, prefix);
			if (rows.length === 1 && rows[0]) return rows[0];
		} catch {
			// A locked or unreadable database is skipped; the next tick retries.
		} finally {
			db?.close();
		}
	}
	return null;
}

/** What Codex will show before the first rollout record: config.toml plus the launch arguments. */
export function initialState(codexHome: string, args: string[]): RolloutState {
	const state: RolloutState = {};
	try {
		const config = Bun.TOML.parse(readFileSync(path.join(codexHome, "config.toml"), "utf8")) as Record<string, unknown>;
		state.model = config.model;
		state.effort = config.model_reasoning_effort;
	} catch {}
	for (let i = 0; i < args.length - 1; i++) {
		const [arg, value = ""] = [args[i], args[i + 1]];
		if (arg === "-m" || arg === "--model") state.model = value;
		if (arg === "-C" || arg === "--cd") state.cwd = path.resolve(value.replace(/^~(?=$|\/)/, homedir()));
		if (arg === "-c" || arg === "--config") {
			try {
				const override = Bun.TOML.parse(value) as Record<string, unknown>;
				if ("model" in override) state.model = override.model;
				if ("model_reasoning_effort" in override) state.effort = override.model_reasoning_effort;
			} catch {}
		}
	}
	return state;
}

/** Staged and unstaged line totals against HEAD; 0/0 when git fails. */
export async function workingChanges(cwd: string): Promise<{ added: number; removed: number }> {
	const out = await exec(["git", "-C", cwd, "--no-optional-locks", "diff", "--numstat", "HEAD", "--"], { timeoutMs: 2000 });
	return out === null ? { added: 0, removed: 0 } : parseNumstat(out);
}

/** The loop; returns when the tmux server is gone. */
export async function collect(runDir: string, env: Record<string, string | undefined> = process.env): Promise<void> {
	const spec = JSON.parse(readFileSync(path.join(runDir, "launch.json"), "utf8")) as {
		args: string[];
		tmux: string;
		outerTmux?: string | null;
		outerPane?: string | null;
		outerLabel?: string | null;
	};
	const socket = path.join(runDir, "tmux.sock");
	const codexHome = env.CODEX_HOME || path.join(env.HOME || homedir(), ".codex");
	const clock = { now: () => Date.now() };
	const appearance = new AppearanceAdapter(new FileCache(path.join(runDir, "cache"), clock), clock);
	// The installer's glyph choice and tmux's 24-bit colors are defaults; the config file, the
	// environment (STATUSLINE_*, NO_COLOR) and flags stay above them.
	const installed = readManifest(ROOT);
	const { config } = resolveConfig({
		harness: "codex",
		installed: { colors: "truecolor", ...(installed.glyphs === "plain" ? { glyphs: "plain" as const } : {}) },
		file: readConfigFile(defaultConfigPath(env)),
		env,
		flags: {},
	});

	// The tmux chip describes the user's OUTER tmux, recorded at launch, never Codex's private server.
	const ambient = new Ambient({
		clock,
		config,
		env,
		adapter: new EnvAdapter(),
		tmux: tmuxTarget({ TMUX: spec.outerTmux ?? undefined, TMUX_PANE: spec.outerPane ?? undefined }),
		initialTmux: spec.outerLabel ?? null,
		pr: new PrAdapter(),
		todayCost: async () => readTodayCost({ env, nowMs: clock.now() }),
	});

	const fallback = initialState(codexHome, spec.args);
	const startedMs = clock.now();
	let active: string | null = null;
	let reader: RolloutReader | null = null;
	let status: { cwd: string; at: number; state: GitState | null } | null = null;
	let numstat: { cwd: string; at: number; added: number; removed: number } | null = null;

	for (;;) {
		const pane = await runTmux(spec.tmux, socket, ["display-message", "-p", "-t", "codex:0.0", "#{pane_title}\t#{pane_width}\t#{pane_current_path}"]);
		if (pane.code !== 0) return;
		try {
			const [title = "", width = "", paneCwd = ""] = pane.stdout.replace(/\r?\n$/, "").split("\t");
			const prefix = threadIdFromTitle(title);
			if (prefix !== active) [active, reader] = [prefix, null];
			const thread = prefix ? findThread(codexHome, prefix) : null;
			if (thread && reader === null && (await Bun.file(thread.rollout_path).exists())) reader = new RolloutReader(thread.rollout_path);
			const state: RolloutState = { ...fallback };
			if (thread) Object.assign(state, { model: thread.model, effort: thread.reasoning_effort, cwd: thread.cwd });
			if (reader) Object.assign(state, reader.read());

			const cwd = typeof state.cwd === "string" && state.cwd ? state.cwd : paneCwd;
			const now = clock.now();
			if (!numstat || numstat.cwd !== cwd || now - numstat.at >= NUMSTAT_TTL_MS) numstat = { cwd, at: now, ...(await workingChanges(cwd)) };
			if (!status || status.cwd !== cwd || now - status.at >= STATUS_TTL_MS) {
				const raw = await exec(["git", "-C", cwd, "--no-optional-locks", "status", "--porcelain=v2", "--branch"], { timeoutMs: 2000 });
				status = { cwd, at: now, state: raw === null ? null : parsePorcelain(raw) };
			}
			const root = findGitRoot(cwd);
			ambient.poll(() => {}, root && status.state?.branch ? { cwd, key: `${root.top}\0${status.state.branch}` } : undefined);
			const extra = ambient.read();
			const snapshot = snapshotFor(state, {
				cwd: paneCwd,
				startedMs,
				nowMs: now,
				linesAdded: numstat.added,
				linesRemoved: numstat.removed,
				git: root && status.state ? { ...root, state: status.state } : null,
				pr: extra.pr,
				env: extra.env,
				todayCostUsd: extra.todayCostUsd,
			});
			const theme = config.theme === "auto" ? await appearance.theme() : config.theme;
			// Both rows keep a 4-cell margin: the pane's right edge is never painted.
			const rows = renderStatusline(snapshot, { config, width: (Number.parseInt(width, 10) || 120) - 4, nowMs: now, appearance: theme, env, measure: Bun.stringWidth });
			for (const index of [0, 1]) {
				const tmp = path.join(runDir, `row${index}.tmp`);
				writeFileSync(tmp, ansiToTmux(rows[index] ?? ""));
				renameSync(tmp, path.join(runDir, `row${index}`));
			}
			await runTmux(spec.tmux, socket, ["refresh-client", "-S"]);
		} catch (error) {
			try {
				writeFileSync(path.join(runDir, "error.log"), `${(error as Error).name}: ${(error as Error).message.slice(0, 300)}`);
			} catch {}
		}
		await Bun.sleep(LOOP_MS);
	}
}
