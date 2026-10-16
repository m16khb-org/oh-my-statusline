// oh-my-statusline for omp (oh-my-pi): a two-row powerline status line drawn below the prompt.
//
// omp loads this module as an extension (through the entry shim `install.ts` writes). It collects
// the session state omp already knows (model, thinking level, service tier, context window, cost,
// prompt cache, and the provider usage reports behind /usage), adds git and PR state from
// background commands, and renders the snapshot with the shared renderer. omp's own status bar
// keeps only what this one does not show (vim, plan/goal/loop mode, collab, stream, session name);
// set OMP_STATUSLINE_NATIVE=keep to leave it untouched.
//
// Settings (environment variables of the omp process, or config.toml):
//   STATUSLINE_THEME=dark|light       default: the light/dark appearance of omp's active theme
//   STATUSLINE_GLYPHS=powerline|plain default: config.json next to the install (install --plain),
//                                     else powerline
//   STATUSLINE_COLORS=truecolor|256   default: truecolor when COLORTERM says so, else 256
//   OMP_STATUSLINE_NATIVE=keep        keep omp's built-in status bar segments as configured
//
// Preview without omp: `bun src/harnesses/omp/main.ts --demo`.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { type Config, resolveConfig } from "../../application/config.ts";
import { Poller } from "../../application/poller.ts";
import type { ClockPort, GitReading } from "../../application/ports.ts";
import { renderStatusline } from "../../application/render-statusline.ts";
import type { PrState, StatusSnapshot } from "../../domain/model/snapshot.ts";
import { toDirInfo } from "../../domain/model/dir.ts";
import { toSnapshot } from "../../domain/model/snapshot.ts";
import { demoCases } from "../../domain/render/demo.ts";
import { Ambient } from "../../infrastructure/ambient.ts";
import { EnvAdapter } from "../../infrastructure/env-chips.ts";
import { defaultConfigPath, readConfigFile } from "../../infrastructure/config-file.ts";
import { GitAdapter } from "../../infrastructure/git.ts";
import { PrAdapter } from "../../infrastructure/pr.ts";
import { type CommandRunner, run } from "../../infrastructure/process.ts";
import { findBun, todayCostViaProcess } from "../../infrastructure/stats/today-process.ts";
import { nextPromptCache, type PromptCache, promptCacheState } from "./cache.ts";
import type {
	AssistantMessage,
	ContextUsage,
	HostModules,
	OmpApi,
	OmpContext,
	OmpModel,
	OmpTui,
	UsageReport,
} from "./host.ts";
import { usageWindows } from "./usage.ts";

export type { HostModules, OmpApi, OmpContext, OmpModel, UsageReport } from "./host.ts";

const WIDGET_KEY = "oh-my-statusline";
/** The tick only catches what omp sends no event for (model, thinking level, service tier, clock). */
const TICK_MS = 1000;
// Background reads refetch on the events that change them (see the handlers below), at most every
// MIN_GAP, and otherwise only when older than MAX_AGE, for changes made outside omp.
const GIT_MAX_AGE_MS = 30_000;
const GIT_MIN_GAP_MS = 2000;
const PR_MAX_AGE_MS = 300_000;
const PR_MIN_GAP_MS = 15_000;
// omp's usage service refreshes its own cache every 5 minutes; asking more often only reads that cache.
const USAGE_MAX_AGE_MS = 300_000;
const USAGE_MIN_GAP_MS = 60_000;
const COMMAND_TIMEOUT_MS = 10_000;
/** Built-in status segments this status line does not replace. */
const NATIVE_LEFT = ["vim", "mode", "collab", "stream"];
const NATIVE_RIGHT = ["session_name"];

/** "Claude Opus 5.5" → "Opus 5.5"; a trailing "(…)" is dropped. */
export function modelLabel(model: OmpModel): string {
	return (model.name || model.id).replace(/\s*\([^)]*\)$/, "").replace(/^Claude\s+/, "");
}

async function loadHostModules(): Promise<HostModules> {
	// Runtime-only: omp resolves its own package specifiers for extensions, but these packages are
	// not installed next to this file, so a static import would stop it (and the tests) loading
	// outside omp. Each import that fails just disables the feature it backs.
	const host: HostModules = {};
	try {
		const registry = await import("@oh-my-pi/pi-coding-agent/config/registry");
		host.lookupSetting = registry.lookup;
	} catch {}
	try {
		const ai = await import("@oh-my-pi/pi-ai");
		host.serviceTierFamily = ai.serviceTierFamily;
	} catch {}
	try {
		// The same filter as omp's own running-subagents badge (pi-tui overlays/running-subagent-badge.ts).
		const { AgentRegistry } = await import("@oh-my-pi/pi-coding-agent/registry/agent-registry");
		host.runningSubagents = () => AgentRegistry.global().list().filter((ref) => ref.kind === "sub" && ref.status === "running").length;
	} catch {}
	return host;
}

/** Glyph mode saved by the installer's `--plain` in config.json at the install root. */
function installedGlyphs(): "plain" | "powerline" | undefined {
	try {
		const file = path.join(import.meta.dir, "..", "..", "..", "config.json");
		if (!existsSync(file)) return undefined;
		return JSON.parse(readFileSync(file, "utf8")).glyphs === "plain" ? "plain" : "powerline";
	} catch {
		return undefined;
	}
}

/** The shared configuration, with the installed glyph mode as the lowest layer. */
function loadConfig(env: Record<string, string | undefined>): Config {
	const glyphs = installedGlyphs();
	const base: Record<string, unknown> = glyphs ? { glyphs } : {};
	const toml = readConfigFile(defaultConfigPath(env));
	const raw = toml && "raw" in toml && typeof toml.raw === "object" && toml.raw !== null ? toml.raw : {};
	return resolveConfig({ harness: "omp", file: { raw: { ...base, ...raw } }, env, flags: {} }).config;
}

/** Settings scopes already overridden; subagent sessions rebind the factory in the same process. */
const overriddenScopes = new WeakSet<object>();

/**
 * Keep only the built-in status segments this status line does not show. The override lives in
 * omp's in-memory runtime settings layer: nothing is written to config.yml, and it ends with the
 * process.
 */
function overrideNativeStatusLine(pi: OmpApi, host: HostModules): void {
	const scope = pi.pi?.settings;
	if (Bun.env.OMP_STATUSLINE_NATIVE === "keep" || !host.lookupSetting || !scope || typeof scope !== "object") return;
	if (overriddenScopes.has(scope)) return;
	overriddenScopes.add(scope);
	const values: [string, unknown][] = [
		["statusLine.preset", "custom"],
		["statusLine.leftSegments", NATIVE_LEFT],
		["statusLine.rightSegments", NATIVE_RIGHT],
	];
	for (const [id, value] of values) {
		try {
			host.lookupSetting(id)?.override(scope, value);
		} catch {}
	}
}

const clock: ClockPort = { now: () => Date.now() };
const exec: CommandRunner = (cmd, opts) => run(cmd, { timeoutMs: COMMAND_TIMEOUT_MS, ...opts });

export default async function ompStatusline(pi: OmpApi, hostModules?: HostModules, runner: CommandRunner = exec): Promise<void> {
	const host = hostModules ?? (await loadHostModules());
	// Before the first session starts, so omp builds its status bar from the overridden settings.
	overrideNativeStatusLine(pi, host);
	const gitAdapter = new GitAdapter(exec);
	const prAdapter = new PrAdapter(exec);
	const git = new Poller<GitReading>(clock, GIT_MAX_AGE_MS, GIT_MIN_GAP_MS);
	const pr = new Poller<PrState>(clock, PR_MAX_AGE_MS, PR_MIN_GAP_MS);
	const usage = new Poller<UsageReport[]>(clock, USAGE_MAX_AGE_MS, USAGE_MIN_GAP_MS);
	const config = loadConfig(Bun.env);
	// Environment chips and today's cost; omp's pull request is read below, on its own events.
	const ambient = new Ambient({
		clock,
		config,
		env: Bun.env,
		// omp has no notify API in its host types and is a TUI: the kubectl warning is dropped, never written to stderr.
		adapter: new EnvAdapter({ exec: runner, warn: () => {} }),
		// Out of process: the stats collector reads files synchronously and must not block omp.
		todayCost: () => todayCostViaProcess(runner, findBun((bin) => Bun.which(bin), process.execPath)),
	});
	let ctx: OmpContext | undefined;
	let tui: OmpTui | undefined;
	let cache: PromptCache | undefined;
	/** The last response for a model, and the tier configured when it arrived (see `isFast`). */
	let lastTurn: { modelId: string; tier: string | undefined; fastDropped: boolean } | undefined;
	// Context usage can estimate tokens past the last response, so it is read only after the
	// conversation or the model changes, not on every tick.
	let contextUsage: ContextUsage | undefined;
	let contextKey: string | undefined;
	let snapshot: { data: StatusSnapshot; nowMs: number } | undefined;
	let rendered: { width: number; rows: string[] } | undefined;

	const isOAuth = (model: OmpModel | undefined): boolean => {
		try {
			return !!model && !!ctx?.modelRegistry?.isUsingOAuth?.(model);
		} catch {
			return false;
		}
	};

	/** The service tier configured for the model's provider family (`/fast` sets `priority`). */
	const configuredTier = (model: OmpModel | undefined): string | undefined => {
		try {
			const family = model ? host.serviceTierFamily?.(model) : undefined;
			return family ? pi.getServiceTiers?.()[family] : undefined;
		} catch {
			return undefined;
		}
	};

	/**
	 * Fast mode as omp applies it: a priority tier is configured, and Anthropic did not refuse it on
	 * the last response. After a refusal omp stops asking until /fast sets the tier again, which a
	 * change of the configured tier stands for here.
	 */
	const isFast = (model: OmpModel | undefined, tier: string | undefined): boolean => {
		if (lastTurn && lastTurn.tier !== tier) lastTurn = { ...lastTurn, tier, fastDropped: false };
		if (tier !== "priority" && tier !== "ultrafast") return false;
		return !(lastTurn?.fastDropped && lastTurn.modelId === model?.id);
	};

	const recordTurn = (message: AssistantMessage, c: OmpContext): void => {
		cache = nextPromptCache(cache, message, c.model, isOAuth(c.model), Bun.env, Date.now());
		const modelId = message.model ?? c.model?.id ?? "";
		const fastDropped = message.disabledFeatures?.includes("priority") ?? false;
		lastTurn = { modelId, tier: configuredTier(c.model), fastDropped };
	};

	const collect = (c: OmpContext): { data: StatusSnapshot; nowMs: number } => {
		const nowMs = Date.now();
		const model = c.model;
		const sessionId = c.sessionManager?.getSessionId?.();
		const key = `${sessionId}\0${model?.provider}/${model?.id}`;
		if (contextKey !== key) {
			contextUsage = c.getContextUsage?.();
			contextKey = key;
		}
		const reading = git.value;
		const level = pi.getThinkingLevel?.() ?? "";
		const started = Date.parse(c.sessionManager?.getHeader?.()?.timestamp ?? "");
		const identity = model ? c.modelRegistry?.authStorage?.oauth?.identity?.(model.provider, sessionId) : undefined;
		const cost = c.sessionManager?.getUsageStatistics?.().cost;
		// Null right after compaction: the window has no reading, so the gauge is left out.
		const hasContext = contextUsage && typeof contextUsage.percent === "number" && contextUsage.contextWindow > 0;

		const extra = ambient.read();
		const data = toSnapshot("omp", {
			model: { name: model ? modelLabel(model) : "", family: model?.id ?? "", isFast: isFast(model, configuredTier(model)) },
			effort: model?.reasoning === false || level === "off" || level === "inherit" ? "" : level,
			dir: toDirInfo({ cwd: c.cwd, top: reading?.top, main: reading?.main }),
			git: reading?.state ?? null,
			pr: config.pr.enabled ? (pr.value ?? null) : null,
			stats: {
				costUsd: typeof cost === "number" ? cost : null,
				durationMs: Number.isFinite(started) ? Math.max(0, nowMs - started) : 0,
				linesAdded: reading?.linesAdded ?? 0,
				linesRemoved: reading?.linesRemoved ?? 0,
			},
			cache: promptCacheState(cache, model, nowMs),
			context:
				hasContext && contextUsage
					? { usedPct: contextUsage.percent, tokens: contextUsage.tokens, windowSize: contextUsage.contextWindow }
					: null,
			limits: usageWindows(usage.value, model, identity),
			counts: config.subagents && host.runningSubagents ? { subagents: host.runningSubagents(), shells: 0 } : null,
			env: extra.env,
			todayCostUsd: extra.todayCostUsd,
		});
		return { data, nowMs };
	};

	const renderRows = (current: { data: StatusSnapshot; nowMs: number }, width: number): string[] =>
		renderStatusline(current.data, {
			config,
			width,
			nowMs: current.nowMs,
			appearance: pi.pi?.theme?.isLight ? "light" : "dark",
			env: Bun.env,
			measure: Bun.stringWidth,
		});

	/** Rebuild the snapshot and repaint only when the rows at the last drawn width change. */
	const refresh = (): void => {
		const c = ctx;
		if (!c) return;
		git.poll(c.cwd, async () => (await gitAdapter.read(c.cwd)) ?? undefined, refresh);
		const branch = git.value?.state.branch;
		ambient.poll(refresh);
		if (config.pr.enabled && git.value && branch) {
			pr.poll(`${git.value.top}\0${branch}`, async () => (await prAdapter.read(c.cwd)) ?? undefined, refresh);
		}
		const service = c.modelRegistry?.authStorage?.usage;
		if (service?.reports) {
			const options = { baseUrlResolver: (provider: string) => c.modelRegistry?.getProviderBaseUrl?.(provider) };
			usage.poll("usage", async () => (await service.reports?.(options)) ?? undefined, refresh);
		}
		snapshot = collect(c);
		if (rendered) {
			const rows = renderRows(snapshot, rendered.width);
			if (rows.length === rendered.rows.length && rows.every((row, i) => row === rendered?.rows[i])) return;
			rendered = { width: rendered.width, rows };
		}
		tui?.requestRender();
	};

	/** Re-read everything for a session that just started or changed branch. */
	const resync = (c: OmpContext): void => {
		ctx = c;
		contextKey = undefined;
		cache = undefined;
		lastTurn = undefined;
		for (const entry of c.sessionManager?.getBranch?.() ?? []) {
			if (entry.type === "message" && entry.message?.role === "assistant") recordTurn(entry.message, c);
		}
		git.invalidate();
		refresh();
	};

	pi.on("session_start", (_event, c) => {
		// Subagents share the factory; only the main interactive session owns the status line.
		if (!c.hasUI || c.mode !== "tui" || c.agent?.kind === "sub") return;
		c.ui.setWidget(
			WIDGET_KEY,
			(t: OmpTui) => {
				tui = t;
				// Same array while nothing changed, so omp can skip the repaint.
				return {
					render(width: number): readonly string[] {
						if (!snapshot) return [];
						if (rendered?.width === width) return rendered.rows;
						rendered = { width, rows: renderRows(snapshot, width) };
						return rendered.rows;
					},
					invalidate(): void {
						rendered = undefined;
					},
					dispose(): void {
						if (tui === t) tui = undefined;
					},
				};
			},
			{ placement: "belowEditor" },
		);
		resync(c);
		c.setInterval?.(refresh, TICK_MS);
	});

	for (const event of ["session_switch", "session_branch", "session_tree"]) {
		pi.on(event, (_event, c) => {
			if (ctx) resync(c);
		});
	}

	// Every finished message (user, assistant, tool result) changes the context in use.
	pi.on("message_end", (event: { message?: AssistantMessage }, c) => {
		if (!ctx) return;
		ctx = c;
		contextKey = undefined;
		if (event.message?.role === "assistant") recordTurn(event.message, c);
		refresh();
	});
	// A new request (turn_start) carries the in-flight context; compaction shrinks it.
	for (const event of ["turn_start", "session_compact", "auto_compaction_end"]) {
		pi.on(event, (_event, c) => {
			if (!ctx) return;
			ctx = c;
			contextKey = undefined;
			refresh();
		});
	}
	// Tools and shell commands can edit files, commit, or switch branches.
	for (const event of ["tool_execution_end", "user_bash"]) {
		pi.on(event, (_event, c) => {
			if (!ctx) return;
			ctx = c;
			git.invalidate();
			if (event === "user_bash") pr.invalidate();
			refresh();
		});
	}
	// A finished run may have pushed or opened a pull request, and has spent plan usage.
	pi.on("agent_end", (_event, c) => {
		if (!ctx) return;
		ctx = c;
		git.invalidate();
		pr.invalidate();
		usage.invalidate();
		refresh();
	});

	// omp's cache warmer replays the last request to keep the prompt cache alive; a successful
	// replay restarts the cache lifetime without producing a message.
	pi.on("after_provider_response", (event: { status?: number }, c) => {
		if (!ctx || !cache || !(typeof event.status === "number" && event.status < 300)) return;
		if (c.model && c.model.id !== cache.modelId) return;
		cache = { ...cache, at: Date.now() };
	});

	pi.on("session_shutdown", () => {
		ctx = undefined;
		tui = undefined;
		snapshot = undefined;
		rendered = undefined;
	});
}

/** Two demo rows for the omp case, rendered with the user's configuration. */
export function demoRows(env: Record<string, string | undefined>, columns: number): string[] {
	const nowMs = Date.now();
	const demo = demoCases(nowMs).find((c) => c.snapshot.harness === "omp");
	if (!demo) return [];
	return renderStatusline(demo.snapshot, { config: loadConfig(env), width: columns, nowMs, appearance: "dark", env, measure: Bun.stringWidth });
}

if (import.meta.main && Bun.argv.includes("--demo")) {
	const columns = Number(Bun.env.COLUMNS) || process.stdout.columns || 120;
	console.log(demoRows(Bun.env, columns).join("\n"));
}
