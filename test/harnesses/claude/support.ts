// Shared builders for the Claude adapter tests: the session payload of the original
// claude-code-statusline suite (`full`), fake ports, and an in-process run of main's logic.

import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AppearancePort, GitPort, GitReading, UsagePort } from "../../../src/application/ports.ts";
import type { LimitWindow } from "../../../src/domain/model/snapshot.ts";
import type { ThemeName } from "../../../src/domain/render/cells.ts";
import { FileCache } from "../../../src/infrastructure/cache.ts";
import { parsePorcelain } from "../../../src/infrastructure/git.ts";
import { type ClaudeDeps, runClaude } from "../../../src/harnesses/claude/main.ts";

export const NOW_MS = 1_790_000_000_000;
export const NOW_S = NOW_MS / 1000;

export const DELETE = Symbol("delete");

const temps: string[] = [];

/** A temp directory removed by cleanTemps(); call that in afterEach. */
export function tmp(name = "x"): string {
	const root = mkdtempSync(path.join(tmpdir(), "oms-claude-"));
	temps.push(root);
	return path.join(root, name);
}

export function cleanTemps(): void {
	for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
}

// Tokyo Night palette as SGR "R;G;B" triples.
export const COLORS = {
	purple: "187;154;247",
	blue: "122;162;247",
	teal: "115;218;202",
	green: "158;206;106",
	yellow: "224;175;104",
	orange: "255;158;100",
	red: "247;118;142",
	dim: "115;122;162",
	faint: "84;92;126",
	lightDim: "104;112;154",
	lightGreen: "88;117;57",
};
export const ARROW = "\ue0b0";
export const THIN = "\ue0b1";
export const BRANCH = "\ue0a0";

export const GIT_CLEAN = "# branch.oid ca8cb99\n# branch.head main\n# branch.upstream origin/main\n# branch.ab +0 -0\n";
export const GIT_DIRTY =
	"# branch.oid ca8cb99\n# branch.head main\n# branch.upstream origin/main\n# branch.ab +1 -0\n" +
	"1 M. N... 100644 100644 100644 a b staged.txt\n" +
	"1 .M N... 100644 100644 100644 a b mod1.txt\n" +
	"1 .M N... 100644 100644 100644 a b mod2.txt\n" +
	"? new.txt\n";
export const GIT_CONFLICT = `${GIT_CLEAN}u UU N... 100644 100644 100644 100644 a b c conflict.txt\n`;
export const GIT_DETACHED = "# branch.oid ca8cb9954662e18d96c1e10ff130d4249a0c8b6e\n# branch.head (detached)\n";
export const GIT_BRANCH = "# branch.oid ca8cb99\n# branch.head octocat/issue-9\n";

export const PR_URL = "https://github.com/octocat/my-app/pull/512";

type Json = Record<string, unknown>;

/** The session payload of the original suite; `over` sets dotted paths (DELETE removes one). */
export function session(cwd: string, over: Record<string, unknown> = {}): Json {
	const data: Json = {
		cwd,
		session_id: "t",
		model: { id: "claude-opus-5-5[1m]", display_name: "Opus 5.5 (1M context)" },
		workspace: { current_dir: cwd, project_dir: cwd, added_dirs: [], repo: { host: "github.com", owner: "octocat", name: "my-app" } },
		version: "2.1.280",
		output_style: { name: "default" },
		cost: { total_cost_usd: 4.2137, total_duration_ms: 1_380_000, total_api_duration_ms: 420_000, total_lines_added: 156, total_lines_removed: 23 },
		context_window: { total_input_tokens: 283_000, total_output_tokens: 1200, context_window_size: 1_000_000, used_percentage: 28.3, remaining_percentage: 71.7 },
		exceeds_200k_tokens: true,
		prompt_cache: { warm: true, caching_observed: true, ttl: "1h", expires_at: NOW_S + 42 * 60 + 30 },
		fast_mode: false,
		effort: { level: "max" },
		thinking: { enabled: true },
		rate_limits: {
			five_hour: { used_percentage: 41, resets_at: NOW_S + 72 * 60 + 30 },
			seven_day: { used_percentage: 18, resets_at: NOW_S + 3 * 86400 + 5 * 3600 + 1800 },
		},
		pr: { number: 512, url: PR_URL, review_state: "approved" },
	};
	for (const [dotted, value] of Object.entries(over)) {
		const keys = dotted.split(".");
		let node = data;
		for (const key of keys.slice(0, -1)) node = (node[key] ??= {}) as Json;
		if (value === DELETE) delete node[keys.at(-1)!];
		else node[keys.at(-1)!] = value;
	}
	return data;
}

/** One repository reading from `git status --porcelain=v2 --branch` text and the working-tree diff totals. */
export function gitReading(porcelain: string, lines: [number, number] = [0, 0]): GitReading | null {
	const state = parsePorcelain(porcelain);
	return state ? { top: "/repo", main: "/repo", state, linesAdded: lines[0], linesRemoved: lines[1] } : null;
}

export class FakeGit implements GitPort {
	readonly calls: string[] = [];
	constructor(public reading: GitReading | null) {}
	async read(cwd: string): Promise<GitReading | null> {
		this.calls.push(cwd);
		return this.reading;
	}
}

export class FakeUsage implements UsagePort {
	reads = 0;
	constructor(public windows: LimitWindow[] | null = null) {}
	async read(): Promise<LimitWindow[] | null> {
		this.reads++;
		return this.windows;
	}
}

export class FakeAppearance implements AppearancePort {
	reads = 0;
	constructor(public value: ThemeName = "dark") {}
	async theme(): Promise<ThemeName> {
		this.reads++;
		return this.value;
	}
}

export const FABLE: LimitWindow = { label: "Fable", usedPct: 25, resetsAtMs: NOW_MS + 280_000_000, windowMs: 604_800_000, scopedModel: "Fable" };

export interface Harness {
	deps: ClaudeDeps;
	git: FakeGit;
	usage: FakeUsage;
	appearance: FakeAppearance;
	cache: FileCache;
	cacheDir: string;
	/** Arguments of every detached refresh a render asked for. */
	spawned: string[][];
	clock: { ms: number; now(): number };
}

/** Deps with fake ports and a real FileCache in a temp directory. Env defaults: dark, truecolor, 200 columns. */
export function harness(over: { env?: Record<string, string | undefined>; git?: string | null; lines?: [number, number]; cwd?: string } = {}): Harness {
	const clock = { ms: NOW_MS, now: () => clock.ms };
	const cacheDir = tmp("cache");
	const cache = new FileCache(cacheDir, clock);
	const git = new FakeGit(over.git === null ? null : gitReading(over.git ?? GIT_CLEAN, over.lines));
	const usage = new FakeUsage();
	const appearance = new FakeAppearance();
	const spawned: string[][] = [];
	const deps: ClaudeDeps = {
		env: { COLUMNS: "200", STATUSLINE_THEME: "dark", COLORTERM: "truecolor", ...over.env },
		cwd: over.cwd ?? "/tmp",
		clock,
		cache,
		git,
		usage,
		appearance,
		configFile: null,
		measure: (text) => Bun.stringWidth(text),
		refreshInBackground: (args) => spawned.push(args),
	};
	return { deps, git, usage, appearance, cache, cacheDir, spawned, clock };
}

/** Store a cache entry as if it had been written `ageMs` before the harness clock. */
export function writeAged(h: Harness, key: string, value: unknown, ageMs: number): void {
	new FileCache(h.cacheDir, { now: () => NOW_MS - ageMs }).write(key, value);
}

/** Run the statusLine command in-process and split the output into rows. */
export async function render(h: Harness, input: unknown, args: string[] = []): Promise<{ out: string; rows: string[] }> {
	const out = await runClaude(args, typeof input === "string" ? input : JSON.stringify(input), h.deps);
	return { out, rows: out === "" ? [] : out.split("\n") };
}

export const strip = (s: string) => s.replace(/\x1b\][^\x07]*\x07/g, "").replace(/\x1b\[[0-9;]*m/g, "");

/** The SGR escapes right before the first `text` (the style that text is drawn in). */
export function colorBefore(raw: string, text: string): string {
	const at = raw.indexOf(text);
	return at < 0 ? "" : (raw.slice(0, at).match(/(?:\x1b\[[0-9;]*m)+/g)?.at(-1) ?? "");
}

/** Run git in `cwd` with a fixed identity and no user config; throws on failure. */
export function git(cwd: string, ...args: string[]): string {
	const p = Bun.spawnSync(["git", "-C", cwd, "-c", "user.name=t", "-c", "user.email=t@t", ...args], {
		env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
	});
	if (p.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${p.stderr.toString()}`);
	return p.stdout.toString();
}

/** A real, empty git repository named `name` on branch main. */
export function makeRepo(name = "my-app"): string {
	const repo = tmp(name);
	mkdirSync(repo, { recursive: true });
	git(repo, "init", "-q", "-b", "main");
	return repo;
}

/**
 * A minimal environment for spawned runs: temp HOME, cache and config directories, and a PATH that
 * holds only git, so nothing can reach the real keychain, credentials or network.
 */
export function isolatedEnv(extra: Record<string, string> = {}): Record<string, string> {
	const root = path.dirname(tmp("env"));
	const bin = path.join(root, "bin");
	mkdirSync(bin);
	symlinkSync(Bun.which("git") ?? "/usr/bin/git", path.join(bin, "git"));
	return {
		HOME: path.join(root, "home"),
		XDG_CACHE_HOME: path.join(root, "cache"),
		XDG_CONFIG_HOME: path.join(root, "config"),
		PATH: bin,
		COLUMNS: "120",
		STATUSLINE_THEME: "dark",
		COLORTERM: "truecolor",
		...extra,
	};
}

/** Run a command to completion with `stdin` and exactly `env`. */
export async function spawnText(cmd: string[], stdin: string, env: Record<string, string>): Promise<{ code: number; out: string; err: string }> {
	const proc = Bun.spawn(cmd, { stdin: new Blob([stdin]), stdout: "pipe", stderr: "pipe", env });
	const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
	return { code, out, err };
}

/**
 * Store a fresh, empty usage entry in the isolated cache so a render does not start the detached
 * usage refresher, which would otherwise outlive the test and recreate its deleted directories.
 */
export function seedUsage(env: Record<string, string>): void {
	new FileCache(path.join(env.XDG_CACHE_HOME!, "oh-my-statusline"), { now: () => Date.now() }).write("claude-usage", []);
}
