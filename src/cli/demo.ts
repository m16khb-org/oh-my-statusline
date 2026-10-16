// Preview every harness's status line with fake session data.
//
//   bun run demo [--case all|claude|codex|omp|opencode|chips|agents] [--width N]
//                [--theme dark|light] [--glyphs powerline|plain|ascii] [--colors 24|256|none]
// NO_COLOR (non-empty) drops every color and bold; see docs/display-modes.md.

import { colorDepth, DEFAULT_CONFIG } from "../application/config.ts";
import type { Cell, GlyphMode, RenderContext, ThemeName } from "../domain/render/cells.ts";
import { emit } from "../domain/render/cells.ts";
import { renderAgentRows } from "../domain/render/agents.ts";
import { demoAgents, demoCases, demoChipsCase } from "../domain/render/demo.ts";
import { renderCells } from "../domain/render/statusline.ts";

const CASES = ["all", "claude", "codex", "omp", "opencode", "chips", "agents"] as const;
type CaseName = (typeof CASES)[number];

function flag(argv: readonly string[], name: string): string | undefined {
	const i = argv.indexOf(name);
	return i >= 0 ? argv[i + 1] : undefined;
}

export function demo(argv: readonly string[], env: Record<string, string | undefined>, columns: number | undefined): string {
	const pick = (flag(argv, "--case") ?? "all") as CaseName;
	if (!CASES.includes(pick)) throw new Error(`unknown --case ${pick}; one of ${CASES.join(", ")}`);
	const theme: ThemeName = (flag(argv, "--theme") ?? env.STATUSLINE_THEME) === "light" ? "light" : "dark";
	const glyphChoice = flag(argv, "--glyphs") ?? env.STATUSLINE_GLYPHS;
	const glyphs: GlyphMode = glyphChoice === "plain" || glyphChoice === "ascii" ? glyphChoice : "powerline";
	const depth = flag(argv, "--colors") ?? env.STATUSLINE_COLORS ?? env.COLORTERM ?? "";
	const choice = ["24", "truecolor", "24bit"].includes(depth) ? "truecolor" : depth === "none" ? "none" : depth === "256" ? "256" : "auto";
	const colors = colorDepth({ ...DEFAULT_CONFIG, colors: choice }, env);
	const width = Number(flag(argv, "--width")) || Number(env.COLUMNS) || columns || 120;
	const nowMs = Date.now();
	const ctx: RenderContext = { width, nowMs, theme, glyphs, colors, measure: Bun.stringWidth };

	const dim = (text: string): string => (colors === 0 ? text : `\x1b[2m${text}\x1b[0m`);
	// The demo's PR links are fake; colorless output is for piping and diffing, so it carries no ESC at all.
	const line = (cells: Cell[]): string => emit(colors === 0 ? cells.map(({ url: _url, ...rest }) => rest) : cells, colors);
	let out = "";
	const cases = [...demoCases(nowMs).map((c) => ({ ...c, name: c.snapshot.harness as string })), { ...demoChipsCase(nowMs), name: "chips" }];
	for (const c of cases) {
		if (pick !== "all" && pick !== c.name) continue;
		out += `\n${dim(`── ${c.title} ──`)}\n${renderCells(c.snapshot, ctx).map(line).join("\n")}\n`;
	}
	if (pick === "agents") {
		out += `\n${dim("── Agent panel rows (Claude Code subagentStatusLine) ──")}\n`;
		for (const row of renderAgentRows(demoAgents(nowMs), ctx)) out += `${line(row.cells)}\n`;
	}
	return out;
}

if (import.meta.main) {
	try {
		process.stdout.write(demo(Bun.argv.slice(2), Bun.env, process.stdout.columns));
	} catch (error) {
		process.stderr.write(`${(error as Error).message}\n`);
		process.exit(2);
	}
}
