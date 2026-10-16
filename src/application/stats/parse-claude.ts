// Claude Code transcripts: ~/.claude/projects/**/*.jsonl (see docs/stats-sources.md).
//
// - `type:"assistant"` lines carry `message.usage`. A streamed response is written as several
//   consecutive lines sharing `message.id` + `requestId` whose output_tokens grow; the last line
//   holds the final usage, so a run of equal keys is one event (held in `pending`).
// - `type:"cost-state"` lines carry CUMULATIVE per-model costUSD for the session; each is turned
//   into the delta since the previous one, dated by the latest assistant timestamp.

import type { LineParser, UsageEvent } from "./model.ts";
import type { Json } from "./parse-util.ts";
import { isoMs, num, obj, parseObject, str } from "./parse-util.ts";

export interface ClaudeCarry {
	session: string;
	lastTs: number;
	costPrev: Record<string, number>;
	pending: { key: string; event: UsageEvent } | null;
}

function assistantEvent(o: Json, session: string): { key: string; event: UsageEvent } | null {
	const message = obj(o.message);
	const usage = obj(message?.usage);
	const model = str(message?.model);
	const tsMs = isoMs(o.timestamp);
	if (!message || !usage || !model || model === "<synthetic>" || Number.isNaN(tsMs)) return null;
	const id = str(message.id);
	return {
		key: id ? `${id}|${str(o.requestId) ?? ""}` : "",
		event: {
			sessionId: str(o.sessionId) ?? session,
			model,
			tsMs,
			input: num(usage.input_tokens),
			output: num(usage.output_tokens),
			cacheRead: num(usage.cache_read_input_tokens),
			cacheWrite: num(usage.cache_creation_input_tokens),
			unsplit: 0,
			costUsd: null,
		},
	};
}

export const claudeParser: LineParser<ClaudeCarry> = {
	initial: (fileHint) => ({ session: fileHint, lastTs: 0, costPrev: {}, pending: null }),
	line(carry, text, emit) {
		const isCost = text.includes('"cost-state"');
		if (!isCost && !text.includes('"usage"')) return;
		const o = parseObject(text);
		if (!o) return;
		if (o.type === "assistant") {
			const next = assistantEvent(o, carry.session);
			if (!next) return;
			carry.lastTs = next.event.tsMs;
			if (carry.pending && next.key !== "" && carry.pending.key === next.key) {
				carry.pending = next;
				return;
			}
			if (carry.pending) emit(carry.pending.event);
			carry.pending = next;
		} else if (o.type === "cost-state") {
			const modelUsage = obj(o.modelUsage) ?? {};
			for (const [model, entry] of Object.entries(modelUsage)) {
				const total = obj(entry)?.costUSD;
				if (typeof total !== "number" || !Number.isFinite(total)) continue;
				const prev = carry.costPrev[model] ?? 0;
				// A total below the previous one means the counter restarted (resumed session).
				const delta = total >= prev ? total - prev : total;
				carry.costPrev[model] = total;
				if (delta <= 0 || carry.lastTs === 0) continue;
				emit({
					sessionId: str(o.sessionId) ?? carry.session,
					model,
					tsMs: carry.lastTs,
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					unsplit: 0,
					costUsd: delta,
				});
			}
		}
	},
	pending: (carry) => (carry.pending ? [carry.pending.event] : []),
};
