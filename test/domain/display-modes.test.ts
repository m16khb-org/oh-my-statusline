// Display modes: ascii glyphs, colorless output (NO_COLOR) and narrow-width behavior in each.
// Powerline and plain output is pinned by the goldens in render.test.ts; these goldens pin the rest.

import { describe, expect, test } from "bun:test";
import { type HarnessId, toSnapshot } from "../../src/domain/model/snapshot.ts";
import { renderAgentRows } from "../../src/domain/render/agents.ts";
import { type ColorMode, type GlyphMode, type RenderContext, countCodePoints, emit } from "../../src/domain/render/cells.ts";
import { demoAgents, demoCases } from "../../src/domain/render/demo.ts";
import { renderCells, renderRows } from "../../src/domain/render/statusline.ts";

const NOW_MS = 1_790_000_000_000;
const HARNESSES: HarnessId[] = ["claude", "codex", "omp", "opencode"];
const WIDTHS = [120, 60, 20, 12];

const ctx = (glyphs: GlyphMode, colors: ColorMode, width: number, over: Partial<RenderContext> = {}): RenderContext => ({
	width,
	nowMs: NOW_MS,
	theme: "dark",
	glyphs,
	colors,
	measure: Bun.stringWidth,
	...over,
});

const fixture = async (harness: HarnessId) => toSnapshot(harness, await Bun.file(new URL(`../fixtures/snapshots/${harness}.json`, import.meta.url)).json());
const SGR = /\x1b\[[0-9;]*m/;
const withoutEscapes = (s: string) => s.replace(/\x1b\][^\x07]*\x07/g, "").replace(/\x1b\[[0-9;]*m/g, "");

/** Every demo and fixture snapshot, plus a PR link and agents so links and the panel are covered. */
async function snapshots() {
	const out = demoCases(NOW_MS).map((c) => c.snapshot);
	for (const h of HARNESSES) out.push(await fixture(h));
	// Session text passes through verbatim, so the 7-bit tests need data that is ASCII itself.
	return out.map((s) => JSON.parse(JSON.stringify(s).replace(/[^\x00-\x7f]/gu, "-")) as typeof s);
}

describe("colorless output (colors = 0)", () => {
	test("emit draws no SGR but keeps OSC 8 links", () => {
		const out = emit([{ text: "a", fg: [1, 2, 3], bg: [4, 5, 6], bold: true }, { text: "b", url: "https://x.test" }], 0);
		expect(out).toBe("a\x1b]8;;https://x.test\x07b\x1b]8;;\x07");
		expect(emit([], 0)).toBe("");
	});

	test("no row of any snapshot contains an SGR escape, at any width or glyph mode", async () => {
		for (const s of await snapshots())
			for (const glyphs of ["powerline", "plain", "ascii"] as const)
				for (const width of [200, 120, 80, 44, 20])
					for (const row of renderRows(s, ctx(glyphs, 0, width))) expect(row).not.toMatch(SGR);
	});

	test("the PR link survives without color", async () => {
		const rows = renderRows(await fixture("claude"), ctx("powerline", 0, 120));
		expect(rows[0]).toContain("\x1b]8;;");
	});

	test("powerline falls back to space-separated chips: no arrows, no private-use glyphs", async () => {
		for (const s of await snapshots())
			for (const row of renderRows(s, ctx("powerline", 0, 200))) expect(row).not.toMatch(/[\ue000-\uf8ff]/u);
	});

	test("the bar tells fill from track without color", async () => {
		const s = toSnapshot("omp", { context: { usedPct: 50, tokens: 1, windowSize: 2 } });
		expect(withoutEscapes(renderRows(s, ctx("powerline", 0, 120))[0]!)).toContain("▆▆▆▆▆▁▁▁▁▁ 50%");
		expect(withoutEscapes(renderRows(s, ctx("plain", 0, 120))[0]!)).toContain("▆▆▆▆▆▁▁▁▁▁ 50%");
		expect(withoutEscapes(renderRows(s, ctx("powerline", 24, 120))[0]!)).toContain("▆▆▆▆▆▆▆▆▆▆ 50%");
	});

	test("colored output is unchanged by the colorless mode existing", async () => {
		const s = await fixture("omp");
		expect(renderRows(s, ctx("powerline", 24, 120))[0]).toMatch(SGR);
	});
});

describe("ascii glyphs", () => {
	const nonAscii = (s: string) => [...withoutEscapes(s)].filter((ch) => ch.charCodeAt(0) >= 0x80);

	test("every row of ASCII-data snapshots is 7-bit ASCII apart from escape sequences", async () => {
		for (const s of await snapshots())
			for (const colors of [0, 24, 256] as const)
				for (const width of [200, 120, 80, 60, 44, 20])
					for (const row of renderRows(s, ctx("ascii", colors, width))) expect(nonAscii(row)).toEqual([]);
	});

	test("the agent panel is 7-bit ASCII too", () => {
		const agents = demoAgents(NOW_MS);
		const statuses = ["running", "completed", "failed", "killed", "paused"] as const;
		const list = statuses.map((status, i) => ({ ...agents[i % agents.length]!, id: status, status, label: "x".repeat(80) }));
		for (const width of [200, 120, 80, 60])
			for (const row of renderAgentRows(list, ctx("ascii", 24, width))) expect(nonAscii(emit(row.cells, 24))).toEqual([]);
		const rows = renderAgentRows(list, ctx("ascii", 0, 120));
		expect(rows.length).toBe(5);
		expect(rows.map((r) => emit(r.cells, 0)).join("\n")).toContain("...");
	});

	test("uses ascii separators, bar, markers and counts", () => {
		const s = toSnapshot("omp", {
			model: { name: "Opus 5.5", family: "claude-opus-5-5", isFast: true },
			effort: "high",
			dir: { name: "app", relative: "a/b/c", worktree: "wt" },
			git: { branch: "main", ahead: 2, behind: 1, conflicts: 1 },
			pr: { kind: "pr", number: 7, state: "approved", url: "https://x.test/7" },
			counts: { subagents: 2, shells: 1 },
			stats: { costUsd: 1, durationMs: 120_000, linesAdded: 3, linesRemoved: 4 },
			context: { usedPct: 28, tokens: 283_000, windowSize: 1_000_000 },
			limits: [
				{ label: "5h", usedPct: 95, resetsAtMs: NOW_MS + 3_600_000, windowMs: 18_000_000 },
				{ label: "7d", usedPct: null, resetsAtMs: null, windowMs: 604_800_000 },
			],
		});
		const [row1, row2] = renderRows(s, ctx("ascii", 0, 200)) as [string, string];
		expect(row1).toContain(".../b/c:wt");
		expect(row1).toContain("^2 v1 x1");
		expect(row1).toContain("high:fast");
		expect(row1).toContain("#7 ok");
		expect(row1).toContain("ag 2 sh 1");
		expect(row1).toContain("$1.00 - 2m - +3 -4");
		expect(row2).toContain("ctx ###------- 28% 283k/1M | 5h ");
		expect(row2).toMatch(/!~\d+[hm]/);
		expect(row2).toContain("@1h");
		expect(row2).toMatch(/\| 7d -$/);
	});

	test("session-provided text passes through verbatim; only our decorations are ascii", () => {
		const s = toSnapshot("omp", { model: { name: "모델" }, dir: { name: "프로젝트", relative: "", worktree: null } });
		expect(renderRows(s, ctx("ascii", 0, 120))[0]).toBe(" 모델   프로젝트 ");
		const agents = toSnapshot("claude", { agents: [{ id: "a", name: "리뷰어", label: "읽는 중", model: "m", windowSize: 0, tokens: 0 }] }).agents ?? [];
		expect(emit(renderAgentRows(agents, ctx("ascii", 0, 120))[0]!.cells, 0)).toContain("리뷰어 - 읽는 중");
	});

	test("clips a long branch with an ascii ellipsis", () => {
		const s = toSnapshot("omp", { model: { name: "M" }, git: { branch: "feature/".padEnd(60, "x") } });
		const row = withoutEscapes(renderRows(s, ctx("ascii", 0, 200))[0]!);
		expect(row).toContain("...");
		expect(row).not.toContain("…");
	});

	test("powerline and plain keep their unicode glyphs", async () => {
		const row = withoutEscapes(renderRows(await fixture("omp"), ctx("plain", 24, 200)).join("\n"));
		expect(row).toMatch(/[│↻]/);
	});
});

describe("narrow widths and measurers", () => {
	const MODES: ReadonlyArray<readonly [GlyphMode, ColorMode]> = [
		["powerline", 24],
		["plain", 256],
		["ascii", 24],
		["powerline", 0],
		["plain", 0],
		["ascii", 0],
	];

	test("below the minimum width nothing is printed in any mode", async () => {
		for (const s of await snapshots())
			for (const [glyphs, colors] of MODES) {
				for (const width of [0, 1, 12, 19]) expect(renderRows(s, ctx(glyphs, colors, width))).toEqual([]);
				expect(renderRows(s, ctx(glyphs, colors, 30, { minimumWidth: 40 }))).toEqual([]);
			}
	});

	test("rows never exceed the width, with either measurer, in any mode", async () => {
		for (const measure of [countCodePoints, Bun.stringWidth])
			for (const s of await snapshots())
				for (const [glyphs, colors] of MODES)
					for (const width of [200, 120, 80, 60])
						for (const cells of renderCells(s, ctx(glyphs, colors, width, { measure })))
							expect(cells.reduce((n, c) => n + measure(c.text), 0)).toBeLessThanOrEqual(width);
	});

	test("rendering never inspects the locale", async () => {
		const saved = { LANG: process.env.LANG, LC_ALL: process.env.LC_ALL };
		process.env.LANG = "C";
		process.env.LC_ALL = "C";
		try {
			for (const s of await snapshots())
				for (const [glyphs, colors] of MODES) {
					expect(() => renderRows(s, ctx(glyphs, colors, 80, { measure: countCodePoints }))).not.toThrow();
					expect(() => renderAgentRows(demoAgents(NOW_MS), ctx(glyphs, colors, 80))).not.toThrow();
				}
		} finally {
			for (const [key, value] of Object.entries(saved)) {
				if (value === undefined) delete process.env[key];
				else process.env[key] = value;
			}
		}
	});
});

describe("golden rows for NO_COLOR and ascii", () => {
	const golden = (name: string, glyphs: GlyphMode, colors: ColorMode) => {
		test(`${name} fixtures at every width match the golden output`, async () => {
			const file = Bun.file(new URL(`../fixtures/golden/${name}.json`, import.meta.url));
			const actual: Record<string, Record<string, string[]>> = {};
			for (const harness of HARNESSES) {
				const s = await fixture(harness);
				actual[harness] = {};
				for (const width of WIDTHS) actual[harness][width] = renderRows(s, ctx(glyphs, colors, width));
			}
			if (Bun.env.UPDATE_GOLDEN === "1") await Bun.write(file, `${JSON.stringify(actual, null, 1)}\n`);
			expect(actual).toEqual(await file.json());
		});
	};
	golden("no-color", "powerline", 0);
	golden("ascii", "ascii", 24);
});
