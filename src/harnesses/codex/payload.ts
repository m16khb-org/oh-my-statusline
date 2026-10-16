// Codex telemetry → StatusSnapshot. Codex has no cost, pull request or prompt-cache lifetime,
// so those stay null: the status line shows what Codex reports and nothing invented.

import { toDirInfo } from "../../domain/model/dir.ts";
import { type GitState, type StatusSnapshot, toSnapshot } from "../../domain/model/snapshot.ts";
import type { RolloutState } from "./rollout.ts";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-";
const FULL_ID = new RegExp(`^${UUID}[0-9a-f]{12}$`);
const CUT_ID = new RegExp(`^${UUID}[0-9a-f]{5}\\.\\.\\.$`);

/** Codex 0.156.1 reserves this many tokens that never count against the context window. */
const CONTEXT_BASELINE_TOKENS = 12_000;
const FIVE_HOUR_MINUTES = 300;
const SEVEN_DAY_MINUTES = 10_080;

/**
 * The thread id (or its unique prefix) a terminal title carries; null for any other title, so a
 * foreign title never selects someone else's session. Codex shortens titles to 32 columns even
 * in wide terminals, which cuts the id to 29 characters plus "...".
 */
export function threadIdFromTitle(title: string): string | null {
	const text = title.trim();
	if (FULL_ID.test(text)) return text;
	if (CUT_ID.test(text)) return text.slice(0, -3);
	return null;
}

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);
const num = (value: unknown): number | undefined => (typeof value === "number" && Number.isFinite(value) ? value : undefined);

/**
 * Share of the context window in use, as Codex 0.156.1 computes it
 * (TokenUsage.percent_of_context_window_remaining): the first 12,000 tokens are a fixed baseline
 * that counts toward neither the window nor the usage.
 */
function contextUsedPct(tokens: number, size: number): number {
	const room = size - CONTEXT_BASELINE_TOKENS;
	const remaining = room > 0 ? Math.max(0, Math.min(100, ((room - Math.max(0, tokens - CONTEXT_BASELINE_TOKENS)) * 100) / room)) : 0;
	return 100 - Math.floor(remaining + 0.5);
}

export interface PayloadInput {
	/** The pane's working directory; the rollout's own cwd wins when it has one. */
	cwd: string;
	startedMs: number;
	nowMs: number;
	linesAdded: number;
	linesRemoved: number;
	git: { top: string; main: string; state: GitState | null } | null;
}

export function snapshotFor(state: RolloutState, input: PayloadInput): StatusSnapshot {
	const model = typeof state.model === "string" && state.model ? state.model : "Codex";
	const cwd = typeof state.cwd === "string" && state.cwd ? state.cwd : input.cwd;
	let startedMs = input.startedMs;
	if (typeof state.timestamp === "string" && state.timestamp) {
		const parsed = Date.parse(state.timestamp);
		if (!Number.isNaN(parsed)) startedMs = parsed;
	}

	const info = isObject(state.info) ? state.info : {};
	const last = isObject(info.last_token_usage) ? info.last_token_usage : {};
	const size = num(info.model_context_window) ?? 0;
	const inputTokens = num(last.input_tokens) ?? 0;
	const cached = num(last.cached_input_tokens);
	const tokens = num(last.total_tokens);

	const hit = inputTokens > 0 && cached !== undefined ? Math.floor(Math.min(100, Math.max(0, (cached * 100) / inputTokens)) + 0.5) : null;
	const cache = hit === null ? null : { hitPct: hit, ttlRemainingMs: null };
	// Without a reading the window still exists in the UI: `usedPct: null` draws the `ctx —` placeholder.
	const context =
		size > 0 && tokens !== undefined
			? { usedPct: contextUsedPct(tokens, size), tokens, windowSize: size, exceeds200k: false }
			: { usedPct: null, tokens: 0, windowSize: 0, exceeds200k: false };

	const windows: Record<string, { usedPct: number; resetsAtMs: number | null }> = {};
	const rateLimits = isObject(state.rate_limits) ? state.rate_limits : {};
	for (const limit of Object.values(rateLimits)) {
		if (!isObject(limit)) continue;
		const used = num(limit.used_percent);
		const label = limit.window_minutes === FIVE_HOUR_MINUTES ? "5h" : limit.window_minutes === SEVEN_DAY_MINUTES ? "7d" : null;
		if (used === undefined || label === null) continue;
		const resetsAt = num(limit.resets_at);
		windows[label] = { usedPct: used, resetsAtMs: resetsAt ? resetsAt * 1000 : null };
	}
	const limits = [];
	if (windows["5h"]) limits.push({ label: "5h", windowMs: 18_000_000, ...windows["5h"] });
	limits.push({ label: "7d", windowMs: 604_800_000, ...(windows["7d"] ?? { usedPct: null, resetsAtMs: null }) });

	return toSnapshot("codex", {
		model: { name: model.replaceAll("gpt-", "GPT-").replaceAll("-astra", " Astra").replaceAll("-sol", " Sol").replaceAll("-luna", " Luna"), family: model, isFast: false },
		effort: typeof state.effort === "string" ? state.effort : "",
		dir: toDirInfo({ cwd, top: input.git?.top, main: input.git?.main }),
		git: input.git?.state ?? null,
		pr: null,
		stats: { costUsd: null, durationMs: Math.max(0, input.nowMs - startedMs), linesAdded: input.linesAdded, linesRemoved: input.linesRemoved },
		cache,
		context,
		limits,
		counts: null,
	});
}
