// The agent panel (Claude Code's subagentStatusLine): one row per running subagent.
//
//   [model][effort] name · label        ctx gauge, tokens · running time, or ✓/✘ once finished
//
// Every row uses one detail level, so the gauges line up in one column: the first level at which
// each row fits with at least 12 cells of its label (or, at the last level, without it). When even
// the last level does not fit, no rows are returned and the harness keeps its default rows.

import type { RunningAgent } from "../model/snapshot.ts";
import { type Cell, clip, countCodePoints, graphemes, type Measure, type RenderContext, rowWidth } from "./cells.ts";
import { formatDuration, formatTokens } from "./format.ts";
import { CHIP_FG, effortColors, glyphSet, INK, modelColor } from "./palette.ts";
import { RowBuilder } from "./statusline.ts";

export interface AgentRow {
	id: string;
	cells: Cell[];
}

const FAMILY = /^(opus|sonnet|haiku|fable)$/;
const VERSION_PART = /^[0-9]{1,2}$/;

/** claude-haiku-4-5-20251001 → Haiku 4.5, claude-3-5-sonnet-20241022 → Sonnet 3.5, else the id itself. */
export function agentModelLabel(model: string): string {
	const raw = model.replace(/\[[^\]]*\]$/, "");
	const tokens = raw.toLowerCase().split(/[-.:@_/]/);
	const f = tokens.findIndex((t) => FAMILY.test(t));
	if (f < 0) return raw;
	const version: string[] = [];
	for (let i = f + 1; i < tokens.length && VERSION_PART.test(tokens[i]!); i++) version.push(tokens[i]!);
	if (version.length === 0) for (let i = f - 1; i >= 0 && VERSION_PART.test(tokens[i]!); i--) version.unshift(tokens[i]!);
	const family = tokens[f]!;
	return `${family[0]!.toUpperCase()}${family.slice(1)}${version.length ? ` ${version.join(".")}` : ""}`;
}

const ESCAPE_SEQUENCE = /\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g;
// C0, DEL, C1, zero-width space, direction marks and bidi overrides/isolates, then any whitespace
// run. ZWNJ/ZWJ (U+200C/200D) stay: emoji sequences and several scripts need them.
const INVISIBLE_OR_SPACE = /[\u0000-\u001f\u007f-\u009f\u200b\u200e\u200f\u202a-\u202e\u2066-\u2069\s]+/g;
const LABEL_LIMIT = 200;

/** One line of at most 200 graphemes: escape sequences and invisible characters collapse to one space, ends trimmed. */
function oneLine(text: string): string {
	const line = text.replace(ESCAPE_SEQUENCE, " ").replace(INVISIBLE_OR_SPACE, " ").trim();
	if (line.length <= LABEL_LIMIT) return line;
	let kept = 0;
	let end = 0;
	for (const { segment } of graphemes(line)) {
		if (kept === LABEL_LIMIT) break;
		kept++;
		end += segment.length;
	}
	return line.slice(0, end).trimEnd();
}

interface Parts {
	chips: Cell[];
	chipsW: number;
	right: Cell[];
	rightW: number;
}

interface Prepared {
	agent: RunningAgent;
	model: string;
	name: string;
	nameW: number;
	label: string;
	labelW: number;
	ageS: number;
}

/** Chips and the right-hand gauge/status at one level; each level drops more. */
function parts(a: Prepared, lvl: number, ctx: RenderContext, measure: Measure): Parts {
	const ink = INK[ctx.theme];
	const g = glyphSet(ctx.glyphs, ctx.colors);
	const left = new RowBuilder(ink, g);
	left.chip(modelColor(a.model), CHIP_FG, a.model, { bold: true });
	if (lvl < 4 && a.agent.effort) {
		const effort = effortColors(a.agent.effort);
		left.chip(effort.bg, effort.fg, a.agent.effort);
	}
	left.endChips();

	const right = new RowBuilder(ink, g);
	const { tokens, windowSize, status } = a.agent;
	if (windowSize > 0) {
		right.gauge("ctx", Math.trunc((tokens * 1000) / windowSize), lvl === 0 ? 8 : lvl === 1 ? 5 : 0);
		if (lvl < 3) {
			right.put(` ${formatTokens(tokens)}`, ink.dim);
			right.put(`/${formatTokens(windowSize)}`, ink.dim);
		}
	} else if (tokens > 0) right.put(`${formatTokens(tokens)} tok`, ink.dim);
	if (lvl < 5) {
		// A finished agent gets a mark, a live one its running time.
		let mark = "";
		let color = ink.dim;
		let bold = false;
		if (status === "completed") [mark, color, bold] = [g.ok, ink.green, true];
		else if (status === "failed") [mark, color, bold] = [g.fail, ink.red, true];
		else if (status === "killed") mark = g.fail;
		else if (status === "paused") mark = "paused";
		else if (a.ageS >= 0) mark = a.ageS < 60 ? `${a.ageS}s` : formatDuration(a.ageS);
		if (mark) {
			if (right.cells.length > 0) right.put(g.statSep, ink.faint);
			right.put(mark, color, bold);
		}
	}
	return { chips: left.cells, chipsW: rowWidth(left.cells, measure), right: right.cells, rightW: rowWidth(right.cells, measure) };
}

/** Width of chips plus name, and of the separator before the label (the stat separator, 3 cells, after a name, else " "). */
function leftWidth(a: Prepared, p: Parts): { leftW: number; sepW: number } {
	return a.name ? { leftW: p.chipsW + 1 + a.nameW, sepW: 3 } : { leftW: p.chipsW, sepW: 1 };
}

export function renderAgentRows(agents: readonly RunningAgent[], ctx: RenderContext): AgentRow[] {
	if (agents.length === 0) return [];
	const measure = ctx.measure ?? countCodePoints;
	const ink = INK[ctx.theme];
	const g = glyphSet(ctx.glyphs, ctx.colors);
	const cols = ctx.width;
	const prepared: Prepared[] = agents.map((agent) => {
		const name = oneLine(agent.name);
		const rawLabel = oneLine(agent.label);
		const label = rawLabel === name ? "" : rawLabel;
		return {
			agent,
			model: agentModelLabel(agent.model),
			name,
			nameW: measure(name),
			label,
			labelW: measure(label),
			ageS: agent.startedAtMs === null ? -1 : Math.trunc((ctx.nowMs - agent.startedAtMs) / 1000),
		};
	});

	let level = -1;
	for (let lvl = 0; lvl <= 5 && level < 0; lvl++) {
		const fits = prepared.every((a) => {
			const p = parts(a, lvl, ctx, measure);
			const { leftW, sepW } = leftWidth(a, p);
			const label = lvl === 5 ? 0 : Math.min(a.labelW, 12);
			return leftW + 2 + p.rightW + (label > 0 ? sepW + label : 0) <= cols;
		});
		if (fits) level = lvl;
	}
	if (level < 0) return [];

	// The gauge column: just past the widest name and label, but far enough left for every gauge.
	const built = prepared.map((a) => ({ a, p: parts(a, level, ctx, measure) }));
	let col = 0;
	let cap = cols;
	for (const { a, p } of built) {
		const { leftW, sepW } = leftWidth(a, p);
		col = Math.max(col, leftW + 2 + (a.labelW > 0 ? sepW + a.labelW : 0));
		cap = Math.min(cap, cols - p.rightW);
	}
	col = Math.min(col, cap);

	return built.map(({ a, p }) => {
		const { leftW, sepW } = leftWidth(a, p);
		const cells = [...p.chips];
		if (a.name) cells.push({ text: " " }, { text: a.name, bold: true });
		let width = leftW;
		const start = Math.max(col, width + 2);
		const budget = start - 2 - width - sepW;
		if (a.labelW > 0 && (budget >= a.labelW || budget >= 4)) {
			cells.push(sepW === 3 ? { text: g.statSep, fg: ink.faint } : { text: " " });
			const label = clip(a.label, budget, measure, g.ellipsis);
			cells.push({ text: label, fg: ink.dim });
			width += sepW + measure(label);
		}
		if (p.right.length > 0) cells.push({ text: " ".repeat(start - width) }, ...p.right);
		return { id: a.agent.id, cells };
	});
}
