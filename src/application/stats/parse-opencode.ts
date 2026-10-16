// OpenCode: ~/.local/share/opencode/opencode.db (see docs/stats-sources.md). The infrastructure
// reader flattens the JSON `data` of one assistant message into an `OpenCodeRow` with SQLite
// json_extract; this maps it to a usage event.
//
// - `tokens.output` already includes reasoning tokens (`tokens.total` = input + output + cache),
//   so `tokens.reasoning` is not added again.
// - OpenCode writes `cost: 0` for every message it could not price, so only a positive stored
//   cost counts as a cost; zero is "no cost data", not a free response.

import type { UsageEvent } from "./model.ts";
import { num, str } from "./parse-util.ts";

export interface OpenCodeRow {
	sessionId: unknown;
	model: unknown;
	/** `data.time.created` (ms), if present. */
	createdMs: unknown;
	/** The row's own `time_created` (ms). */
	rowMs: unknown;
	input: unknown;
	output: unknown;
	cacheRead: unknown;
	cacheWrite: unknown;
	cost: unknown;
}

export function opencodeEvent(row: OpenCodeRow): UsageEvent | null {
	const sessionId = str(row.sessionId);
	const model = str(row.model);
	const tsMs = typeof row.createdMs === "number" ? row.createdMs : typeof row.rowMs === "number" ? row.rowMs : Number.NaN;
	if (!sessionId || !model || Number.isNaN(tsMs)) return null;
	const cost = num(row.cost);
	return {
		sessionId,
		model,
		tsMs,
		input: num(row.input),
		output: num(row.output),
		cacheRead: num(row.cacheRead),
		cacheWrite: num(row.cacheWrite),
		unsplit: 0,
		costUsd: cost > 0 ? cost : null,
	};
}
