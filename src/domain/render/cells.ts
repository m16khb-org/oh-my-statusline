// The cell model every renderer produces, the render context, and the ANSI encoder. A cell is
// a run of text in one style; harnesses that draw styled text themselves (OpenCode) take cells,
// terminal harnesses take emit()'s ANSI string.

import type { Rgb } from "../model/values.ts";

export type ThemeName = "dark" | "light";
export type GlyphMode = "powerline" | "plain" | "ascii";
/** ANSI color depth; 0 draws no SGR at all (NO_COLOR). */
export type ColorMode = 24 | 256 | 0;

export interface Cell {
	text: string;
	fg?: Rgb;
	bg?: Rgb;
	bold?: boolean;
	/** OSC 8 hyperlink target. */
	url?: string;
}

export interface RenderContext {
	/** Cells the rows may occupy. */
	width: number;
	/** Clock for reset countdowns, time-to-limit warnings and agent ages. */
	nowMs: number;
	theme: ThemeName;
	glyphs: GlyphMode;
	/** ANSI color depth for emit(). */
	colors: ColorMode;
	/** Terminal cell width of a string. Injected (Bun.stringWidth in practice); default counts code points. */
	measure?: (text: string) => number;
	/** Below this width nothing is drawn. Default 20. */
	minimumWidth?: number;
}

export type Measure = (text: string) => number;

export const countCodePoints: Measure = (text) => {
	let n = 0;
	for (const _ of text) n++;
	return n;
};

export function rowWidth(cells: readonly Cell[], measure: Measure): number {
	let width = 0;
	for (const cell of cells) width += measure(cell.text);
	return width;
}

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** Cut to `limit` cells, ending in `ellipsis` when it does not fit. Never splits a grapheme. */
export function clip(text: string, limit: number, measure: Measure, ellipsis = "…"): string {
	if (measure(text) <= limit) return text;
	let out = "";
	let width = 0;
	for (const { segment } of graphemes.segment(text)) {
		const next = measure(segment);
		if (width + next > limit - measure(ellipsis)) break;
		out += segment;
		width += next;
	}
	return `${out}${ellipsis}`;
}

/** Nearest xterm-256 color: the 6x6x6 cube, or the gray ramp for near-grays. */
export function rgb256(r: number, g: number, b: number): number {
	const hi = Math.max(r, g, b);
	const lo = Math.min(r, g, b);
	if (hi - lo <= 12) {
		const v = Math.trunc((r + g + b) / 3);
		if (v < 8) return 16;
		if (v > 238) return 231;
		return 232 + Math.trunc((v - 8) / 10);
	}
	const level = (c: number): number => (c < 48 ? 0 : c < 115 ? 1 : Math.trunc((c - 35) / 40));
	return 16 + 36 * level(r) + 6 * level(g) + level(b);
}

function sgrColor(layer: 38 | 48, color: Rgb, mode: ColorMode): string {
	return mode === 256 ? `${layer};5;${rgb256(color[0], color[1], color[2])}` : `${layer};2;${color.join(";")}`;
}

/**
 * ANSI for one row: every run resets first (`ESC[0;…m`), so no style leaks from the previous
 * run; links wrap their run in OSC 8; a non-empty row ends with a reset. Mode 0 emits no SGR
 * (styles are dropped, links kept).
 */
export function emit(cells: readonly Cell[], mode: ColorMode): string {
	let out = "";
	for (const cell of cells) {
		if (mode === 0) {
			out += cell.url ? `\x1b]8;;${cell.url}\x07${cell.text}\x1b]8;;\x07` : cell.text;
			continue;
		}
		const params: string[] = [];
		if (cell.bold) params.push("1");
		if (cell.fg) params.push(sgrColor(38, cell.fg, mode));
		if (cell.bg) params.push(sgrColor(48, cell.bg, mode));
		const run = `\x1b[0;${params.length ? params.join(";") : "0"}m${cell.text}`;
		out += cell.url ? `\x1b]8;;${cell.url}\x07${run}\x1b]8;;\x07` : run;
	}
	return out && mode !== 0 ? `${out}\x1b[0m` : out;
}
