// The subagentStatusLine protocol (`main.ts --subagents`): stdin {columns, tasks[]}, stdout one
// {"id","content"} JSON line per row. Ported from test_statusline.py's --subagents tests; the
// row layout itself is covered by test/domain/render.test.ts ("agent panel").

import { afterEach, describe, expect, test } from "bun:test";
import { cleanTemps, COLORS, colorBefore, DELETE, type Harness, harness, NOW_S, render, strip } from "./support.ts";

afterEach(cleanTemps);

const TEAL = COLORS.teal;
const RED = COLORS.red;

function task(over: Record<string, unknown> = {}): Record<string, unknown> {
	const data: Record<string, unknown> = {
		id: "a1",
		name: "reviewer",
		type: "local_agent",
		status: "running",
		description: "Review the diff",
		label: "Reading statusline.sh",
		startTime: (NOW_S - 200) * 1000,
		model: "claude-opus-5-5[1m]",
		effort: "high",
		contextWindowSize: 1_000_000,
		tokenCount: 312_000,
		tokenSamples: [300_000, 312_000],
		cwd: "/tmp",
	};
	for (const [key, value] of Object.entries(over)) {
		if (value === DELETE) delete data[key];
		else data[key] = value;
	}
	return data;
}

const SHELL_TASK = { id: "b1", type: "local_bash", status: "running", description: "npm test", startTime: NOW_S * 1000, tokenCount: 0, tokenSamples: [], cwd: "/tmp" };

/** The rows `--subagents` prints as {id: content}; asserts every line is a valid row object. */
async function panel(tasks: unknown[], columns = 120, h: Harness = harness()): Promise<Record<string, string>> {
	const { out } = await render(h, { session_id: "t", cwd: "/tmp", columns, tasks }, ["--subagents"]);
	const rows: Record<string, string> = {};
	if (out) expect(out.endsWith("\n")).toBe(true);
	for (const line of out.split("\n").filter(Boolean)) {
		const row = JSON.parse(line);
		expect(Object.keys(row).sort()).toEqual(["content", "id"]);
		expect(typeof row.content).toBe("string");
		rows[row.id] = row.content;
	}
	return rows;
}

describe("--subagents protocol", () => {
	test("only tasks with a model get a row; the others keep the default", async () => {
		expect(Object.keys(await panel([task(), SHELL_TASK]))).toEqual(["a1"]);
	});

	test("one JSON line per row, in task order, content on a single line", async () => {
		const { out } = await render(harness(), { columns: 120, tasks: [task({ id: "x" }), task({ id: "y" }), task({ id: "z" })] }, ["--subagents"]);
		expect(out.split("\n")).toHaveLength(4);
		expect(out.split("\n").slice(0, 3).map((line) => JSON.parse(line).id)).toEqual(["x", "y", "z"]);
	});

	test("a row shows model, effort, name and label", async () => {
		expect(strip((await panel([task()])).a1!)).toMatch(/Opus 5\.5 .*high .*reviewer · Reading statusline\.sh/);
	});

	test("the label falls back to the description, and is not repeated when it equals the name", async () => {
		expect(strip((await panel([task({ label: DELETE })])).a1!)).toContain("Review the diff");
		expect(strip((await panel([task({ label: DELETE, name: "Review the diff" })])).a1!).split("Review the diff")).toHaveLength(2);
	});

	test("model ids become family and version, in the family color", async () => {
		const cases: Record<string, string> = {
			"claude-opus-5-5[1m]": "Opus 5.5",
			"claude-haiku-4-5-20251001": "Haiku 4.5",
			"claude-sonnet-4-20250514": "Sonnet 4",
			"claude-3-5-sonnet-20241022": "Sonnet 3.5",
			"us.anthropic.claude-sonnet-4-5-20250929-v1:0": "Sonnet 4.5",
			"claude-opus-4-1@20250805": "Opus 4.1",
			"my-custom-model": "my-custom-model",
		};
		for (const [model, label] of Object.entries(cases)) expect(strip((await panel([task({ model })])).a1!)).toStartWith(` ${label} `);
		const haiku = (await panel([task({ model: "claude-haiku-4-5-20251001" })])).a1!;
		expect(colorBefore(haiku, "Haiku 4.5")).toContain(`48;2;${TEAL}`);
	});

	test("the ctx gauge shows the task's own usage; without a window only the token count", async () => {
		const v = strip((await panel([task({ tokenCount: 148_000, contextWindowSize: 200_000 })])).a1!);
		expect(v).toContain("ctx");
		expect(v).toContain("74%");
		expect(v).toContain("148k/200k");
		const bare = strip((await panel([task({ contextWindowSize: DELETE, tokenCount: 5000 })])).a1!);
		expect(bare).not.toContain("ctx");
		expect(bare).toContain("5k tok");
	});

	test("numeric strings count for token and window size", async () => {
		expect(strip((await panel([task({ tokenCount: "148000", contextWindowSize: "200000" })])).a1!)).toContain("148k/200k");
		expect(await panel([task()], "0" as unknown as number)).toEqual({});
	});

	test("no effort chip when the effort is inherited", async () => {
		const v = strip((await panel([task({ effort: DELETE })])).a1!);
		expect(v).not.toContain("high");
		expect(v).toContain("Opus 5.5");
	});

	test("a numeric effort is a token budget: 32000 → 32k, below 1000 as is", async () => {
		expect(strip((await panel([task({ effort: 32_000 })])).a1!)).toContain(" 32k ");
		expect(strip((await panel([task({ effort: 999 })])).a1!)).toContain(" 999 ");
		expect(strip((await panel([task({ effort: 1500 })])).a1!)).toContain(" 1k ");
	});

	test("status marks and running time; a start time counts in milliseconds or seconds", async () => {
		const rows = await panel([
			task({ id: "run" }),
			task({ id: "ok", status: "completed" }),
			task({ id: "bad", status: "failed" }),
			task({ id: "new", startTime: (NOW_S - 42) * 1000 }),
			task({ id: "secs", startTime: NOW_S - 200 }),
			task({ id: "none", startTime: DELETE }),
		]);
		expect(strip(rows.run!)).toEndWith("· 3m");
		expect(strip(rows.secs!)).toEndWith("· 3m");
		expect(strip(rows.new!)).toEndWith("· 42s");
		expect(strip(rows.ok!)).toEndWith("· ✓");
		expect(strip(rows.bad!)).toEndWith("· ✘");
		expect(colorBefore(rows.bad!, "✘")).toContain(RED);
		expect(strip(rows.none!)).toEndWith("312k/1M");
	});

	test("gauges line up in one column, CJK labels included", async () => {
		const rows = await panel([task({ id: "x" }), task({ id: "y", name: "", label: "코드베이스에서 인증 핸들러 찾기", model: "claude-haiku-4-5-20251001" })]);
		const columns = Object.values(rows).map((row) => {
			const v = strip(row);
			return Bun.stringWidth(v.slice(0, v.indexOf("ctx")));
		});
		expect(new Set(columns).size).toBe(1);
	});

	test("rows fit the given columns", async () => {
		const tasks = [
			task(),
			task({ id: "k", name: "", model: "claude-haiku-4-5-20251001", effort: "max", label: "코드베이스에서 인증 핸들러 위치를 찾아서 정리하고 요약하기" }),
			task({ id: "c", status: "completed", label: "x".repeat(300) }),
		];
		for (const columns of [200, 100, 80, 60, 45, 32]) {
			for (const content of Object.values(await panel(tasks, columns))) expect(Bun.stringWidth(strip(content))).toBeLessThanOrEqual(columns);
		}
	});

	test("narrow rows drop details before the gauge; too narrow keeps the default rows", async () => {
		const v = strip((await panel([task()], 34)).a1!);
		expect(v).toContain("Opus 5.5");
		expect(v).toContain("ctx 31%");
		expect(v).not.toContain("high");
		expect(await panel([task()], 12)).toEqual({});
	});

	test("the label is sanitized into one line", async () => {
		const label = async (raw: string, over: Record<string, unknown> = {}) => strip((await panel([task({ label: raw, ...over })])).a1!);
		expect(await label('say "hi"\n\tthen \\ leave')).toContain('say "hi" then \\ leave');
		expect(await label("a\nb\tc\r\nd")).toContain("· a b c d");
		// An ESC sequence (CSI colour, OSC title) is removed whole, not left as visible bracket text.
		expect(await label("x\x1b[31mred\x1b[0m y")).toContain("· x red y");
		expect(await label("t\x1b]0;title\x07ail")).toContain("· t ail");
		// C0, DEL, C1, zero-width space, direction marks and bidi characters, and whitespace runs, become one space.
		expect(await label("a\x00\x07\x7f\x85\x9fb")).toContain("· a b");
		expect(await label("a\u200b\u200e\u200fb")).toContain("· a b");
		// ZWJ stays, so an emoji family remains one grapheme.
		expect(await label("team 👨‍👩‍👧")).toContain("· team 👨‍👩‍👧");
		expect(await label("a\u202a\u202e\u2066\u2069b")).toContain("· a b");
		expect(await label("a   \u00a0 \n  b")).toContain("· a b");
		const rows = await panel([task({ label: "a\r\nb\x1b[2Jc" })]);
		expect(rows.a1).not.toMatch(/[\r\n]/);
		expect(rows.a1).not.toContain("\x1b[2J");
	});

	test("the label is capped at 200 graphemes, never splitting one", async () => {
		const wide = (raw: string) => panel([task({ label: raw, name: "" })], 900).then((rows) => strip(rows.a1!));
		expect(await wide("x".repeat(300))).toContain("x".repeat(200));
		expect(await wide("x".repeat(300))).not.toContain("x".repeat(201));
		// CJK: 200 characters are kept, one per grapheme.
		const cjk = await wide("가".repeat(250));
		expect(cjk).toContain("가".repeat(200));
		expect(cjk).not.toContain("가".repeat(201));
		// A skin-tone emoji is 4 UTF-16 code units but one grapheme; the boundary falls on whole ones.
		// A ZWJ family is one grapheme as well.
		const zwj = await wide(`${"x".repeat(199)}👨‍👩‍👧👨‍👩‍👧`);
		expect(zwj).toContain(`${"x".repeat(199)}👨‍👩‍👧`);
		expect(zwj).not.toContain("👨‍👩‍👧👨‍👩‍👧");
		const family = "👍🏽";
		expect(await wide(`${"x".repeat(199)}${family}${family}`)).toContain(`${"x".repeat(199)}${family}`);
		expect(await wide(`${"x".repeat(199)}${family}${family}`)).not.toContain(`${family}${family}`);
		// Flags are two code points per grapheme.
		expect(await wide("🇰🇷".repeat(250))).toContain("🇰🇷".repeat(200));
		expect(await wide("🇰🇷".repeat(250))).not.toContain("🇰🇷".repeat(201));
		// Combining marks stay with their base.
		expect(await wide(`${"e\u0301".repeat(250)}`)).not.toContain("e\u0301".repeat(201));
	});

	test("a label equal to the name is dropped, also after sanitizing", async () => {
		const row = strip((await panel([task({ name: "reviewer", label: "  reviewer\n" })])).a1!);
		expect(row.split("reviewer")).toHaveLength(2);
	});

	test("all four statuses: running shows time, paused a word, completed ✓, failed ✘, killed ✘", async () => {
		const rows = await panel(["running", "paused", "completed", "failed", "killed"].map((status) => task({ id: status, status })));
		expect(strip(rows.running!)).toEndWith("· 3m");
		expect(strip(rows.paused!)).toEndWith("· paused");
		expect(strip(rows.completed!)).toEndWith("· ✓");
		expect(strip(rows.failed!)).toEndWith("· ✘");
		expect(strip(rows.killed!)).toEndWith("· ✘");
		expect(colorBefore(rows.completed!, "✓")).toContain(COLORS.green);
		expect(colorBefore(rows.failed!, "✘")).toContain(RED);
	});

	test("narrowing only removes text: the label is cut first, then the bar, token count, effort and running time drop", async () => {
		const seen = async (columns: number) => {
			const row = (await panel([task()], columns)).a1;
			return row === undefined ? null : strip(row);
		};
		const wide = (await seen(160))!;
		expect(wide).toContain("Reading statusline.sh");
		expect(wide).toContain("high");
		expect(wide).toContain("312k/1M");
		let previous = wide.length;
		let last = wide;
		// The row only ever loses text as it narrows, and shrinks within every width.
		for (const columns of [120, 100, 80, 70, 60, 50, 44, 40, 36, 32, 28, 24, 20]) {
			const v = await seen(columns);
			if (v === null) break;
			expect(Bun.stringWidth(v)).toBeLessThanOrEqual(columns);
			expect(v.length).toBeLessThanOrEqual(previous);
			previous = v.length;
			last = v;
		}
		// The narrowest row that fits keeps the model chip and the gauge, and has lost the label and effort.
		expect(last).toContain("Opus 5.5");
		expect(last).not.toContain("Reading");
		expect(last).not.toContain("high");
		expect(last).not.toContain("312k/1M");
	});

	test("12 columns: no rows, so the host keeps its default rows", async () => {
		expect(await panel([task(), task({ id: "b", status: "completed" })], 12)).toEqual({});
		const { out } = await render(harness(), { columns: 12, tasks: [task()] }, ["--subagents"]);
		expect(out).toBe("");
	});

	test("plain glyphs avoid private-use characters; the theme and color depth follow the settings", async () => {
		const plain = await panel([task()], 120, harness({ env: { STATUSLINE_GLYPHS: "plain" } }));
		expect(/[\ue000-\uf8ff]/.test(plain.a1!)).toBe(false);
		const light = await panel([task()], 120, harness({ env: { STATUSLINE_THEME: "light", COLORTERM: undefined } }));
		expect(light.a1).toContain("38;5;");
		expect(light.a1).not.toMatch(/[34]8;2;/);
	});

	test("an unset theme asks the desktop appearance", async () => {
		const h = harness({ env: { STATUSLINE_THEME: undefined } });
		h.appearance.value = "light";
		expect((await panel([task()], 120, h)).a1).toContain(`38;2;${COLORS.lightDim}`);
	});

	test("prints nothing without tasks, with shell tasks only, or for unusable input", async () => {
		expect(await panel([])).toEqual({});
		expect(await panel([SHELL_TASK])).toEqual({});
		for (const stdin of ["", "{ not json", "null", "[]", '{"columns": 80}', '{"columns": 80, "tasks": "x"}', '{"tasks": [{"id": "a", "model": "claude-opus-5-5"}]}']) {
			expect((await render(harness(), stdin, ["--subagents"])).out).toBe("");
		}
	});

	test("the config file can switch the panel off", async () => {
		const h = harness();
		h.deps.configFile = { raw: { subagents: false } };
		expect(await panel([task()], 120, h)).toEqual({});
	});
});
