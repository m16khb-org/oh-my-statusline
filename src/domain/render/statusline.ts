// The two-row powerline status line:
//
//   Row 1  [model][effort] [dir] [git] [PR/MR] [◈ ⌘] [ssh][tmux][venv][k8s]
//          cost · duration · +added −removed · cache · Σ today's cost
//   Row 2  ctx / 5h / 7d / tier-scoped gauges: gradient bar, used %, reset countdown (↻), and a
//          red ⚠ time-to-limit warning when the window's average pace would exhaust it first.
//
// Narrow widths step down a ladder. Row 1 first drops the environment chips and today's cost,
// then cache → lines → duration → cost → PR → effort,
// then cuts the branch to 20 cells and the directory to the repository name, and finally drops
// the directory. Row 2 shrinks the bars 10 → 8 → 6 → 0, then hides the token count, the reset
// countdowns and the tier-scoped windows, and finally the whole row.

import type { StatusSnapshot } from "../model/snapshot.ts";
import type { Rgb } from "../model/values.ts";
import { type Cell, clip, countCodePoints, emit, type Measure, type RenderContext, rowWidth } from "./cells.ts";
import { etaLimit, formatCost, formatDuration, formatTokens } from "./format.ts";
import { CHIP, CHIP_FG, CHIP_FG_LIGHT, effortColors, type Glyphs, glyphSet, gradient, INK, type Ink, levelColor, modelColor } from "./palette.ts";

const DEFAULT_MINIMUM_WIDTH = 20;

/** One row under construction: cells, the powerline join state, and the stat separator count. */
export class RowBuilder {
	readonly cells: Cell[] = [];
	#prevBg: Rgb | null = null;
	#stats = 0;

	constructor(
		readonly ink: Ink,
		readonly glyphs: Glyphs,
	) {}

	put(text: string, fg?: Rgb, bold = false): void {
		const cell: Cell = { text };
		if (bold) cell.bold = true;
		if (fg) cell.fg = fg;
		this.cells.push(cell);
	}

	/** One powerline segment, joined to the previous chip by an arrow (thin when colors match). */
	chip(bg: Rgb, fg: Rgb, text: string, options: { url?: string; bold?: boolean } = {}): void {
		const prev = this.#prevBg;
		if (prev) {
			if (!this.glyphs.arrow) this.cells.push({ text: " " });
			else if (prev.join() === bg.join()) this.cells.push({ text: this.glyphs.thin, fg, bg });
			else this.cells.push({ text: this.glyphs.arrow, fg: prev, bg });
		}
		const cell: Cell = { text: ` ${text} ` };
		if (options.bold) cell.bold = true;
		cell.fg = fg;
		cell.bg = bg;
		if (options.url) cell.url = options.url;
		this.cells.push(cell);
		this.#prevBg = bg;
	}

	endChips(): void {
		if (this.#prevBg && this.glyphs.arrow) this.cells.push({ text: this.glyphs.arrow, fg: this.#prevBg });
		this.#prevBg = null;
	}

	/** Two spaces after the chips, " · " between session stats. */
	statGap(): void {
		if (this.#stats === 0) this.put("  ");
		else this.put(this.glyphs.statSep, this.ink.faint);
		this.#stats++;
	}

	/** Gradient cells over a faint track and a trailing space; nothing at 0 cells. */
	bar(tenths: number, cells: number): void {
		if (cells <= 0) return;
		const fill = Math.min(cells, Math.trunc((tenths * cells + 500) / 1000));
		for (let i = 0; i < cells; i++) {
			// ▆ is a block element, which terminals draw to fill the cell; ▰▱ render small in many fonts.
			this.put(i < fill ? this.glyphs.barFill : this.glyphs.barTrack, i < fill ? gradient(this.ink, Math.trunc(((2 * i + 1) * 1000) / (2 * cells))) : this.ink.faint);
		}
		this.put(" ");
	}

	/** `label` in dim ink, a graded bar, the used share in bold; limits add ⚠ and ↻. */
	gauge(
		label: string,
		tenths: number,
		cells: number,
		limit?: { resetsAtS: number; windowS: number; nowS: number; showReset: boolean },
	): void {
		const whole = Math.trunc((tenths + 5) / 10);
		if (this.cells.length > 0) this.put(this.glyphs.gaugeSep, this.ink.faint);
		this.put(`${label} `, this.ink.dim);
		this.bar(tenths, cells);
		this.put(`${whole}%`, levelColor(this.ink, whole), true);
		if (!limit) return;
		const eta = etaLimit(tenths, limit.resetsAtS, limit.windowS, limit.nowS);
		if (eta === 0) this.put(` ${this.glyphs.warn}`, this.ink.red, true);
		else if (eta !== undefined) this.put(` ${this.glyphs.warn}~${formatDuration(eta)}`, this.ink.red, true);
		if (limit.showReset && limit.resetsAtS > limit.nowS) this.put(` ${this.glyphs.reset}${formatDuration(limit.resetsAtS - limit.nowS)}`, this.ink.dim);
	}

	/** A known window without a reading: `label —` in dim ink. */
	placeholder(label: string): void {
		this.put(`${this.cells.length > 0 ? this.glyphs.gaugeSep : ""}${label} ${this.glyphs.none}`, this.ink.dim);
	}
}

/** Chip texts and colors derived once per render; buildRow1 only chooses which to show. */
interface Prepared {
	effortText: string;
	effort: { bg: Rgb; fg: Rgb };
	dirFull: string;
	branch: string;
	gitBg: Rgb;
	gitCounts: string;
	pr: { text: string; bg: Rgb; fg: Rgb; url: string } | null;
	counts: string;
	env: { text: string; bg: Rgb }[];
}

function prepare(s: StatusSnapshot, g: Glyphs, measure: Measure): Prepared {
	const git = s.git;
	let gitCounts = "";
	let gitBg: Rgb = CHIP.green;
	if (git) {
		if (git.ahead > 0) gitCounts += ` ${g.up}${git.ahead}`;
		if (git.behind > 0) gitCounts += ` ${g.down}${git.behind}`;
		if (git.conflicts > 0) gitCounts += ` ${g.fail}${git.conflicts}`;
		if (git.staged > 0) gitCounts += ` +${git.staged}`;
		if (git.modified > 0) gitCounts += ` ~${git.modified}`;
		if (git.untracked > 0) gitCounts += ` ?${git.untracked}`;
		if (git.conflicts > 0) gitBg = CHIP.red;
		else if (git.staged + git.modified + git.untracked > 0) gitBg = CHIP.yellow;
	}
	const branch = git ? git.branch || (git.detachedOid ?? "").slice(0, 7) : "";

	// Directory: repository name, the path below the checkout root (last two segments), and a
	// linked worktree's name when it differs from both the branch and the repository.
	const { name, relative, worktree } = s.dir;
	const parts = relative.split("/");
	const rel = parts.length >= 3 ? `${g.ellipsis}/${parts[parts.length - 2]}/${parts[parts.length - 1]}` : relative;
	let dirFull = rel ? `${name}/${rel}` : name;
	if (worktree && worktree !== branch && worktree !== name) dirFull += `${g.dot}${worktree}`;

	let pr: Prepared["pr"] = null;
	if (s.pr) {
		const text = `${s.pr.kind === "mr" ? "!" : "#"}${s.pr.number}`;
		const url = s.pr.url;
		switch (s.pr.state) {
			case "approved":
				pr = { text: `${text} ${g.ok}`, bg: CHIP.teal, fg: CHIP_FG, url };
				break;
			case "changes_requested":
				pr = { text: `${text} ${g.rejected}`, bg: CHIP.red, fg: CHIP_FG, url };
				break;
			case "draft":
				pr = { text: `${text} draft`, bg: CHIP.slate, fg: CHIP_FG_LIGHT, url };
				break;
			default:
				pr = { text, bg: CHIP.cyan, fg: CHIP_FG, url };
		}
	}

	const counts: string[] = [];
	if (s.counts && s.counts.subagents > 0) counts.push(`${g.subagents} ${s.counts.subagents}`);
	if (s.counts && s.counts.shells > 0) counts.push(`${g.shells} ${s.counts.shells}`);

	let effortText = s.effort;
	if (s.model.isFast) effortText = effortText ? `${effortText}${g.dot}fast` : "fast";

	// Fixed order; long tmux names and kubectl contexts are cut so one chip cannot take the row.
	const env: Prepared["env"] = [];
	if (s.env?.ssh) env.push({ text: `ssh ${clip(s.env.ssh, 24, measure, g.ellipsis)}`, bg: CHIP.orange });
	if (s.env?.tmux) env.push({ text: `tmux ${clip(s.env.tmux, 24, measure, g.ellipsis)}`, bg: CHIP.silver });
	if (s.env?.venv) env.push({ text: `venv ${clip(s.env.venv, 24, measure, g.ellipsis)}`, bg: CHIP.teal });
	if (s.env?.k8s) env.push({ text: `k8s ${clip(s.env.k8s, 24, measure, g.ellipsis)}`, bg: CHIP.purple });

	return { effortText, effort: effortColors(s.effort), dirFull, branch, gitBg, gitCounts, pr, counts: counts.join(" "), env };
}

/**
 * Row 1 at one detail level: 0 shows everything, each level drops the next least important part.
 * Level 1 drops the environment chips and today's cost; levels 2-9 are the original ladder.
 */
function buildRow1(s: StatusSnapshot, p: Prepared, lvl: number, ink: Ink, g: Glyphs, measure: Measure): Cell[] {
	const row = new RowBuilder(ink, g);
	if (s.model.name) row.chip(modelColor(`${s.model.family} ${s.model.name}`), CHIP_FG, s.model.name, { bold: true });
	if (lvl < 7 && p.effortText) row.chip(p.effort.bg, p.effort.fg, p.effortText);
	if (s.dir.name) {
		if (lvl < 8) row.chip(CHIP.blue, CHIP_FG, p.dirFull);
		else if (lvl < 9) row.chip(CHIP.blue, CHIP_FG, s.dir.name);
	}
	if (s.git) {
		const branch = clip(p.branch, lvl >= 8 ? 20 : 40, measure, g.ellipsis);
		row.chip(p.gitBg, CHIP_FG, `${g.branch ? `${g.branch} ` : ""}${branch}${p.gitCounts}`);
	}
	if (lvl < 6 && p.pr) row.chip(p.pr.bg, p.pr.fg, p.pr.text, { url: p.pr.url });
	if (p.counts) row.chip(CHIP.cyan, CHIP_FG, p.counts);
	if (lvl < 1) for (const chip of p.env) row.chip(chip.bg, CHIP_FG, chip.text);
	row.endChips();

	const { costUsd, durationMs, linesAdded: add, linesRemoved: del } = s.stats;
	if (lvl < 5 && costUsd !== null && costUsd > 0) {
		row.statGap();
		row.put(formatCost(costUsd), ink.dim);
	}
	if (lvl < 4 && durationMs >= 60_000) {
		row.statGap();
		row.put(formatDuration(durationMs / 1000), ink.dim);
	}
	if (lvl < 3 && add + del > 0) {
		row.statGap();
		if (add > 0) row.put(`+${add}`, ink.green);
		if (add > 0 && del > 0) row.put(" ");
		if (del > 0) row.put(`${g.minus}${del}`, ink.red);
	}
	if (lvl < 2 && s.cache) {
		if (s.cache.hitPct !== null) {
			row.statGap();
			row.put("cache hit ", ink.dim);
			row.put(`${Math.round(s.cache.hitPct)}%`, ink.teal);
		}
		if (s.cache.ttlRemainingMs !== null && s.cache.ttlRemainingMs > 0) {
			row.statGap();
			row.put("cache ", ink.dim);
			row.put(formatDuration(s.cache.ttlRemainingMs / 1000), ink.teal);
		}
	}
	if (lvl < 1 && s.todayCostUsd !== undefined) {
		row.statGap();
		row.put(`${g.today} `, ink.dim);
		row.put(formatCost(s.todayCostUsd), ink.teal);
	}
	return row.cells;
}

/** ctx bar cells, limit bar cells, token count, reset countdowns, tier-scoped windows. */
type Row2Level = readonly [number, number, boolean, boolean, boolean];

const ROW2_LEVELS: readonly Row2Level[] = [
	[10, 8, true, true, true],
	[8, 6, true, true, true],
	[6, 4, true, true, true],
	[0, 0, true, true, true],
	[0, 0, false, true, true],
	[0, 0, false, false, true],
	[0, 0, false, false, false],
];

function buildRow2(s: StatusSnapshot, level: Row2Level, ink: Ink, g: Glyphs, nowMs: number): Cell[] {
	const [ctxCells, limitCells, showTokens, showResets, showScoped] = level;
	const row = new RowBuilder(ink, g);
	const ctx = s.context;
	if (ctx) {
		if (ctx.usedPct === null) row.placeholder("ctx");
		else {
			row.gauge("ctx", Math.round(ctx.usedPct * 10), ctxCells);
			if (showTokens && ctx.windowSize > 0) {
				row.put(` ${formatTokens(ctx.tokens)}`, ctx.exceeds200k ? ink.yellow : ink.dim);
				row.put(`/${formatTokens(ctx.windowSize)}`, ink.dim);
			}
		}
	}
	const nowS = Math.trunc(nowMs / 1000);
	for (const limit of s.limits) {
		if (limit.scopedModel && !showScoped) continue;
		if (limit.usedPct === null) {
			row.placeholder(limit.label);
			continue;
		}
		row.gauge(limit.label, Math.round(limit.usedPct * 10), limitCells, {
			resetsAtS: Math.trunc((limit.resetsAtMs ?? 0) / 1000),
			windowS: Math.trunc(limit.windowMs / 1000),
			nowS,
			showReset: showResets,
		});
	}
	return row.cells;
}

/** The status rows as cells: row 1, and row 2 when it has a gauge that fits. Empty below the minimum width. */
export function renderCells(s: StatusSnapshot, ctx: RenderContext): Cell[][] {
	if (ctx.width < (ctx.minimumWidth ?? DEFAULT_MINIMUM_WIDTH)) return [];
	const measure = ctx.measure ?? countCodePoints;
	const ink = INK[ctx.theme];
	const g = glyphSet(ctx.glyphs, ctx.colors);
	const p = prepare(s, g, measure);

	let row1 = buildRow1(s, p, 0, ink, g, measure);
	for (let lvl = 1; lvl <= 9 && rowWidth(row1, measure) > ctx.width; lvl++) row1 = buildRow1(s, p, lvl, ink, g, measure);

	let row2: Cell[] = [];
	for (const level of ROW2_LEVELS) {
		const cells = buildRow2(s, level, ink, g, ctx.nowMs);
		if (cells.length === 0) break;
		if (rowWidth(cells, measure) <= ctx.width) {
			row2 = cells;
			break;
		}
	}
	return [row1, row2].filter((row) => row.length > 0);
}

/** The status rows as ANSI strings. */
export function renderRows(s: StatusSnapshot, ctx: RenderContext): string[] {
	return renderCells(s, ctx).map((cells) => emit(cells, ctx.colors));
}
