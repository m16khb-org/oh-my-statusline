import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dayKey, sinceDay, todayCost } from "../../src/application/stats/aggregate.ts";
import type { HarnessSummary, StatsSummary } from "../../src/application/stats/model.ts";
import { stats } from "../../src/cli/stats.ts";
import { collectStats } from "../../src/infrastructure/stats/collect.ts";
import type { Home } from "./helpers.ts";
import { makeHome, NOW, runJson } from "./helpers.ts";

let h: Home;
beforeEach(() => {
	h = makeHome();
});
afterEach(() => h.cleanup());

function harness(summary: StatsSummary, id: string): HarnessSummary {
	const found = summary.harnesses.find((x) => x.harness === id);
	if (!found) throw new Error(`no ${id}`);
	return found;
}

function model(summary: HarnessSummary, id: string) {
	const found = summary.models.find((m) => m.model === id);
	if (!found) throw new Error(`no ${id}`);
	return found;
}

describe("fixture totals", () => {
	test("claude: streamed duplicates collapse, synthetic skipped, cost-state deltas, subagent shares the session", () => {
		const c = harness(runJson(h), "claude");
		expect(c.sessions).toBe(2);
		expect(c.costUsd).toBe(0.75);
		expect(c.costSessions).toBe(1);
		expect(c.tokens).toEqual({ input: 136, output: 298, cacheRead: 303, cacheWrite: 1004, unsplit: 0, total: 1741 });
		const opus = model(c, "claude-opus-test");
		expect(opus).toMatchObject({ sessions: 1, costUsd: 0.75, costSessions: 1, firstActivity: "2026-10-15T10:00:06.000Z", lastActivity: "2026-10-16T01:00:00.000Z" });
		expect(opus.tokens).toEqual({ input: 31, output: 92, cacheRead: 303, cacheWrite: 1004, unsplit: 0, total: 1430 });
		expect(model(c, "claude-sonnet-test")).toMatchObject({ sessions: 1, costUsd: null, costSessions: 0 });
		expect(model(c, "claude-haiku-test")).toMatchObject({ sessions: 1, costUsd: null });
	});

	test("codex: cumulative totals become deltas, re-emitted totals ignored, orphan thread rows add unsplit tokens", () => {
		const c = harness(runJson(h), "codex");
		expect(c.sessions).toBe(3);
		expect(c.costUsd).toBeNull();
		expect(c.tokens).toEqual({ input: 1000, output: 300, cacheRead: 2000, cacheWrite: 0, unsplit: 5700, total: 9000 });
		expect(c.models.map((m) => m.model)).toEqual(["gpt-test-mini", "gpt-astra-test", "unknown"]);
		expect(model(c, "gpt-astra-test").tokens).toEqual({ input: 500, output: 250, cacheRead: 2000, cacheWrite: 0, unsplit: 0, total: 2750 });
		expect(model(c, "gpt-test-mini")).toMatchObject({ sessions: 2, tokens: { input: 500, output: 50, unsplit: 5000, total: 5550 } });
		expect(model(c, "unknown").tokens.unsplit).toBe(700);
	});

	test("omp: stored cost.total per response, model_usage and subagent files counted", () => {
		const o = harness(runJson(h), "omp");
		expect(o.sessions).toBe(3);
		expect(o.costUsd).toBe(0.19205);
		expect(o.costSessions).toBe(3);
		expect(o.tokens).toEqual({ input: 588, output: 262, cacheRead: 7754, cacheWrite: 19480, unsplit: 0, total: 28084 });
		expect(model(o, "claude-opus-test").costUsd).toBe(0.16);
		expect(model(o, "gpt-test")).toMatchObject({ sessions: 2, costUsd: 0.031 });
		expect(model(o, "claude-haiku-test")).toMatchObject({ sessions: 2, costUsd: 0.00105 });
	});

	test("opencode: v2 rows win over legacy duplicates, zero cost is no cost, usage-less rows dropped", () => {
		const o = harness(runJson(h), "opencode");
		expect(o.sessions).toBe(3);
		expect(o.costUsd).toBe(0.05);
		expect(o.costSessions).toBe(1);
		expect(o.tokens).toEqual({ input: 120, output: 67, cacheRead: 1020, cacheWrite: 30, unsplit: 0, total: 1237 });
		expect(model(o, "gpt-test")).toMatchObject({ sessions: 3, costUsd: null, tokens: { input: 110, output: 62, cacheRead: 1000 } });
		expect(model(o, "claude-test")).toMatchObject({ sessions: 1, costUsd: 0.05 });
	});

	test("session files and databases are never modified", () => {
		const file = `${h.roots.claude}/-work-a/claude-sess-b.jsonl`;
		const before = readFileSync(file, "utf8");
		runJson(h);
		expect(readFileSync(file, "utf8")).toBe(before);
	});
});

describe("--since", () => {
	test("today keeps only the local day of now, across harnesses", () => {
		const s = runJson(h, ["--since", "today"]);
		expect(s.since).toEqual({ spec: "today", day: "2026-10-16" });
		const claude = harness(s, "claude");
		expect(claude.sessions).toBe(2);
		expect(model(claude, "claude-opus-test")).toMatchObject({ costUsd: 0.25, firstActivity: "2026-10-16T01:00:00.000Z", tokens: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 } });
		const omp = harness(s, "omp");
		expect(omp.sessions).toBe(1);
		expect(omp.models.map((m) => m.model)).toEqual(["gpt-test"]);
		expect(omp.costUsd).toBe(0.02);
		expect(harness(s, "codex").models.map((m) => m.model)).toEqual(["gpt-test-mini"]);
	});

	test("Nd counts calendar days including today; 2d drops the 14th", () => {
		const s = runJson(h, ["--since", "2d"]);
		expect(s.since.day).toBe("2026-10-15");
		expect(harness(s, "codex").sessions).toBe(1);
		expect(harness(s, "opencode").sessions).toBe(2);
		expect(harness(s, "omp").sessions).toBe(3);
	});

	test("local-timezone day boundaries: 16:30Z on the 15th is the 16th in Seoul", () => {
		const seoul = makeHome("Asia/Seoul");
		try {
			const omp = harness(runJson(seoul, ["--since", "today", "--harness", "omp"]), "omp");
			expect(omp.tokens).toMatchObject({ input: 11, output: 21 });
			expect(omp.costUsd).toBe(0.021);
			// 10:00Z on the 15th is 19:00 on the 15th in Seoul, still before "today".
			expect(omp.sessions).toBe(1);
		} finally {
			seoul.cleanup();
		}
	});

	test("rejects malformed specs", () => {
		expect(() => sinceDay("week", NOW, "UTC")).toThrow("invalid --since");
		expect(() => sinceDay("0d", NOW, "UTC")).toThrow("invalid --since");
		expect(sinceDay("all", NOW, "UTC")).toBeNull();
		expect(sinceDay("30d", NOW, "UTC")).toBe("2026-09-17");
	});
});

describe("missing data", () => {
	test("a harness without data prints – and null, never 0", () => {
		const empty = makeHome("UTC", ["claude"]);
		try {
			const s = runJson(empty, ["--harness", "opencode"]);
			const o = harness(s, "opencode");
			expect(o).toMatchObject({ sessions: 0, costUsd: null, firstActivity: null, lastActivity: null, models: [] });
			const text = stats(["--harness", "opencode"], empty.env, { nowMs: NOW }).stdout;
			const row = text.split("\n").find((l) => l.startsWith("opencode")) ?? "";
			expect(row).toContain("no data");
			expect(row).toContain("–");
			expect(row).not.toMatch(/\b0\b/);
		} finally {
			empty.cleanup();
		}
	});

	test("a harness with tokens but no stored cost prints – for cost", () => {
		const text = stats(["--harness", "codex"], h.env, { nowMs: NOW }).stdout;
		const row = text.split("\n").find((l) => l.startsWith("codex")) ?? "";
		expect(row.split(/\s{2,}/)[3]).toBe("–");
	});
});

describe("unsplit tokens", () => {
	test("a model known only by lifetime totals shows – for the input/output/cache split", () => {
		const text = stats(["--harness", "codex"], h.env, { nowMs: NOW }).stdout;
		const row = text.split("\n").find((l) => l.includes("unknown")) ?? "";
		expect(row.trim().split(/\s{2,}/).slice(1, 8)).toEqual(["1", "–", "–", "–", "–", "–", "700"]);
	});
});

describe("output", () => {
	test("--json has a stable schema with no NaN or negative numbers", () => {
		const s = runJson(h);
		expect(Object.keys(s)).toEqual(["schema", "generatedAt", "timezone", "since", "harnesses", "total"]);
		expect(s.schema).toBe(1);
		expect(s.generatedAt).toBe("2026-10-16T12:00:00.000Z");
		expect(s.timezone).toBe("UTC");
		expect(s.since).toEqual({ spec: "all", day: null });
		expect(s.harnesses.map((x) => x.harness)).toEqual(["claude", "codex", "omp", "opencode"]);
		const usageKeys = ["sessions", "costSessions", "costUsd", "tokens", "firstActivity", "lastActivity"];
		expect(Object.keys(s.total)).toEqual(usageKeys);
		for (const x of s.harnesses) {
			expect(Object.keys(x)).toEqual(["harness", ...usageKeys, "models"]);
			for (const m of x.models) expect(Object.keys(m)).toEqual(["model", ...usageKeys]);
			expect(Object.keys(x.tokens)).toEqual(["input", "output", "cacheRead", "cacheWrite", "unsplit", "total"]);
		}
		const numbers = [...JSON.stringify(s).matchAll(/:(-?[0-9.e+-]+)/g)].map((m) => Number(m[1]));
		expect(numbers.every((n) => Number.isFinite(n) && n >= 0)).toBe(true);
		expect(s.total.sessions).toBe(11);
	});

	test("human output is an aligned table with a TOTAL row and a partial-cost footnote", () => {
		const text = stats([], h.env, { nowMs: NOW }).stdout;
		const lines = text.trimEnd().split("\n");
		expect(lines[0]).toBe("Usage all time (UTC)");
		expect(lines[1]).toMatch(/^HARNESS\s+MODEL\s+SESSIONS\s+COST\s+INPUT/);
		expect(lines.some((l) => l.startsWith("TOTAL"))).toBe(true);
		expect(lines.some((l) => l.startsWith("claude") && l.includes("$0.75*"))).toBe(true);
		expect(lines.at(-1)).toContain("cost covers only the sessions that stored one");
	});

	test("bad options exit through an error", () => {
		expect(() => stats(["--harness", "vim"], h.env)).toThrow("unknown --harness vim");
		expect(() => stats(["--bogus"], h.env)).toThrow("unknown option --bogus");
	});
});

describe("todayCost", () => {
	test("sums stored costs of the local day, optionally per harness; null when none", () => {
		const { aggregate } = collectStats({ roots: h.roots, harnesses: ["claude", "codex", "omp", "opencode"], tz: "UTC", cacheFile: null });
		expect(dayKey(NOW, "UTC")).toBe("2026-10-16");
		expect(todayCost(aggregate, NOW, "UTC")).toBe(0.27);
		expect(todayCost(aggregate, NOW, "UTC", "claude")).toBe(0.25);
		expect(todayCost(aggregate, NOW, "UTC", "codex")).toBeNull();
		expect(todayCost(aggregate, Date.parse("2026-01-01T00:00:00Z"), "UTC")).toBeNull();
	});
});
