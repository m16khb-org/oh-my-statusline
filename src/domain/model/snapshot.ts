// The harness-neutral status snapshot: everything one status line can show, captured at one
// moment. Harness adapters fill it; the render rules read only this. Optional data follows one
// convention: `null` means "this harness has no such data here", and the matching segment is
// omitted. See docs/glossary.md for each term.

import { finiteNumber, type Percentage, type TokenAmount, toPercentage, toTokenAmount } from "./values.ts";

export type HarnessId = "claude" | "codex" | "omp" | "opencode";

export interface ModelInfo {
	/** Display name, e.g. "Opus 5.5". Empty when unknown: the model chip is omitted. */
	name: string;
	/** Model id or provider family text the family color is matched against, e.g. "claude-opus-5-5". */
	family: string;
	/** Fast/priority service tier is active. */
	isFast: boolean;
}

export interface DirInfo {
	/** Repository (or main checkout) name; empty when unknown. */
	name: string;
	/** Path below the checkout root, unabbreviated; empty at the root. */
	relative: string;
	/** Linked worktree name, or null in the main checkout. */
	worktree: string | null;
}

/** `git status --porcelain=v2 --branch` summary. */
export interface GitState {
	/** Branch name; empty while HEAD is detached. */
	branch: string;
	ahead: number;
	behind: number;
	conflicts: number;
	staged: number;
	modified: number;
	untracked: number;
	/** Full commit id while HEAD is detached, else null. */
	detachedOid: string | null;
}

export type PrReviewState = "approved" | "changes_requested" | "draft" | "pending";

export interface PrState {
	number: number;
	url: string;
	state: PrReviewState;
	/** "mr" for a GitLab merge request (`!12`), "pr" for a GitHub pull request (`#12`). */
	kind: "pr" | "mr";
}

export interface SessionStats {
	/** Session cost in US dollars; null when the harness does not report cost. */
	costUsd: number | null;
	durationMs: number;
	/** Working-tree lines added/removed against HEAD. */
	linesAdded: number;
	linesRemoved: number;
}

export interface CacheState {
	/** Share of the last prompt served from cache; null when unknown. */
	hitPct: Percentage | null;
	/** Time left before the prompt cache expires; null when the lifetime is unknown. */
	ttlRemainingMs: number | null;
}

export interface ContextUsage {
	/** Used share of the window. null: the window exists but has no reading yet (placeholder). */
	usedPct: Percentage | null;
	tokens: TokenAmount;
	windowSize: TokenAmount;
	/** The request is billed at the long-context rate (past 200k tokens). */
	exceeds200k: boolean;
}

/** One usage-limit window, e.g. 5h, 7d, or a tier-scoped weekly window such as Fable. */
export interface LimitWindow {
	label: string;
	/** null: the window is known but has no reading yet (placeholder). */
	usedPct: Percentage | null;
	resetsAtMs: number | null;
	/** Window length; the time-to-limit warning needs it. */
	windowMs: number;
	/** The tier or model this window is scoped to; scoped windows are the last to drop. */
	scopedModel: string | null;
}

export interface RunningCounts {
	subagents: number;
	shells: number;
}

export type AgentStatus = "running" | "completed" | "failed" | "killed" | "paused";

/** One subagent row of the agent panel. */
export interface RunningAgent {
	id: string;
	model: string;
	effort: string;
	name: string;
	label: string;
	tokens: TokenAmount;
	windowSize: TokenAmount;
	status: AgentStatus;
	startedAtMs: number | null;
}

export interface StatusSnapshot {
	harness: HarnessId;
	model: ModelInfo;
	/** Reasoning effort level, e.g. "max"; empty when unknown. */
	effort: string;
	dir: DirInfo;
	git: GitState | null;
	pr: PrState | null;
	stats: SessionStats;
	cache: CacheState | null;
	context: ContextUsage | null;
	limits: LimitWindow[];
	counts: RunningCounts | null;
	agents?: RunningAgent[];
}

const FIVE_HOURS_MS = 18_000_000;
const SEVEN_DAYS_MS = 604_800_000;
const PR_STATES: Record<string, PrReviewState> = {
	approved: "approved",
	changes_requested: "changes_requested",
	draft: "draft",
};
const AGENT_STATUSES: Record<string, AgentStatus> = {
	completed: "completed",
	failed: "failed",
	killed: "killed",
	paused: "paused",
};

type Raw = Record<string, unknown>;

function record(raw: unknown): Raw | null {
	return raw !== null && typeof raw === "object" && !Array.isArray(raw) ? (raw as Raw) : null;
}

function text(raw: unknown): string {
	return typeof raw === "string" ? raw : "";
}

/** A count: whole, non-negative, 0 for anything invalid. */
function count(raw: unknown): number {
	const value = finiteNumber(raw);
	return value === undefined || value < 0 ? 0 : Math.trunc(value);
}

function gitState(raw: unknown): GitState | null {
	const g = record(raw);
	if (!g) return null;
	const branch = text(g.branch);
	const detachedOid = text(g.detachedOid) || null;
	if (!branch && !detachedOid) return null;
	return {
		branch,
		ahead: count(g.ahead),
		behind: count(g.behind),
		conflicts: count(g.conflicts),
		staged: count(g.staged),
		modified: count(g.modified),
		untracked: count(g.untracked),
		detachedOid,
	};
}

function prState(raw: unknown): PrState | null {
	const p = record(raw);
	const number = count(p?.number);
	if (!p || number === 0) return null;
	return { number, url: text(p.url), state: PR_STATES[text(p.state)] ?? "pending", kind: p.kind === "mr" ? "mr" : "pr" };
}

function limitWindows(raw: unknown): LimitWindow[] {
	if (!Array.isArray(raw)) return [];
	const out: LimitWindow[] = [];
	for (const item of raw) {
		const l = record(item);
		const label = text(l?.label);
		if (!l || !label) continue;
		const windowMs = count(l.windowMs) || (label.endsWith("5h") ? FIVE_HOURS_MS : SEVEN_DAYS_MS);
		out.push({
			label,
			usedPct: toPercentage(l.usedPct),
			resetsAtMs: finiteNumber(l.resetsAtMs) ?? null,
			windowMs,
			scopedModel: text(l.scopedModel) || null,
		});
	}
	return out;
}

function runningAgents(raw: unknown): RunningAgent[] {
	const out: RunningAgent[] = [];
	for (const item of raw as unknown[]) {
		const a = record(item);
		const id = text(a?.id);
		const model = text(a?.model);
		if (!a || !id || !model) continue;
		out.push({
			id,
			model,
			effort: text(a.effort),
			name: text(a.name),
			label: text(a.label),
			tokens: toTokenAmount(a.tokens),
			windowSize: toTokenAmount(a.windowSize),
			status: AGENT_STATUSES[text(a.status)] ?? "running",
			startedAtMs: finiteNumber(a.startedAtMs) ?? null,
		});
	}
	return out;
}

/**
 * Normalize untrusted snapshot-shaped data (a harness mapping or a JSON fixture) into a valid
 * StatusSnapshot. Never throws: malformed parts become null, empty, or zero.
 */
export function toSnapshot(harness: HarnessId, raw: unknown): StatusSnapshot {
	const r = record(raw) ?? {};
	const model = record(r.model);
	const dir = record(r.dir);
	const stats = record(r.stats);
	const cache = record(r.cache);
	const context = record(r.context);
	const counts = record(r.counts);

	const snapshot: StatusSnapshot = {
		harness,
		model: { name: text(model?.name), family: text(model?.family), isFast: model?.isFast === true },
		effort: text(r.effort),
		dir: { name: text(dir?.name), relative: text(dir?.relative), worktree: text(dir?.worktree) || null },
		git: gitState(r.git),
		pr: prState(r.pr),
		stats: {
			costUsd: finiteNumber(stats?.costUsd) ?? null,
			durationMs: count(stats?.durationMs),
			linesAdded: count(stats?.linesAdded),
			linesRemoved: count(stats?.linesRemoved),
		},
		cache: cache
			? { hitPct: toPercentage(cache.hitPct), ttlRemainingMs: finiteNumber(cache.ttlRemainingMs) ?? null }
			: null,
		context: null,
		limits: limitWindows(r.limits),
		counts: counts ? { subagents: count(counts.subagents), shells: count(counts.shells) } : null,
	};
	if (context) {
		const tokens = toTokenAmount(context.tokens);
		snapshot.context = {
			usedPct: toPercentage(context.usedPct),
			tokens,
			windowSize: toTokenAmount(context.windowSize),
			exceeds200k: typeof context.exceeds200k === "boolean" ? context.exceeds200k : tokens > 200_000,
		};
	}
	if (Array.isArray(r.agents)) snapshot.agents = runningAgents(r.agents);
	return snapshot;
}
