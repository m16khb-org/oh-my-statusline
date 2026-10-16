// Colors and glyphs shared by every row. Chip backgrounds are the same in both themes (dark chip
// text reads on all of them); ink colors are for text drawn on the terminal's own background.

import type { Rgb } from "../model/values.ts";
import type { ColorMode, GlyphMode, ThemeName } from "./cells.ts";

export const CHIP_FG: Rgb = [26, 27, 38];
export const CHIP_FG_LIGHT: Rgb = [192, 202, 245];

export const CHIP = {
	purple: [187, 154, 247],
	blue: [122, 162, 247],
	cyan: [125, 207, 255],
	teal: [115, 218, 202],
	green: [158, 206, 106],
	yellow: [224, 175, 104],
	orange: [255, 158, 100],
	red: [247, 118, 142],
	slate: [65, 72, 104],
	silver: [169, 177, 214],
} as const satisfies Record<string, Rgb>;

export interface Ink {
	dim: Rgb;
	faint: Rgb;
	teal: Rgb;
	green: Rgb;
	yellow: Rgb;
	orange: Rgb;
	red: Rgb;
}

export const INK: Record<ThemeName, Ink> = {
	dark: {
		dim: [115, 122, 162],
		faint: [84, 92, 126],
		teal: [115, 218, 202],
		green: [158, 206, 106],
		yellow: [224, 175, 104],
		orange: [255, 158, 100],
		red: [247, 118, 142],
	},
	light: {
		dim: [104, 112, 154],
		faint: [168, 174, 203],
		teal: [17, 140, 116],
		green: [88, 117, 57],
		yellow: [140, 108, 62],
		orange: [177, 92, 0],
		red: [245, 42, 101],
	},
};

export interface Glyphs {
	arrow: string;
	thin: string;
	branch: string;
	up: string;
	down: string;
	/** Between gauges. */
	gaugeSep: string;
	/** Between session stats. */
	statSep: string;
	/** Joins a worktree name to its directory, and "fast" to the effort. */
	dot: string;
	/** Bar cell: filled, and the empty track. Colored modes tell them apart by color alone. */
	barFill: string;
	barTrack: string;
	ellipsis: string;
	/** Time-to-limit warning, reset countdown, conflicts / failed, approved, changes requested. */
	warn: string;
	reset: string;
	fail: string;
	ok: string;
	rejected: string;
	subagents: string;
	shells: string;
	minus: string;
	/** A known window without a reading. */
	none: string;
}

// Powerline glyphs live in the private use area; escapes keep editors from stripping them.
const UNICODE = {
	gaugeSep: " │ ",
	statSep: " · ",
	dot: "·",
	barFill: "▆",
	barTrack: "▆",
	ellipsis: "…",
	warn: "⚠",
	reset: "↻",
	fail: "✘",
	ok: "✓",
	rejected: "✗",
	subagents: "◈",
	shells: "⌘",
	minus: "−",
	none: "—",
} as const;

export const GLYPHS: Record<GlyphMode, Glyphs> = {
	powerline: { arrow: "\ue0b0", thin: "\ue0b1", branch: "\ue0a0", up: "⇡", down: "⇣", ...UNICODE },
	plain: { arrow: "", thin: "", branch: "", up: "↑", down: "↓", ...UNICODE },
	// 7-bit only: nothing here may need a UTF-8 locale or a special font.
	ascii: {
		arrow: "",
		thin: "",
		branch: "",
		up: "^",
		down: "v",
		gaugeSep: " | ",
		statSep: " - ",
		dot: ":",
		barFill: "#",
		barTrack: "-",
		ellipsis: "...",
		warn: "!",
		reset: "@",
		fail: "x",
		ok: "ok",
		rejected: "x",
		subagents: "ag",
		shells: "sh",
		minus: "-",
		none: "-",
	},
};

/**
 * The glyphs a render actually draws with. Without color, powerline arrows and chip backgrounds
 * carry no meaning, so powerline falls back to plain; and a bar whose fill and track differ only
 * by color becomes unreadable, so the track gets its own low block (▁ under ▆, both fill the cell).
 */
export function glyphSet(mode: GlyphMode, colors: ColorMode): Glyphs {
	if (colors !== 0) return GLYPHS[mode];
	const base = GLYPHS[mode === "powerline" ? "plain" : mode];
	return base.barFill === base.barTrack ? { ...base, barTrack: "▁" } : base;
}

// First match wins. Claude families and OpenAI (GPT/Astra/o-series) keep the colors claude-, codex-
// and omp-statusline used; the rest extend the palette to the providers OpenCode serves.
const MODEL_FAMILIES: ReadonlyArray<readonly [RegExp, Rgb]> = [
	[/opus/i, CHIP.purple],
	[/sonnet/i, CHIP.cyan],
	[/haiku/i, CHIP.teal],
	[/fable/i, CHIP.orange],
	// A bare "Codex" (no model reported yet) stays silver, as codex-statusline drew it.
	[/gpt|astra|^o[1-9]/i, CHIP.purple],
	[/gemini/i, CHIP.blue],
	[/deepseek/i, CHIP.purple],
	[/kimi|moonshot/i, CHIP.cyan],
	[/glm|zhipu/i, CHIP.teal],
	[/qwen/i, CHIP.orange],
	[/grok/i, CHIP.slate],
];

/** Chip background for a model family, matched against the model id and/or display name. */
export function modelColor(model: string): Rgb {
	for (const [pattern, color] of MODEL_FAMILIES) if (pattern.test(model)) return color;
	return CHIP.silver;
}

/** Effort chip: red max, orange xhigh, yellow high, teal medium, slate anything else. */
export function effortColors(effort: string): { bg: Rgb; fg: Rgb } {
	switch (effort.toLowerCase()) {
		case "max":
		case "ultra":
			return { bg: CHIP.red, fg: CHIP_FG };
		case "xhigh":
		case "extra-high":
			return { bg: CHIP.orange, fg: CHIP_FG };
		case "high":
			return { bg: CHIP.yellow, fg: CHIP_FG };
		case "medium":
		case "mid":
			return { bg: CHIP.teal, fg: CHIP_FG };
		default:
			return { bg: CHIP.slate, fg: CHIP_FG_LIGHT };
	}
}

/** Whole percent → ink: <50 green, 50-64 yellow, 65-79 orange, >=80 red. */
export function levelColor(ink: Ink, percent: number): Rgb {
	if (percent >= 80) return ink.red;
	if (percent >= 65) return ink.orange;
	if (percent >= 50) return ink.yellow;
	return ink.green;
}

/** Blend `a` toward `b` by `pct` percent, truncating like the shell renderers' integer math. */
function mix(a: Rgb, b: Rgb, pct: number): Rgb {
	const at = (i: 0 | 1 | 2) => a[i] + Math.trunc(((b[i] - a[i]) * pct) / 100);
	return [at(0), at(1), at(2)];
}

/** Bar position in tenths of a percent (0-1000) → gradient color, green until 35%. */
export function gradient(ink: Ink, tenths: number): Rgb {
	if (tenths < 350) return ink.green;
	if (tenths < 500) return mix(ink.green, ink.yellow, Math.trunc(((tenths - 350) * 100) / 150));
	if (tenths < 650) return mix(ink.yellow, ink.orange, Math.trunc(((tenths - 500) * 100) / 150));
	if (tenths < 800) return mix(ink.orange, ink.red, Math.trunc(((tenths - 650) * 100) / 150));
	return ink.red;
}
