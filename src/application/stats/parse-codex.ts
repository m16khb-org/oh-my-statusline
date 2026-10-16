// Codex rollouts: ~/.codex/sessions/**/rollout-*.jsonl (see docs/stats-sources.md).
//
// - `session_meta.payload.id` names the session; `turn_context.payload.model` (or a later
//   `thread_settings_applied`) names the model in effect.
// - `event_msg` `token_count` carries `info.total_token_usage`, CUMULATIVE for the thread, and is
//   re-emitted with an unchanged total, so events are the deltas between successive totals.
//   `input_tokens` includes `cached_input_tokens`; the delta is split into fresh input / cache read.
// - Codex stores no cost anywhere.

import type { LineParser, UsageEvent } from "./model.ts";
import { isoMs, num, obj, parseObject, str } from "./parse-util.ts";

/** Cumulative [input, cached input, cache write, output] of the last total seen. */
type Totals = [number, number, number, number];

export interface CodexCarry {
	session: string;
	model: string;
	lastTs: number;
	prev: Totals | null;
}

const INTERESTING = ['"session_meta"', '"turn_context"', '"thread_settings_applied"', '"token_count"'];

export const codexParser: LineParser<CodexCarry> = {
	initial: (fileHint) => ({ session: fileHint, model: "unknown", lastTs: 0, prev: null }),
	line(carry, text, emit) {
		if (!INTERESTING.some((needle) => text.includes(needle))) return;
		const o = parseObject(text);
		const payload = obj(o?.payload);
		if (!o || !payload) return;
		const ts = isoMs(o.timestamp);
		if (!Number.isNaN(ts)) carry.lastTs = ts;
		if (o.type === "session_meta") {
			carry.session = str(payload.id) ?? str(payload.session_id) ?? carry.session;
		} else if (o.type === "turn_context") {
			carry.model = str(payload.model) ?? carry.model;
		} else if (o.type === "event_msg" && payload.type === "thread_settings_applied") {
			carry.model = str(obj(payload.thread_settings)?.model) ?? carry.model;
		} else if (o.type === "event_msg" && payload.type === "token_count") {
			const total = obj(obj(payload.info)?.total_token_usage);
			if (!total || carry.lastTs === 0) return;
			const now: Totals = [num(total.input_tokens), num(total.cached_input_tokens), num(total.cache_write_input_tokens), num(total.output_tokens)];
			const prev = carry.prev ?? [0, 0, 0, 0];
			carry.prev = now;
			// A component that went backwards means the counter restarted: count the new total whole.
			const base = now.some((v, i) => v < (prev[i] ?? 0)) ? [0, 0, 0, 0] : prev;
			const [dIn, dCached, dWrite, dOut] = now.map((v, i) => v - (base[i] ?? 0)) as Totals;
			const event: UsageEvent = {
				sessionId: carry.session,
				model: carry.model,
				tsMs: carry.lastTs,
				input: Math.max(0, dIn - dCached),
				output: dOut,
				cacheRead: dCached,
				cacheWrite: dWrite,
				unsplit: 0,
				costUsd: null,
			};
			emit(event);
		}
	},
	pending: () => [],
};

/** One `threads` row of `~/.codex/state_*.sqlite`. */
export interface CodexThreadRow {
	id: unknown;
	model: unknown;
	createdMs: unknown;
	updatedMs: unknown;
	tokensUsed: unknown;
}

/**
 * A thread whose rollout is gone still records one lifetime `tokens_used` total with no split.
 * It is dated by its last update; the caller only uses it for threads no rollout covers.
 */
export function codexThreadEvent(row: CodexThreadRow): UsageEvent | null {
	const id = str(row.id);
	const tokens = num(row.tokensUsed);
	const tsMs = typeof row.updatedMs === "number" ? row.updatedMs : typeof row.createdMs === "number" ? row.createdMs : Number.NaN;
	if (!id || tokens === 0 || Number.isNaN(tsMs)) return null;
	return { sessionId: id, model: str(row.model) ?? "unknown", tsMs, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, unsplit: tokens, costUsd: null };
}
