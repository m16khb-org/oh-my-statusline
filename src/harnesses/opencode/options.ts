// The plugin options a user sets in cli.json: `{ "package": "./oh-my-statusline", "options": { ... } }`.
// `theme` is not an option: the TUI reports its own light/dark mode. Glyphs and colors come from
// the shared config (config.toml, STATUSLINE_*, NO_COLOR), with cli.json's `glyphs` (written by the
// installer) as its install-time default.

import type { ColorMode, GlyphMode, ThemeName } from "../../domain/render/cells.ts";

export interface Options {
	theme: ThemeName;
	glyphs: GlyphMode;
	/** 24-bit, or 0 when NO_COLOR / `colors = "none"` turns color off. */
	colors: ColorMode;
	/** One switch per chip or stat; a disabled one is left out of the snapshot. */
	model: boolean;
	effort: boolean;
	dir: boolean;
	git: boolean;
	lines: boolean;
	counts: boolean;
	/** Count running subagents (the shared config's `subagents`, not a plugin option); shells are counted regardless. */
	subagents: boolean;
	cost: boolean;
	elapsed: boolean;
	context: boolean;
	/** Draw a one-row line on the home screen too. */
	home: boolean;
	/** Nothing is drawn on a terminal narrower than this many columns. */
	minimumWidth: number;
	/** Columns left for the text the TUI draws on the same row. */
	reserve: number;
	/** Milliseconds between git polls. */
	interval: number;
	/** Draw a fixed sample session instead of the real one. */
	demo: boolean;
}

function flag(raw: Readonly<Record<string, unknown>>, key: string, fallback: boolean): boolean {
	const value = raw[key];
	return typeof value === "boolean" ? value : fallback;
}

function number(raw: Readonly<Record<string, unknown>>, key: string, fallback: number): number {
	const value = raw[key];
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** The shared config's part of the options. */
export interface SharedOptions {
	glyphs?: GlyphMode;
	colors?: ColorMode;
	subagents?: boolean;
}

/** Normalize the plugin options; anything missing or of the wrong type takes its default. */
export function readOptions(raw: Readonly<Record<string, unknown>> = {}, theme: ThemeName = "dark", shared: SharedOptions = {}): Options {
	return {
		theme,
		glyphs: shared.glyphs ?? (raw.glyphs === "plain" || raw.glyphs === "ascii" ? raw.glyphs : "powerline"),
		colors: shared.colors ?? 24,
		model: flag(raw, "model", true),
		effort: flag(raw, "effort", true),
		dir: flag(raw, "dir", true),
		git: flag(raw, "git", true),
		lines: flag(raw, "lines", true),
		counts: flag(raw, "counts", true),
		subagents: shared.subagents ?? true,
		cost: flag(raw, "cost", true),
		elapsed: flag(raw, "elapsed", true),
		context: flag(raw, "context", true),
		home: flag(raw, "home", true),
		minimumWidth: number(raw, "minimumWidth", 44),
		reserve: number(raw, "reserve", 16),
		interval: number(raw, "interval", 4000),
		demo: flag(raw, "demo", false),
	};
}
