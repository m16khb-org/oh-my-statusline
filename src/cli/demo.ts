// Preview every harness's status line with fake session data.
//
//   bun run demo [--case all|claude|codex|omp|opencode|agents] [--width N]
//                [--theme dark|light] [--glyphs powerline|plain] [--colors 24|256]

import type { ColorMode, GlyphMode, RenderContext, ThemeName } from "../domain/render/cells.ts";
import { emit } from "../domain/render/cells.ts";
import { renderAgentRows } from "../domain/render/agents.ts";
import { demoAgents, demoCases } from "../domain/render/demo.ts";
import { renderRows } from "../domain/render/statusline.ts";

const CASES = ["all", "claude", "codex", "omp", "opencode", "agents"] as const;
type CaseName = (typeof CASES)[number];

function flag(argv: readonly string[], name: string): string | undefined {
	const i = argv.indexOf(name);
	return i >= 0 ? argv[i + 1] : undefined;
}

export function demo(argv: readonly string[], env: Record<string, string | undefined>, columns: number | undefined): string {
	const pick = (flag(argv, "--case") ?? "all") as CaseName;
	if (!CASES.includes(pick)) throw new Error(`unknown --case ${pick}; one of ${CASES.join(", ")}`);
	const theme: ThemeName = (flag(argv, "--theme") ?? env.STATUSLINE_THEME) === "light" ? "light" : "dark";
	const glyphs: GlyphMode = (flag(argv, "--glyphs") ?? env.STATUSLINE_GLYPHS) === "plain" ? "plain" : "powerline";
	const depth = flag(argv, "--colors") ?? env.STATUSLINE_COLORS ?? env.COLORTERM ?? "";
	const colors: ColorMode = ["24", "truecolor", "24bit"].includes(depth) ? 24 : 256;
	const width = Number(flag(argv, "--width")) || Number(env.COLUMNS) || columns || 120;
	const nowMs = Date.now();
	const ctx: RenderContext = { width, nowMs, theme, glyphs, colors, measure: Bun.stringWidth };

	let out = "";
	for (const c of demoCases(nowMs)) {
		if (pick !== "all" && pick !== c.snapshot.harness) continue;
		out += `\n\x1b[2m── ${c.title} ──\x1b[0m\n${renderRows(c.snapshot, ctx).join("\n")}\n`;
	}
	if (pick === "agents") {
		out += "\n\x1b[2m── Agent panel rows (Claude Code subagentStatusLine) ──\x1b[0m\n";
		for (const row of renderAgentRows(demoAgents(nowMs), ctx)) out += `${emit(row.cells, colors)}\n`;
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
