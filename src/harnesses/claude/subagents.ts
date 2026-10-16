// The `subagentStatusLine` protocol: Claude Code passes every visible task as
// `{ columns, tasks: [...] }` on stdin and reads back one `{"id", "content"}` JSON line per row to
// replace. Tasks without a model (shells, monitors) keep the default row; with no rows to draw
// (no tasks, too narrow) nothing is printed and Claude Code keeps its own.

import { toSnapshot } from "../../domain/model/snapshot.ts";
import { finiteNumber } from "../../domain/model/values.ts";
import { renderAgentRows } from "../../domain/render/agents.ts";
import { emit, type RenderContext } from "../../domain/render/cells.ts";
import { alt, asObject, text, wholeNumber } from "./snapshot.ts";

// A start time above this is epoch milliseconds, below it epoch seconds.
const MILLISECOND_EPOCH_FLOOR = 100_000_000_000;

/** The JSON lines of the panel's rows, each ending in a newline; empty when no row fits. */
export function subagentRows(input: unknown, ctx: Omit<RenderContext, "width">): string {
	const { columns, tasks } = asObject(input);
	if (!Array.isArray(tasks)) return "";
	const agents = tasks.flatMap((entry) => {
		const task = asObject(entry);
		const model = text(task.model);
		if (!model) return [];
		const startTime = finiteNumber(task.startTime) ?? 0;
		const effort = task.effort;
		return {
			id: text(task.id),
			model,
			// A numeric effort is a thinking-token budget: 32000 → 32k.
			effort: typeof effort === "number" && effort >= 1000 ? `${Math.floor(effort / 1000)}k` : text(effort),
			name: text(task.name),
			label: text(alt(task.label, task.description)),
			tokens: wholeNumber(task.tokenCount),
			windowSize: wholeNumber(task.contextWindowSize),
			status: text(task.status),
			startedAtMs: startTime <= 0 ? null : startTime > MILLISECOND_EPOCH_FLOOR ? startTime : startTime * 1000,
		};
	});
	const rows = renderAgentRows(toSnapshot("claude", { agents }).agents ?? [], { ...ctx, width: wholeNumber(columns) });
	return rows.map((row) => `${JSON.stringify({ id: row.id, content: emit(row.cells, ctx.colors) })}\n`).join("");
}
