// Environment chips (ssh, tmux, venv, k8s) and today's cost in the render rules: order, colors,
// glyph modes, and that they are the first thing the width ladder drops. Snapshots without them
// render as before (the goldens in render.test.ts and display-modes.test.ts pin that); the chips
// golden below pins the new output across the width spectrum.

import { describe, expect, test } from "bun:test";
import { type HarnessId, type StatusSnapshot, toSnapshot } from "../../src/domain/model/snapshot.ts";
import type { ColorMode, GlyphMode, RenderContext } from "../../src/domain/render/cells.ts";
import { demoChipsCase } from "../../src/domain/render/demo.ts";
import { renderRows } from "../../src/domain/render/statusline.ts";

const NOW_MS = 1_790_000_000_000;
const ARROW = "\ue0b0";
const BRANCH = "\ue0a0";
const ORANGE = "255;158;100";
const SILVER = "169;177;214";
const TEAL = "115;218;202";
const PURPLE = "187;154;247";
const HARNESSES: HarnessId[] = ["claude", "codex", "omp", "opencode"];

const ctx = (width: number, over: Partial<RenderContext> = {}): RenderContext => ({
	width,
	nowMs: NOW_MS,
	theme: "dark",
	glyphs: "powerline",
	colors: 24,
	measure: Bun.stringWidth,
	...over,
});
const strip = (s: string) => s.replace(/\x1b\][^\x07]*\x07/g, "").replace(/\x1b\[[0-9;]*m/g, "");
const text = (s: StatusSnapshot, width = 200, over: Partial<RenderContext> = {}) => renderRows(s, ctx(width, over)).map(strip);
const chip = (bg: string, label: string) => `48;2;${bg}m ${label} `;

const base = {
	model: { name: "Opus 5.5", family: "claude-opus" },
	effort: "high",
	dir: { name: "my-app", relative: "", worktree: null },
	git: { branch: "main" },
	counts: { subagents: 2, shells: 0 },
	stats: { costUsd: 4.21, durationMs: 1_380_000, linesAdded: 156, linesRemoved: 23 },
	cache: { hitPct: null, ttlRemainingMs: 2_520_000 },
	context: { usedPct: 28, tokens: 283_000, windowSize: 1_000_000 },
};
const all = { ssh: "dev-box", tmux: "work:editor", venv: ".venv", k8s: "prod-eu" };
const snap = (env: Record<string, string | null> | null = all, over: Record<string, unknown> = {}, harness: HarnessId = "claude") =>
	toSnapshot(harness, { ...base, env, ...over });

describe("snapshot", () => {
	test("env and todayCostUsd are absent unless data exists; garbage never throws", () => {
		expect(toSnapshot("claude", base).env).toBeUndefined();
		expect(toSnapshot("claude", { ...base, env: { ssh: null, tmux: "", venv: 3, k8s: undefined } }).env).toBeUndefined();
		expect(toSnapshot("claude", { ...base, env: "x", todayCostUsd: "y" }).env).toBeUndefined();
		expect(toSnapshot("claude", { ...base, todayCostUsd: -1 }).todayCostUsd).toBeUndefined();
		expect(snap({ ssh: "h", tmux: null, venv: null, k8s: null }).env).toEqual({ ssh: "h", tmux: null, venv: null, k8s: null });
		expect(toSnapshot("claude", { ...base, todayCostUsd: 0 }).todayCostUsd).toBe(0);
	});
});

describe("chips", () => {
	test("they follow the counts chip in a fixed order: ssh, tmux, venv, k8s", () => {
		expect(text(snap())[0]).toBe(
			` Opus 5.5 ${ARROW} high ${ARROW} my-app ${ARROW} ${BRANCH} main ${ARROW} ◈ 2 ${ARROW} ssh dev-box ${ARROW} tmux work:editor ${ARROW} venv .venv ${ARROW} k8s prod-eu ${ARROW}  $4.21 · 23m · +156 −23 · cache 42m`,
		);
	});

	test("each chip has its own palette color, dark ink on it", () => {
		const row = renderRows(snap(), ctx(200))[0]!;
		expect(row).toContain(`\x1b[0;38;2;26;27;38;${chip(ORANGE, "ssh dev-box")}`);
		expect(row).toContain(`\x1b[0;38;2;26;27;38;${chip(SILVER, "tmux work:editor")}`);
		expect(row).toContain(`\x1b[0;38;2;26;27;38;${chip(TEAL, "venv .venv")}`);
		expect(row).toContain(`\x1b[0;38;2;26;27;38;${chip(PURPLE, "k8s prod-eu")}`);
	});

	test("only the chips that apply are drawn", () => {
		expect(text(snap({ ssh: null, tmux: "w:1", venv: null, k8s: null }))[0]).toContain(` ◈ 2 ${ARROW} tmux w:1 ${ARROW}`);
		for (const name of ["ssh", "venv", "k8s"]) expect(text(snap({ ssh: null, tmux: "w:1", venv: null, k8s: null }))[0]).not.toContain(name);
		expect(text(snap(null))[0]).toBe(text(toSnapshot("claude", base))[0]);
	});

	test("without a counts chip they follow the git chip", () => {
		expect(text(snap({ ssh: "h", tmux: null, venv: null, k8s: null }, { counts: null }))[0]).toContain(`main ${ARROW} ssh h ${ARROW}`);
	});

	test("a long tmux name or kubectl context is cut at 24 cells", () => {
		const long = "a-very-long-kubernetes-context-name-eu-west-1";
		expect(text(snap({ ssh: null, tmux: null, venv: null, k8s: long }))[0]).toContain("k8s a-very-long-kubernetes-…");
	});

	test("plain glyphs, ascii and NO_COLOR keep the chips", () => {
		const plain = text(snap(), 200, { glyphs: "plain" })[0]!;
		expect(plain).toContain("◈ 2   ssh dev-box   tmux work:editor   venv .venv   k8s prod-eu ");
		const ascii = text(snap(), 200, { glyphs: "ascii" })[0]!;
		expect(ascii).toContain("ag 2   ssh dev-box   tmux work:editor   venv .venv   k8s prod-eu ");
		const colorless = renderRows(snap(), ctx(200, { colors: 0 }))[0]!;
		expect(colorless).not.toMatch(/\x1b\[/);
		expect(colorless).toContain("ssh dev-box   tmux work:editor   venv .venv   k8s prod-eu");
	});

	test("today's cost is the last stat: Σ $X.XX, S $X.XX in ascii", () => {
		const s = snap(null, { todayCostUsd: 12.345 });
		expect(text(s)[0]).toMatch(/cache 42m · Σ \$12\.35$/);
		expect(text(s, 200, { glyphs: "ascii" })[0]).toMatch(/cache 42m - S \$12\.35$/);
		expect(text(snap(null, { todayCostUsd: null }))[0]).not.toContain("Σ");
		expect(text(snap(null, { todayCostUsd: 0 }))[0]).toContain("Σ $0.00");
	});
});

describe("width ladder: the new chips and today's cost are the first to go", () => {
	const s = snap(all, { todayCostUsd: 12.34 });
	const withoutChips = snap(null, {});

	test("while the row fits, everything is shown; one cell short, only the chips and Σ are gone", () => {
		const full = text(s, 500)[0]!;
		const fullWidth = Bun.stringWidth(full);
		expect(full).toContain("k8s prod-eu");
		expect(full).toContain("Σ $12.34");
		const narrower = text(s, fullWidth - 1)[0]!;
		for (const gone of ["ssh", "tmux", "venv", "k8s", "Σ"]) expect(narrower).not.toContain(gone);
		// Everything the ladder drops later is still there, exactly as for a snapshot without chips.
		expect(narrower).toBe(text(withoutChips, 500)[0]!);
		expect(narrower).toContain("cache 42m");
	});

	test("below that, a snapshot with chips renders exactly like one without, at every width", () => {
		for (let width = 20; width <= 160; width++) {
			const [row] = text(s, width);
			const bare = text(withoutChips, width)[0];
			if (row?.includes("ssh")) continue;
			expect(row).toBe(bare);
		}
	});

	test("rows never exceed the width", () => {
		for (let width = 60; width <= 200; width += 3) for (const row of text(s, width)) expect(Bun.stringWidth(row)).toBeLessThanOrEqual(width);
	});
});

describe("demo chips case", () => {
	test("shows ssh, tmux, venv and Σ and leaves k8s (opt-in) out", () => {
		const row = text(demoChipsCase(NOW_MS).snapshot, 200)[0]!;
		for (const part of ["ssh dev-box", "tmux work:editor", "venv .venv", "Σ $12.34"]) expect(row).toContain(part);
		expect(row).not.toContain("k8s");
	});
});

describe("golden rows with chips across the width spectrum", () => {
	const WIDTHS = [200, 140, 120, 112, 100, 90, 74, 60, 45, 44, 12];
	const goldenFile = Bun.file(new URL("../fixtures/golden/chips.json", import.meta.url));
	const variants: [string, GlyphMode, ColorMode][] = [
		["powerline", "powerline", 24],
		["ascii", "ascii", 24],
		["no-color", "powerline", 0],
	];

	test("every harness fixture with chips matches the golden output", async () => {
		const actual: Record<string, Record<string, string[]>> = {};
		for (const harness of HARNESSES) {
			const fixture = await Bun.file(new URL(`../fixtures/snapshots/${harness}.json`, import.meta.url)).json();
			const s = toSnapshot(harness, { ...fixture, env: all, todayCostUsd: 12.34 });
			for (const [name, glyphs, colors] of variants) {
				const key = `${harness}/${name}`;
				actual[key] = {};
				for (const width of WIDTHS) actual[key][width] = renderRows(s, ctx(width, { glyphs, colors }));
			}
		}
		if (Bun.env.UPDATE_GOLDEN === "1") await Bun.write(goldenFile, `${JSON.stringify(actual, null, 1)}\n`);
		expect(actual).toEqual(await goldenFile.json());
	});
});
