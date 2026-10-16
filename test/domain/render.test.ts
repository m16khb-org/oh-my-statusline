// Render rules of the unified status line. Scenarios are ported from the four original suites:
// omp-statusline/test/render.test.ts, opencode-statusline/test/render.test.ts,
// claude-code-statusline/test/test_statusline.py (render + --subagents parts) and
// codex-statusline/renderer.sh behavior. Each `describe` notes its source.

import { describe, expect, test } from "bun:test";
import { type HarnessId, type StatusSnapshot, toSnapshot } from "../../src/domain/model/snapshot.ts";
import { type AgentRow, agentModelLabel, renderAgentRows } from "../../src/domain/render/agents.ts";
import { type Cell, clip, emit, type RenderContext, rgb256 } from "../../src/domain/render/cells.ts";
import { demoCases } from "../../src/domain/render/demo.ts";
import { etaLimit, formatCost, formatDuration, formatTokens } from "../../src/domain/render/format.ts";
import { modelColor } from "../../src/domain/render/palette.ts";
import { renderCells, renderRows } from "../../src/domain/render/statusline.ts";

const NOW_MS = 1_790_000_000_000;
const NOW_S = NOW_MS / 1000;
const ARROW = "\ue0b0";
const THIN = "\ue0b1";
const BRANCH = "\ue0a0";
const PURPLE = "187;154;247";
const BLUE = "122;162;247";
const CYAN = "125;207;255";
const GREEN = "158;206;106";
const YELLOW = "224;175;104";
const ORANGE = "255;158;100";
const RED = "247;118;142";
const SLATE = "65;72;104";
const TEAL = "115;218;202";
const SILVER = "169;177;214";

const CTX: RenderContext = {
	width: 200,
	nowMs: NOW_MS,
	theme: "dark",
	glyphs: "powerline",
	colors: 24,
	measure: Bun.stringWidth,
};

/** The omp render suite's base session, as snapshot data. */
function raw(over: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		model: { name: "Opus 5.5", family: "claude-opus-5-5" },
		effort: "high",
		dir: { name: "my-app", relative: "", worktree: null },
		git: { branch: "main" },
		stats: { costUsd: 4.21, durationMs: 1_380_000, linesAdded: 0, linesRemoved: 0 },
		cache: { hitPct: null, ttlRemainingMs: 2_520_000 },
		context: { usedPct: 28, tokens: 283_000, windowSize: 1_000_000 },
		limits: [
			{ label: "5h", usedPct: 41, resetsAtMs: NOW_MS + 4_320_000, windowMs: 18_000_000 },
			{ label: "7d", usedPct: 18, resetsAtMs: NOW_MS + 280_000_000, windowMs: 604_800_000 },
		],
		...over,
	};
}

const snap = (over: Record<string, unknown> = {}, harness: HarnessId = "omp") => toSnapshot(harness, raw(over));
const strip = (s: string) => s.replace(/\x1b\][^\x07]*\x07/g, "").replace(/\x1b\[[0-9;]*m/g, "");
const rows = (s: StatusSnapshot, width = 200, ctx: Partial<RenderContext> = {}) => renderRows(s, { ...CTX, width, ...ctx });
const text = (s: StatusSnapshot, width = 200, ctx: Partial<RenderContext> = {}) => rows(s, width, ctx).map(strip);
/** The chip (`bg` background) that carries `label`. */
const chip = (bg: string, label: string) => `48;2;${bg}m ${label} `;

describe("formatters (opencode number formats, omp fmtDur/fmtTokens)", () => {
	test("tokens", () => {
		expect([999, 1000, 283_000, 1_000_000, 1_500_000, 1_050_000].map(formatTokens)).toEqual(["999", "1k", "283k", "1M", "1.5M", "1M"]);
	});

	test("duration", () => {
		expect([0, 59, 60, 2520, 3600, 4320, 86_400, 280_000].map(formatDuration)).toEqual([
			"<1m",
			"<1m",
			"1m",
			"42m",
			"1h",
			"1h12m",
			"1d",
			"3d5h",
		]);
	});

	test("cost always keeps two decimals", () => {
		expect([4.21, 0.5, 12, 0.005].map(formatCost)).toEqual(["$4.21", "$0.50", "$12.00", "$0.01"]);
	});

	test("time to limit: warns only when the average pace runs out before the reset", () => {
		expect(etaLimit(410, NOW_S + 4320, 18_000, NOW_S)).toBeUndefined();
		expect(etaLimit(720, NOW_S + 7200, 18_000, NOW_S)).toBe(4200);
		expect(etaLimit(1000, NOW_S + 100, 18_000, NOW_S)).toBe(0);
		// Under 5% of the window elapsed is too early to tell.
		expect(etaLimit(900, NOW_S + 17_500, 18_000, NOW_S)).toBeUndefined();
		expect(etaLimit(0, NOW_S + 100, 18_000, NOW_S)).toBeUndefined();
		expect(etaLimit(500, NOW_S - 1, 18_000, NOW_S)).toBeUndefined();
	});
});

describe("cells and emit (opencode emit, omp sgr256)", () => {
	test("ANSI runs reset before each style, links wrap their text, the row ends with a reset", () => {
		const cells: Cell[] = [
			{ text: " a ", fg: [26, 27, 38], bg: [187, 154, 247], bold: true },
			{ text: " #1 ", fg: [1, 2, 3], url: "https://x/1" },
			{ text: " " },
		];
		expect(emit(cells, 24)).toBe(
			"\x1b[0;1;38;2;26;27;38;48;2;187;154;247m a \x1b]8;;https://x/1\x07\x1b[0;38;2;1;2;3m #1 \x1b]8;;\x07\x1b[0;0m \x1b[0m",
		);
		expect(emit([], 24)).toBe("");
	});

	test("256 colors map to the nearest cube or gray-ramp entry (values checked against omp-statusline's rgb256)", () => {
		expect(rgb256(187, 154, 247)).toBe(141);
		expect(rgb256(65, 72, 104)).toBe(59);
		expect(rgb256(128, 128, 128)).toBe(244);
		expect(rgb256(0, 0, 0)).toBe(16);
		expect(rgb256(255, 255, 255)).toBe(231);
		expect(emit([{ text: "x", fg: [187, 154, 247], bg: [0, 0, 0] }], 256)).toBe("\x1b[0;38;5;141;48;5;16mx\x1b[0m");
	});

	test("clip cuts to the cell budget by grapheme and marks the cut", () => {
		expect(clip("feature/statusline", 40, Bun.stringWidth)).toBe("feature/statusline");
		expect(clip("abcdefgh", 5, Bun.stringWidth)).toBe("abcd…");
		expect(clip("코드베이스에서", 7, Bun.stringWidth)).toBe("코드베…");
		// A ZWJ family is one grapheme of width 2; it is kept whole or dropped, never split.
		const family = "👨‍👩‍👧";
		expect(clip(`${family}${family}x`, 4, Bun.stringWidth)).toBe(`${family}…`);
		expect(clip("abc", 0, Bun.stringWidth)).toBe("…");
	});
});

describe("rows (omp rows)", () => {
	test("a full session prints two rows, each ending in a reset", () => {
		const r = rows(snap());
		expect(r).toHaveLength(2);
		for (const row of r) expect(row.endsWith("\x1b[0m")).toBe(true);
	});

	test("without context or limits only the first row prints", () => {
		expect(rows(snap({ context: null, limits: [] }))).toHaveLength(1);
	});

	test("rows fit every width from 60 columns up", () => {
		const s = snap({
			dir: { name: "my-app", relative: "packages/web/src/components", worktree: null },
			git: { branch: "feature/a-very-long-branch-name-for-testing-purposes", modified: 1, untracked: 1 },
			stats: { costUsd: 4.21, durationMs: 1_380_000, linesAdded: 12, linesRemoved: 3 },
			pr: { number: 512, url: "https://x/pull/512", state: "pending" },
			limits: [...(raw().limits as object[]), { label: "Fable", usedPct: 25, resetsAtMs: NOW_MS + 280_000_000, scopedModel: "Fable" }],
		});
		for (let width = 60; width <= 200; width += 7) {
			for (const row of rows(s, width)) expect(Bun.stringWidth(strip(row))).toBeLessThanOrEqual(width);
		}
	});

	test("nothing is drawn below the minimum width", () => {
		expect(rows(snap(), 19)).toEqual([]);
		expect(rows(snap(), 43, { minimumWidth: 44 })).toEqual([]);
		expect(rows(snap(), 20).length).toBeGreaterThan(0);
	});

	test("an empty snapshot draws nothing and does not throw", () => {
		expect(rows(toSnapshot("codex", {}))).toEqual([]);
		expect(rows(toSnapshot("claude", null), 12)).toEqual([]);
	});

	test("the default measure counts code points when no width function is injected", () => {
		const { measure: _, ...plainCtx } = CTX;
		expect(renderRows(snap(), plainCtx)).toEqual(rows(snap()));
	});
});

describe("chips (omp chips, claude chips, opencode colors)", () => {
	test("the model chip is bold dark ink on the family color", () => {
		expect(rows(snap())[0]).toContain(`\x1b[0;1;38;2;26;27;38;48;2;${PURPLE}m Opus 5.5 `);
	});

	test("model families: claude, OpenAI, and the other providers OpenCode serves", () => {
		const cases: [string, string][] = [
			["claude-opus-5-5", PURPLE],
			["claude-sonnet-5-5", CYAN],
			["claude-haiku-4-5", TEAL],
			["claude-fable-1", ORANGE],
			["gpt-5.5", PURPLE],
			["gpt-6-astra", PURPLE],
			["o3-mini", PURPLE],
			["gemini-3-pro", BLUE],
			["deepseek-v4", PURPLE],
			["kimi-k3", CYAN],
			["glm-5.3", TEAL],
			["qwen3-coder", ORANGE],
			["grok-5", SLATE],
			["my-custom-model", SILVER],
		];
		for (const [family, bg] of cases) expect(modelColor(family).join(";")).toBe(bg);
	});

	test("effort colors run from red (max) to slate (low), synonyms included", () => {
		const cases: [string, string][] = [
			["max", RED],
			["ultra", RED],
			["xhigh", ORANGE],
			["extra-high", ORANGE],
			["high", YELLOW],
			["medium", TEAL],
			["mid", TEAL],
			["low", SLATE],
		];
		for (const [effort, bg] of cases) expect(rows(snap({ effort }))[0]).toContain(chip(bg, effort));
		expect(rows(snap({ effort: "low" }))[0]).toContain(`38;2;192;202;245;48;2;${SLATE}m low `);
	});

	test("no effort chip without an effort, and fast mode joins the effort chip", () => {
		expect(text(snap({ effort: "" }))[0]).not.toContain(" high ");
		expect(text(snap({ model: { name: "Opus 5.5", family: "claude-opus", isFast: true } }))[0]).toContain(" high·fast ");
		expect(text(snap({ effort: "", model: { name: "Opus 5.5", family: "claude-opus", isFast: true } }))[0]).toContain(" fast ");
	});

	test("chips are joined by powerline arrows in the next chip's colors", () => {
		expect(rows(snap())[0]).toContain(`38;2;${PURPLE};48;2;${YELLOW}m${ARROW}`);
		expect(rows(snap())[0]).toContain(`\x1b[0;38;2;${GREEN}m${ARROW}\x1b[0;0m  `);
	});

	test("same-colored neighbors use the thin separator", () => {
		const r = rows(snap({ git: { branch: "main", conflicts: 1 }, pr: { number: 7, url: "u", state: "changes_requested" } }))[0];
		expect(r).toContain(`38;2;26;27;38;48;2;${RED}m${THIN}`);
	});

	test("the directory chip is the repository name in blue", () => {
		expect(rows(snap())[0]).toContain(chip(BLUE, "my-app"));
	});

	test("a subdirectory shows relative to the checkout, deep ones elided", () => {
		expect(text(snap({ dir: { name: "my-app", relative: "packages" } }))[0]).toContain(" my-app/packages ");
		expect(text(snap({ dir: { name: "my-app", relative: "a/b" } }))[0]).toContain(" my-app/a/b ");
		expect(text(snap({ dir: { name: "my-app", relative: "a/b/c/d" } }))[0]).toContain(" my-app/…/c/d ");
	});

	test("a linked worktree name shows when it differs from the branch and the repository", () => {
		expect(text(snap({ dir: { name: "my-app", relative: "", worktree: "fix-login" } }))[0]).toContain(" my-app·fix-login ");
		const same = { dir: { name: "my-app", worktree: "fix-login" }, git: { branch: "fix-login" } };
		expect(text(snap(same))[0]).toContain(" my-app ");
		expect(text(snap({ dir: { name: "my-app", worktree: "my-app" } }))[0]).not.toContain("my-app·");
	});

	test("without a repository there is no git chip; without a directory no dir chip", () => {
		const t = text(snap({ dir: { name: "scratch" }, git: null }))[0];
		expect(t).toContain(" scratch ");
		expect(t).not.toContain(BRANCH);
		expect(text(snap({ dir: null }))[0]).not.toContain(chip(BLUE, ""));
	});

	test("long branches are cut to 40 cells when wide and 20 when narrow", () => {
		const long = `feature/${"x".repeat(60)}`;
		const s = snap({ git: { branch: long }, context: null, limits: [] });
		expect(text(s)[0]).toContain(`${long.slice(0, 39)}…`);
		expect(text(s, 40)[0]).toContain(`${long.slice(0, 19)}…`);
	});

	test("the git chip is green when clean, yellow with counts when dirty, red on conflicts", () => {
		expect(rows(snap())[0]).toContain(chip(GREEN, `${BRANCH} main`));
		const dirty = { branch: "main", ahead: 2, behind: 1, staged: 1, modified: 1, untracked: 1 };
		expect(rows(snap({ git: dirty }))[0]).toContain(chip(YELLOW, `${BRANCH} main ⇡2 ⇣1 +1 ~1 ?1`));
		expect(rows(snap({ git: { branch: "main", conflicts: 1 } }))[0]).toContain(chip(RED, `${BRANCH} main ✘1`));
	});

	test("a detached HEAD shows the short commit id", () => {
		expect(text(snap({ git: { branch: "", detachedOid: "ca8cb99aa1" } }))[0]).toContain(`${BRANCH} ca8cb99 `);
	});

	test("a GitHub pull request links to its page; GitLab uses the ! prefix", () => {
		const pr = rows(snap({ pr: { number: 512, url: "https://github.com/o/r/pull/512", state: "approved" } }))[0];
		expect(pr).toContain("\x1b]8;;https://github.com/o/r/pull/512\x07");
		expect(pr).toContain(chip(TEAL, "#512 ✓"));
		expect(text(snap({ pr: { number: 9, url: "u", state: "pending", kind: "mr" } }))[0]).toContain(" !9 ");
		expect(rows(snap({ pr: { number: 9, url: "u", state: "pending" } }))[0]).toContain(chip(CYAN, "#9"));
		expect(rows(snap({ pr: { number: 9, url: "u", state: "draft" } }))[0]).toContain(`38;2;192;202;245;48;2;${SLATE}m #9 draft `);
		expect(rows(snap({ pr: { number: 9, url: "u", state: "changes_requested" } }))[0]).toContain(chip(RED, "#9 ✗"));
	});

	test("running subagents and shells show in a cyan chip while they run (opencode counts)", () => {
		expect(rows(snap({ counts: { subagents: 2, shells: 1 } }))[0]).toContain(chip(CYAN, "◈ 2 ⌘ 1"));
		expect(text(snap({ counts: { subagents: 0, shells: 1 } }))[0]).toContain(" ⌘ 1 ");
		expect(text(snap({ counts: { subagents: 0, shells: 0 } }))[0]).not.toContain("◈");
	});
});

describe("session stats (omp/claude session stats, codex cache hit)", () => {
	test("cost, duration, changed lines and cache follow the chips", () => {
		const s = snap({ stats: { costUsd: 4.21, durationMs: 1_380_000, linesAdded: 156, linesRemoved: 23 } });
		expect(text(s)[0]).toEndWith(`${ARROW}  $4.21 · 23m · +156 −23 · cache 42m`);
	});

	test("zero, unknown, and sub-minute stats are hidden", () => {
		const t = text(snap({ stats: { costUsd: 0, durationMs: 59_000 }, cache: null }))[0];
		expect(t).not.toContain("$");
		expect(t).not.toContain("<1m");
		expect(t).not.toContain("cache");
		expect(t).not.toContain(" · ");
		expect(text(snap({ stats: { costUsd: null, durationMs: 0 } }))[0]).not.toContain("$");
	});

	test("only added or only removed lines print alone", () => {
		expect(text(snap({ stats: { linesAdded: 5 }, cache: null }))[0]).toEndWith("  +5");
		expect(text(snap({ stats: { linesRemoved: 4 }, cache: null }))[0]).toEndWith("  −4");
	});

	test("the cache hit rate shows when known; the countdown when the lifetime is known", () => {
		expect(text(snap({ cache: { hitPct: 87, ttlRemainingMs: null } }))[0]).toEndWith("cache hit 87%");
		expect(text(snap({ cache: { hitPct: 96, ttlRemainingMs: 300_000 } }))[0]).toEndWith("cache hit 96% · cache 5m");
		expect(text(snap({ cache: { hitPct: null, ttlRemainingMs: 0 } }))[0]).not.toContain("cache");
	});
});

describe("gauges (omp gauges, claude ctx/limits, codex placeholders)", () => {
	test("ctx shows the used percent and the token count over the window", () => {
		expect(text(snap())[1]).toStartWith("ctx ▆▆▆▆▆▆▆▆▆▆ 28% 283k/1M");
	});

	test("the bar fills, grades from green, and keeps a faint track", () => {
		const cells = renderCells(snap({ context: { usedPct: 88, tokens: 880_000, windowSize: 1_000_000 }, limits: [] }), CTX)[1]!;
		const bar = cells.filter((c) => c.text === "▆");
		expect(bar).toHaveLength(10);
		expect(bar.filter((c) => c.fg?.join(";") === "84;92;126")).toHaveLength(1);
		expect(bar[0]!.fg?.join(";")).toBe(GREEN);
		expect(bar[8]!.fg?.join(";")).toBe(RED);
		// 55% is between yellow and orange: an integer blend, as the shell and omp renderers compute it.
		expect(bar[5]!.fg?.join(";")).toBe("234;170;103");
	});

	test("percent colors follow the 50/65/80 thresholds", () => {
		const at = (usedPct: number) => rows(snap({ context: { usedPct, tokens: 1, windowSize: 10 } }))[1];
		expect(at(49)).toContain(`1;38;2;${GREEN}m49%`);
		expect(at(50)).toContain(`1;38;2;${YELLOW}m50%`);
		expect(at(65)).toContain(`1;38;2;${ORANGE}m65%`);
		expect(at(80)).toContain(`1;38;2;${RED}m80%`);
	});

	test("0% is a reading and shows; an unknown reading is a placeholder", () => {
		expect(text(snap({ context: { usedPct: 0, tokens: 0, windowSize: 1000 }, limits: [] }))[1]).toBe("ctx ▆▆▆▆▆▆▆▆▆▆ 0% 0/1k");
		const codex = snap({ context: { usedPct: null }, limits: [{ label: "5h", usedPct: 41 }, { label: "7d", usedPct: null }] }, "codex");
		expect(text(codex)[1]).toBe("ctx — │ 5h ▆▆▆▆▆▆▆▆ 41% │ 7d —");
		expect(rows(codex)[1]).toContain("\x1b[0;38;2;115;122;162m │ 7d —");
	});

	test("the token count turns yellow at the long-context rate", () => {
		const at = (tokens: number) => rows(snap({ context: { usedPct: 20, tokens, windowSize: 1_000_000 } }))[1];
		expect(at(199_000)).not.toContain(`38;2;${YELLOW}m 199k`);
		expect(at(201_000)).toContain(`38;2;${YELLOW}m 201k`);
		const flagged = snap({ context: { usedPct: 20, tokens: 150_000, windowSize: 1_000_000, exceeds200k: true } });
		expect(rows(flagged)[1]).toContain(`38;2;${YELLOW}m 150k`);
	});

	test("no token count without a window size", () => {
		expect(text(snap({ context: { usedPct: 30, tokens: 5000, windowSize: 0 }, limits: [] }))[1]).toBe("ctx ▆▆▆▆▆▆▆▆▆▆ 30%");
	});

	test("limits show the used percent and the time to reset", () => {
		expect(text(snap())[1]).toContain("5h ▆▆▆▆▆▆▆▆ 41% ↻1h12m │ 7d ▆▆▆▆▆▆▆▆ 18% ↻3d5h");
	});

	test("a limit on pace to run out before it resets warns with the time left", () => {
		const t = text(snap({ limits: [{ label: "5h", usedPct: 72, resetsAtMs: NOW_MS + 7_200_000 }] }))[1];
		expect(t).toContain("72% ⚠~1h10m ↻2h");
		const full = text(snap({ limits: [{ label: "5h", usedPct: 100, resetsAtMs: NOW_MS + 600_000 }] }))[1];
		expect(full).toContain("100% ⚠ ↻10m");
	});

	test("no warning on pace, and no countdown once the reset has passed or is unknown", () => {
		expect(text(snap({ limits: [{ label: "5h", usedPct: 10, resetsAtMs: NOW_MS - 10_000 }] }))[1]).toEndWith("5h ▆▆▆▆▆▆▆▆ 10%");
		expect(text(snap({ limits: [{ label: "5h", usedPct: 10, resetsAtMs: null }] }))[1]).toEndWith("5h ▆▆▆▆▆▆▆▆ 10%");
	});

	test("a tier-scoped limit follows 7d and is the last gauge to drop", () => {
		const s = snap({
			limits: [...(raw().limits as object[]), { label: "Fable", usedPct: 25, resetsAtMs: NOW_MS + 280_000_000, scopedModel: "Fable" }],
		});
		expect(text(s)[1]).toEndWith("7d ▆▆▆▆▆▆▆▆ 18% ↻3d5h │ Fable ▆▆▆▆▆▆▆▆ 25% ↻3d5h");
		expect(text(s, 30)[1]).toBe("ctx 28% │ 5h 41% │ 7d 18%");
	});

	test("narrow terminals shrink the bars before dropping anything, then hide the row", () => {
		expect(text(snap(), 70)[1]).toBe("ctx ▆▆▆▆▆▆▆▆ 28% 283k/1M │ 5h ▆▆▆▆▆▆ 41% ↻1h12m │ 7d ▆▆▆▆▆▆ 18% ↻3d5h");
		expect(text(snap(), 50)[1]).toBe("ctx 28% 283k/1M │ 5h 41% ↻1h12m │ 7d 18% ↻3d5h");
		expect(text(snap(), 40)[1]).toBe("ctx 28% │ 5h 41% ↻1h12m │ 7d 18% ↻3d5h");
		expect(text(snap(), 30)[1]).toBe("ctx 28% │ 5h 41% │ 7d 18%");
		expect(text(snap(), 24)).toHaveLength(1);
	});
});

describe("row 1 ladder (opencode narrow-terminal order, claude drop order)", () => {
	const wide = snap(
		{
			model: { name: "Opus 5.5", family: "claude-opus" },
			effort: "max",
			dir: { name: "my-app", relative: "src/lib/statusline" },
			git: { branch: "feature/statusline", ahead: 2, staged: 1, modified: 3, untracked: 1 },
			pr: null,
			counts: { subagents: 2, shells: 0 },
			stats: { costUsd: 4.21, durationMs: 1_380_000, linesAdded: 156, linesRemoved: 23 },
			cache: { hitPct: null, ttlRemainingMs: 2_520_000 },
		},
		"opencode",
	);

	test("the wide row carries every chip and stat", () => {
		expect(text(wide)[0]).toBe(
			` Opus 5.5 ${ARROW} max ${ARROW} my-app/…/lib/statusline ${ARROW} ${BRANCH} feature/statusline ⇡2 +1 ~3 ?1 ${ARROW} ◈ 2 ${ARROW}  $4.21 · 23m · +156 −23 · cache 42m`,
		);
	});

	test("cache, lines, duration, cost, PR and effort drop in that order, then the directory shortens and goes", () => {
		const levels = [
			[200, "cache 42m"],
			[119, "cache 42m"],
			[107, "+156"],
			[96, "23m"],
			[90, "$4.21"],
			[83, "max"],
			[77, "my-app/…/lib/statusline"],
			[60, "my-app"],
		] as const;
		for (const [width, gone] of levels) {
			const t = text(wide, width)[0]!;
			expect(Bun.stringWidth(t)).toBeLessThanOrEqual(width);
			if (width === 200) expect(t).toContain(gone);
			else expect(t).not.toContain(gone);
		}
		expect(text(wide, 74)[0]).toContain(" my-app ");
		expect(text(wide, 60)[0]).toContain("feature/statusline");
	});

	test("the branch is cut short before the directory chip goes", () => {
		const long = toSnapshot("opencode", { ...wide, git: { ...wide.git, branch: "feature/a-very-long-branch-name" } });
		expect(text(long, 200)[0]).toContain("feature/a-very-long-branch-name");
		expect(text(long, 74)[0]).toContain("feature/a-very-long…");
		expect(text(long, 74)[0]).toContain(" my-app ");
		expect(text(long, 60)[0]).toContain("feature/a-very-long…");
		expect(text(long, 60)[0]).not.toContain("my-app");
	});

	test("the last level still prints when even it overflows", () => {
		expect(text(wide, 30)[0]).toBe(` Opus 5.5 ${ARROW} ${BRANCH} feature/statusline ⇡2 +1 ~3 ?1 ${ARROW} ◈ 2 ${ARROW}`);
	});
});

describe("options (omp options, opencode plain/light)", () => {
	test("plain glyphs avoid private-use characters and keep chips apart", () => {
		const r = rows(snap(), 200, { glyphs: "plain" })[0]!;
		expect(/[\ue000-\uf8ff]/.test(r)).toBe(false);
		expect(r).toContain(`${chip(PURPLE, "Opus 5.5")}\x1b[0;0m \x1b[0;38;2;26;27;38;48;2;${YELLOW}m high `);
		expect(text(snap({ git: { branch: "main", ahead: 1, behind: 2 } }), 200, { glyphs: "plain" })[0]).toContain(" main ↑1 ↓2 ");
	});

	test("256 colors replace every truecolor parameter", () => {
		const r = rows(snap(), 200, { colors: 256 }).join("");
		expect(r).not.toMatch(/[34]8;2;/);
		expect(r).toContain("48;5;");
		expect(strip(r)).toContain("cache 42m");
	});

	test("the light theme uses the light ink palette", () => {
		expect(rows(snap({ context: { usedPct: 10, tokens: 1, windowSize: 10 } }), 200, { theme: "light" })[1]).toContain(
			"1;38;2;88;117;57m10%",
		);
		expect(rows(snap(), 200, { theme: "light" })[0]).toContain("38;2;104;112;154m23m");
	});
});

describe("CJK and emoji widths", () => {
	test("wide labels count two cells when the width function knows them", () => {
		const s = snap({ dir: { name: "내-프로젝트", relative: "" }, git: { branch: "기능/상태줄-👨‍👩‍👧" } });
		for (const width of [200, 90, 60, 45]) {
			for (const row of rows(s, width)) expect(Bun.stringWidth(strip(row))).toBeLessThanOrEqual(Math.max(width, 45));
		}
		expect(text(s)[0]).toContain(" 내-프로젝트 ");
		expect(text(s)[0]).toContain("기능/상태줄-👨‍👩‍👧");
	});
});

describe("agent panel (claude --subagents)", () => {
	const NOW = NOW_MS;
	function agent(over: Record<string, unknown> = {}) {
		return {
			id: "a1",
			name: "reviewer",
			label: "Reading statusline.sh",
			startedAtMs: NOW - 200_000,
			model: "claude-opus-5-5[1m]",
			effort: "high",
			windowSize: 1_000_000,
			tokens: 312_000,
			status: "running",
			...over,
		};
	}
	const panel = (agents: object[], width = 120, ctx: Partial<RenderContext> = {}): Record<string, string> => {
		const s = toSnapshot("claude", { agents });
		const out: Record<string, string> = {};
		for (const row of renderAgentRows(s.agents ?? [], { ...CTX, width, ...ctx }) as AgentRow[]) out[row.id] = emit(row.cells, 24);
		return out;
	};

	test("a row shows model, effort, name and label", () => {
		expect(strip(panel([agent()]).a1!)).toMatch(/^ Opus 5\.5 .*high .*reviewer · Reading statusline\.sh/);
	});

	test("model ids become family and version", () => {
		const cases: Record<string, string> = {
			"claude-opus-5-5[1m]": "Opus 5.5",
			"claude-haiku-4-5-20251001": "Haiku 4.5",
			"claude-sonnet-4-20250514": "Sonnet 4",
			"claude-3-5-sonnet-20241022": "Sonnet 3.5",
			"us.anthropic.claude-sonnet-4-5-20250929-v1:0": "Sonnet 4.5",
			"claude-opus-4-1@20250805": "Opus 4.1",
			"my-custom-model": "my-custom-model",
		};
		for (const [model, label] of Object.entries(cases)) {
			expect(agentModelLabel(model)).toBe(label);
			expect(strip(panel([agent({ model })]).a1!)).toStartWith(` ${label} `);
		}
	});

	test("the model chip uses the family color", () => {
		expect(panel([agent({ model: "claude-haiku-4-5-20251001" })]).a1).toContain(`48;2;${TEAL}m Haiku 4.5 `);
	});

	test("the ctx gauge shows the agent's own usage; without a window only the token count", () => {
		const v = strip(panel([agent({ tokens: 148_000, windowSize: 200_000 })]).a1!);
		expect(v).toContain("ctx");
		expect(v).toContain("74%");
		expect(v).toContain("148k/200k");
		const bare = strip(panel([agent({ windowSize: 0, tokens: 5000 })]).a1!);
		expect(bare).not.toContain("ctx");
		expect(bare).toContain("5k tok");
	});

	test("no effort chip when the effort is inherited", () => {
		const v = strip(panel([agent({ effort: "" })]).a1!);
		expect(v).not.toContain("high");
		expect(v).toContain("Opus 5.5");
	});

	test("status marks and running time", () => {
		const r = panel([
			agent({ id: "run" }),
			agent({ id: "ok", status: "completed" }),
			agent({ id: "bad", status: "failed" }),
			agent({ id: "kill", status: "killed" }),
			agent({ id: "wait", status: "paused" }),
			agent({ id: "new", startedAtMs: NOW - 42_000 }),
			agent({ id: "nostart", startedAtMs: null }),
		]);
		expect(strip(r.run!)).toEndWith("· 3m");
		expect(strip(r.new!)).toEndWith("· 42s");
		expect(strip(r.ok!)).toEndWith("· ✓");
		expect(r.ok).toContain(`1;38;2;${GREEN}m✓`);
		expect(strip(r.bad!)).toEndWith("· ✘");
		expect(r.bad).toContain(`1;38;2;${RED}m✘`);
		expect(strip(r.kill!)).toEndWith("· ✘");
		expect(strip(r.wait!)).toEndWith("· paused");
		expect(strip(r.nostart!)).toEndWith("312k/1M");
	});

	test("gauges line up in one column, CJK labels included", () => {
		const r = panel([
			agent({ id: "x" }),
			agent({ id: "y", name: "", label: "코드베이스에서 인증 핸들러 찾기", model: "claude-haiku-4-5-20251001" }),
		]);
		const columns = Object.values(r).map((row) => Bun.stringWidth(strip(row).slice(0, strip(row).indexOf("ctx"))));
		expect(new Set(columns).size).toBe(1);
	});

	test("rows fit the given columns", () => {
		const agents = [
			agent(),
			agent({ id: "k", name: "", model: "claude-haiku-4-5-20251001", effort: "max", label: "코드베이스에서 인증 핸들러 위치를 찾아서 정리하고 요약하기" }),
			agent({ id: "c", status: "completed", label: "x".repeat(300) }),
		];
		for (const width of [200, 100, 80, 60, 45, 32]) {
			for (const content of Object.values(panel(agents, width))) expect(Bun.stringWidth(strip(content))).toBeLessThanOrEqual(width);
		}
	});

	test("narrow rows drop details before the gauge; too narrow keeps the default rows", () => {
		const v = strip(panel([agent()], 34).a1!);
		expect(v).toContain("Opus 5.5");
		expect(v).toContain("ctx 31%");
		expect(v).not.toContain("high");
		expect(panel([agent()], 12)).toEqual({});
	});

	test("labels are sanitized into one line, and a label equal to the name is not repeated", () => {
		const r = panel([agent({ label: 'say "hi"\n\tthen\x1b[31m \\ leave' })]);
		expect(strip(r.a1!)).toContain('say "hi" then \\ leave');
		expect(r.a1).not.toContain("\n");
		const same = strip(panel([agent({ label: "Review the diff", name: "Review the diff" })]).a1!);
		expect(same.split("Review the diff")).toHaveLength(2);
	});

	test("plain glyphs avoid private-use characters; no agents, no rows", () => {
		expect(/[\ue000-\uf8ff]/.test(panel([agent()], 120, { glyphs: "plain" }).a1!)).toBe(false);
		expect(renderAgentRows([], CTX)).toEqual([]);
	});
});

describe("demo cases", () => {
	test("one case per harness, each with two rows at 120 columns", () => {
		const cases = demoCases(NOW_MS);
		expect(cases.map((c) => c.snapshot.harness)).toEqual(["claude", "codex", "omp", "opencode"]);
		for (const c of cases) expect(renderRows(c.snapshot, { ...CTX, width: 120 })).toHaveLength(2);
	});
});

describe("golden rows across the width spectrum", () => {
	const WIDTHS = [200, 120, 112, 100, 90, 74, 60, 45, 44, 12];
	const goldenFile = Bun.file(new URL("../fixtures/golden/rows.json", import.meta.url));

	test("every harness fixture at every width matches the golden output", async () => {
		const actual: Record<string, Record<string, string[]>> = {};
		for (const harness of ["claude", "codex", "omp", "opencode"] as const) {
			const fixture = await Bun.file(new URL(`../fixtures/snapshots/${harness}.json`, import.meta.url)).json();
			const s = toSnapshot(harness, fixture);
			actual[harness] = {};
			for (const width of WIDTHS) actual[harness][width] = rows(s, width);
		}
		if (Bun.env.UPDATE_GOLDEN === "1") await Bun.write(goldenFile, `${JSON.stringify(actual, null, 1)}\n`);
		expect(actual).toEqual(await goldenFile.json());
	});
});
