// Byte parity with the original claude-code-statusline/statusline.sh.
//
// test/fixtures/claude/golden.json holds three sessions without time-dependent fields (no reset
// times, start times or cache expiry) and, for each, the exact bytes statusline.sh printed. It was
// generated once from the reference with:
//
//   COLUMNS=<columns> STATUSLINE_GIT_RAW=<gitRaw> STATUSLINE_USAGE_RAW=<usageRaw> \
//   STATUSLINE_THEME=... [STATUSLINE_GLYPHS=...] [COLORTERM=...] \
//   bash ~/Workspace/claude-code-statusline/statusline.sh < session.json
//
// The reference is never executed here; the stored bytes are the expectation.

import { afterEach, describe, expect, test } from "bun:test";
import type { LimitWindow } from "../../../src/domain/model/snapshot.ts";
import golden from "../../fixtures/claude/golden.json";
import { cleanTemps, harness, render } from "./support.ts";

afterEach(cleanTemps);

interface Case {
	name: string;
	columns: number;
	env: Record<string, string | undefined>;
	session: Record<string, unknown>;
	gitRaw: string;
	usageRaw: string;
	expected: string;
}

/** The scoped windows of a `<label> <tenths> <resets_at>` usage line, as the reference read them. */
function scopedWindows(raw: string): LimitWindow[] {
	return raw
		.split("\n")
		.filter(Boolean)
		.map((line) => {
			const [label = "", tenths = "0", resetsAt = "0"] = line.split(" ");
			return { label, usedPct: Number(tenths) / 10, resetsAtMs: Number(resetsAt) * 1000 || null, windowMs: 604_800_000, scopedModel: label };
		});
}

const cases: Case[] = golden;

describe("output equals statusline.sh's", () => {
	for (const c of cases) {
		test(c.name, async () => {
			const diff = /# diff\.lines (\d+) (\d+)/.exec(c.gitRaw);
			const h = harness({
				git: c.gitRaw,
				lines: diff ? [Number(diff[1]), Number(diff[2])] : [0, 0],
				env: { COLUMNS: String(c.columns), STATUSLINE_THEME: undefined, COLORTERM: undefined, ...c.env },
			});
			h.cache.write("claude-usage", scopedWindows(c.usageRaw));
			const { out } = await render(h, c.session);
			expect(out).toBe(c.expected);
		});
	}

	test("the fixtures are two-row captures at three different widths", () => {
		expect(cases.map((c) => [c.columns, c.expected.split("\n").length])).toEqual([[140, 2], [80, 2], [52, 2]]);
	});
});
