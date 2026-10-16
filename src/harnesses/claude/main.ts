// Claude Code's `statusLine` command: the session JSON arrives on stdin, the rows leave on
// stdout. With `--subagents` it is the `subagentStatusLine` command instead (see subagents.ts).
// `--refresh git <cwd>` and `--refresh usage` are internal: the detached helpers that refresh the
// cache after a render has drawn stale data, so no render ever waits on git or the network.
//
// This file is the only place that touches the process; `runClaude` takes its collaborators as
// `ClaudeDeps`, which is the seam the tests use to run the whole flow in-process.

import { colorDepth, type Config, resolveConfig } from "../../application/config.ts";
import type { AppearancePort, CachePort, ClockPort, GitPort, GitReading, PrPort, UsagePort } from "../../application/ports.ts";
import { cacheFreshness, refreshEntry } from "../../application/refresh.ts";
import { renderStatusline } from "../../application/render-statusline.ts";
import { dayKey } from "../../application/stats/aggregate.ts";
import type { EnvChips, LimitWindow, PrState } from "../../domain/model/snapshot.ts";
import type { ThemeName } from "../../domain/render/cells.ts";
import { AppearanceAdapter } from "../../infrastructure/appearance.ts";
import { defaultCacheDir, FileCache } from "../../infrastructure/cache.ts";
import { defaultConfigPath, readConfigFile } from "../../infrastructure/config-file.ts";
import { buildEnvChips, EnvAdapter, K8S_TTL_MS, TMUX_TTL_MS, tmuxTarget } from "../../infrastructure/env-chips.ts";
import { findGitRoot, GitAdapter } from "../../infrastructure/git.ts";
import { PrAdapter } from "../../infrastructure/pr.ts";
import { ClaudeUsageAdapter } from "../../infrastructure/usage.ts";
import { asObject, type Json, sessionCwd, toClaudeSnapshot, wholeNumber } from "./snapshot.ts";
import { subagentRows } from "./subagents.ts";

const GIT_TTL_MS = 5_000;
const USAGE_TTL_MS = 120_000;
const USAGE_KEY = "claude-usage";
const PR_TTL_MS = 300_000;
const TODAY_COST_TTL_MS = 120_000;
const DEFAULT_COLUMNS = 120;
/** Claude Code's rows end this far before the terminal's right edge. */
const RIGHT_MARGIN = 4;

const HINT = "oh-my-statusline: expected the Claude Code session JSON on stdin; use this as the statusLine command";

export interface ClaudeDeps {
	env: Record<string, string | undefined>;
	/** The process's working directory, used when the session names none. */
	cwd: string;
	clock: ClockPort;
	cache: CachePort;
	git: GitPort;
	usage: UsagePort;
	appearance: AppearancePort;
	/** The parsed config file (see readConfigFile); null when there is none. */
	configFile: { raw: unknown } | { error: string } | null;
	measure: (text: string) => number;
	/** Start `main.ts --refresh <args>` as a detached process that outlives this one. */
	refreshInBackground: (args: string[]) => void;
	/** Environment chip source (hostname, tmux, kubectl); without it the chips are off. */
	chips?: EnvAdapter;
	/** gh/glab pull request, for sessions whose JSON names none. */
	pr?: PrPort;
	/** Today's cost across all harnesses (reads session files; only ever called by the refresh helper). */
	todayCost?: () => number | null | Promise<number | null>;
}

const gitKey = (cwd: string) => `claude-git:${cwd}`;

/** A cached usage window is untrusted JSON: keep only entries a gauge can draw. */
function isUsageWindow(value: unknown): value is LimitWindow {
	const window = asObject(value);
	return typeof window.label === "string" && window.label !== "" && typeof window.usedPct === "number" && Number.isFinite(window.usedPct);
}

/** Cached model-scoped windows at any age; a stale or missing entry starts a background refresh. */
function loadScopedLimits(deps: ClaudeDeps): LimitWindow[] {
	const entry = deps.cache.read<unknown>(USAGE_KEY);
	if (cacheFreshness(entry, USAGE_TTL_MS, deps.clock.now()) !== "fresh") deps.refreshInBackground(["usage"]);
	return Array.isArray(entry?.value) ? entry.value.filter(isUsageWindow) : [];
}

/**
 * Stale-first: a fresh entry is used as is, a stale one is drawn now and refreshed in the
 * background, and only a missing one (the first render in a directory) waits for git.
 */
async function loadGit(cwd: string, deps: ClaudeDeps): Promise<GitReading | null> {
	const key = gitKey(cwd);
	const entry = deps.cache.read<GitReading>(key);
	if (entry) {
		if (cacheFreshness(entry, GIT_TTL_MS, deps.clock.now()) === "stale") deps.refreshInBackground(["git", cwd]);
		return entry.value;
	}
	await refreshEntry(deps.cache, key, () => deps.git.read(cwd));
	return deps.cache.read<GitReading>(key)?.value ?? null;
}

/** What a cached value refreshes from. A cached value is boxed so a settled "nothing" is cached too. */
interface Source {
	key: string;
	ttlMs: number;
	fetch: () => Promise<unknown>;
}

interface Boxed<T> {
	v: T | null;
}

const sources = {
	tmux(deps: ClaudeDeps): Source | null {
		const target = tmuxTarget(deps.env);
		const chips = deps.chips;
		if (!target || !chips) return null;
		return { key: `claude-tmux:${target.socket}:${target.target}`, ttlMs: TMUX_TTL_MS, fetch: () => chips.tmux(target) };
	},
	k8s(deps: ClaudeDeps): Source | null {
		const chips = deps.chips;
		return chips ? { key: "claude-k8s", ttlMs: K8S_TTL_MS, fetch: () => chips.k8s() } : null;
	},
	pr(deps: ClaudeDeps, cwd: string, branch: string): Source | null {
		const pr = deps.pr;
		return pr ? { key: `claude-pr:${cwd}:${branch}`, ttlMs: PR_TTL_MS, fetch: () => pr.read(cwd) } : null;
	},
	today(deps: ClaudeDeps): Source | null {
		const cost = deps.todayCost;
		if (!cost) return null;
		return { key: `claude-today:${dayKey(deps.clock.now(), deps.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone)}`, ttlMs: TODAY_COST_TTL_MS, fetch: async () => cost() };
	},
};

/**
 * Stale-first read of a boxed cache entry: any age is drawn, a stale or missing one starts a
 * background refresh, and only `wait` (cheap sources) fetches inline on a miss.
 */
async function cached<T>(deps: ClaudeDeps, source: Source | null, refreshArgs: string[], wait: boolean): Promise<T | null> {
	if (!source) return null;
	const entry = deps.cache.read<Boxed<T>>(source.key);
	if (entry) {
		if (cacheFreshness(entry, source.ttlMs, deps.clock.now()) !== "fresh") deps.refreshInBackground(refreshArgs);
		return entry.value?.v ?? null;
	}
	if (!wait) {
		deps.refreshInBackground(refreshArgs);
		return null;
	}
	await refreshEntry(deps.cache, source.key, async () => ({ v: await source.fetch() }));
	return deps.cache.read<Boxed<T>>(source.key)?.value?.v ?? null;
}

async function refreshSource(source: Source | null, deps: ClaudeDeps): Promise<void> {
	if (source && cacheFreshness(deps.cache.read(source.key), source.ttlMs, deps.clock.now()) !== "fresh") {
		await refreshEntry(deps.cache, source.key, async () => ({ v: await source.fetch() }));
	}
}

/** Everything the chips beyond the session JSON need, each switched by the resolved config. */
async function ambient(deps: ClaudeDeps, config: Config, cwd: string, branch: string | undefined, hasPr: boolean) {
	let env: EnvChips | null = null;
	if (deps.chips) {
		const wantsTmux = config.chips.tmux;
		const tmux = wantsTmux ? await cached<string>(deps, sources.tmux(deps), ["tmux"], true) : null;
		const k8s = config.chips.k8s && deps.chips.hasKubectl() ? await cached<string>(deps, sources.k8s(deps), ["k8s"], false) : null;
		env = buildEnvChips(config.chips, deps.env, deps.chips, { tmux, k8s });
	}
	const pr = config.pr.enabled && !hasPr && branch ? await cached<PrState>(deps, sources.pr(deps, cwd, branch), ["pr", cwd, branch], false) : null;
	const todayCostUsd = config.stats.chip ? await cached<number>(deps, sources.today(deps), ["stats"], false) : null;
	return { env, pr, todayCostUsd };
}

async function presentation(deps: ClaudeDeps) {
	const { config } = resolveConfig({ harness: "claude", file: deps.configFile, env: deps.env, flags: {} });
	const theme: ThemeName = config.theme === "auto" ? await deps.appearance.theme() : config.theme;
	return { config, theme };
}

function parseJson(stdin: string): unknown {
	try {
		return JSON.parse(stdin);
	} catch {
		return null;
	}
}

/** The background half of stale-first caching: refresh one cache entry, keeping the old one on failure. */
async function refresh([kind, cwd, branch]: string[], deps: ClaudeDeps): Promise<void> {
	const nowMs = deps.clock.now();
	if (kind === "tmux") return refreshSource(sources.tmux(deps), deps);
	if (kind === "k8s") return refreshSource(sources.k8s(deps), deps);
	if (kind === "stats") return refreshSource(sources.today(deps), deps);
	if (kind === "pr" && cwd && branch) return refreshSource(sources.pr(deps, cwd, branch), deps);
	if (kind === "git" && cwd) {
		const key = gitKey(cwd);
		if (cacheFreshness(deps.cache.read(key), GIT_TTL_MS, nowMs) !== "fresh") await refreshEntry(deps.cache, key, () => deps.git.read(cwd));
	} else if (kind === "usage" && cacheFreshness(deps.cache.read(USAGE_KEY), USAGE_TTL_MS, nowMs) !== "fresh") {
		await refreshEntry(deps.cache, USAGE_KEY, () => deps.usage.read());
	}
}

/** What the command prints for `args` and the stdin text. */
export async function runClaude(args: string[], stdin: string, deps: ClaudeDeps): Promise<string> {
	if (args[0] === "--refresh") {
		await refresh(args.slice(1), deps);
		return "";
	}
	const input = parseJson(stdin);
	const nowMs = deps.clock.now();
	const { config, theme } = await presentation(deps);

	if (args[0] === "--subagents") {
		if (!config.subagents) return "";
		return subagentRows(input, { nowMs, theme, glyphs: config.glyphs, colors: colorDepth(config, deps.env), measure: deps.measure });
	}

	if (input === null || typeof input !== "object" || Array.isArray(input)) return HINT;
	const session = input as Json;
	const cwd = sessionCwd(session, deps.cwd);
	const git = await loadGit(cwd, deps);
	const extra = await ambient(deps, config, cwd, git?.state.branch, wholeNumber(asObject(session.pr).number) > 0);
	const snapshot = toClaudeSnapshot(session, {
		nowMs,
		cwd,
		roots: findGitRoot(cwd),
		git,
		scopedLimits: loadScopedLimits(deps),
		...extra,
	});
	const columns = /^\d+$/.test(deps.env.COLUMNS ?? "") ? Number(deps.env.COLUMNS) : DEFAULT_COLUMNS;
	return renderStatusline(snapshot, {
		config,
		width: columns - RIGHT_MARGIN,
		nowMs,
		appearance: theme,
		env: deps.env,
		measure: deps.measure,
	}).join("\n");
}

function spawnRefresh(args: string[]): void {
	try {
		// Detached (setsid) with ignored stdio, so the helper outlives this render and nothing keeps it waiting.
		Bun.spawn([process.execPath, import.meta.path, "--refresh", ...args], { stdio: ["ignore", "ignore", "ignore"], detached: true }).unref();
	} catch {}
}

export function defaultDeps(env: Record<string, string | undefined>, cwd: string): ClaudeDeps {
	const clock: ClockPort = { now: () => Date.now() };
	const cache = new FileCache(defaultCacheDir(env), clock);
	return {
		env,
		cwd,
		clock,
		cache,
		git: new GitAdapter(),
		usage: new ClaudeUsageAdapter({ clock, configDir: env.CLAUDE_CONFIG_DIR }),
		appearance: new AppearanceAdapter(cache, clock),
		configFile: readConfigFile(defaultConfigPath(env)),
		measure: (text) => Bun.stringWidth(text),
		refreshInBackground: spawnRefresh,
		chips: new EnvAdapter(),
		pr: new PrAdapter(),
		// Loaded on demand: the collector (bun:sqlite, every parser) is only needed by the refresh helper.
		todayCost: async () => (await import("../../infrastructure/stats/today.ts")).readTodayCost({ env, nowMs: Date.now() }),
	};
}

if (import.meta.main) {
	const args = process.argv.slice(2);
	let stdin = "";
	if (args[0] !== "--refresh" && !process.stdin.isTTY) {
		try {
			stdin = await Bun.stdin.text();
		} catch {}
	}
	let out: string;
	try {
		out = await runClaude(args, stdin, defaultDeps(process.env, process.cwd()));
	} catch (error) {
		// The host must never see a failure: say what went wrong in place of the rows.
		out = args[0] === "--subagents" || args[0] === "--refresh" ? "" : `oh-my-statusline: ${(error as Error).message}`;
	}
	process.stdout.write(out);
}
