// omp sessions: ~/.omp/agent/sessions/**/*.jsonl (see docs/stats-sources.md).
//
// - `{"type":"session","id":...}` names the session (every file has its own, subagent files too).
// - `{"type":"message","message":{"role":"assistant","usage":{...}}}` is one response; `usage`
//   carries input/output/cacheRead/cacheWrite and a stored `cost.total` in USD.
// - `{"type":"model_usage",...}` is an auxiliary model call (auto-thinking judge) with the same
//   `usage` shape; it is real spend and counted under its own model.

import type { LineParser } from "./model.ts";
import { isoMs, num, numOrNull, obj, parseObject, str } from "./parse-util.ts";

export interface OmpCarry {
	session: string;
}

export const ompParser: LineParser<OmpCarry> = {
	initial: (fileHint) => ({ session: fileHint }),
	line(carry, text, emit) {
		const isSession = text.startsWith('{"type":"session"');
		if (!isSession && !text.includes('"usage"')) return;
		const o = parseObject(text);
		if (!o) return;
		if (o.type === "session") {
			carry.session = str(o.id) ?? carry.session;
			return;
		}
		const message = o.type === "message" ? obj(o.message) : o.type === "model_usage" ? o : undefined;
		if (!message || (o.type === "message" && message.role !== "assistant")) return;
		const usage = obj(message.usage);
		const model = str(message.model);
		const tsMs = isoMs(o.timestamp);
		if (!usage || !model || Number.isNaN(tsMs)) return;
		emit({
			sessionId: carry.session,
			model,
			tsMs,
			input: num(usage.input),
			output: num(usage.output),
			cacheRead: num(usage.cacheRead),
			cacheWrite: num(usage.cacheWrite),
			unsplit: 0,
			costUsd: numOrNull(obj(usage.cost)?.total),
		});
	},
	pending: () => [],
};
