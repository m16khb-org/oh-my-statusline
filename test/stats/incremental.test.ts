import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { appendFileSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import type { Home } from "./helpers.ts";
import { makeHome } from "./helpers.ts";
import { summarize } from "../../src/application/stats/aggregate.ts";
import type { StatsHarness, StatsSummary } from "../../src/application/stats/model.ts";
import type { StatsCache } from "../../src/infrastructure/stats/cache.ts";
import type { CollectResult } from "../../src/infrastructure/stats/collect.ts";
import { collectStats } from "../../src/infrastructure/stats/collect.ts";

let h: Home;
beforeEach(() => {
	h = makeHome("UTC", ["claude", "omp"]);
});
afterEach(() => h.cleanup());

const BOTH: StatsHarness[] = ["claude", "omp"];
const NOW = Date.parse("2026-10-16T12:00:00Z");

function run(harnesses: StatsHarness[] = ["claude"]): CollectResult {
	return collectStats({ roots: h.roots, harnesses, tz: "UTC", cacheFile: h.cacheFile });
}

function sonnet(result: CollectResult) {
	const s: StatsSummary = summarize(result.aggregate, { harnesses: ["claude"], since: "all", nowMs: NOW, tz: "UTC" });
	return s.harnesses[0]?.models.find((m) => m.model === "claude-sonnet-test");
}

const sessionB = (): string => `${h.roots.claude}/-work-a/claude-sess-b.jsonl`;

function assistantLine(id: string, input: number, output: number): string {
	return JSON.stringify({
		type: "assistant",
		timestamp: "2026-10-16T06:00:00.000Z",
		sessionId: "claude-sess-b",
		requestId: `req_${id}`,
		message: { id: `msg_${id}`, model: "claude-sonnet-test", role: "assistant", usage: { input_tokens: input, output_tokens: output, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } },
	});
}

function cacheOf(): StatsCache {
	return JSON.parse(readFileSync(h.cacheFile, "utf8")) as StatsCache;
}

describe("incremental cache", () => {
	test("first run parses everything, an unchanged rerun reads nothing", () => {
		const first = run();
		expect(first.counters).toMatchObject({ filesSeen: 3, filesParsed: 3, linesRead: 10 });
		expect(first.counters.bytesRead).toBeGreaterThan(0);
		const second = run();
		expect(second.counters).toMatchObject({ filesSeen: 3, filesParsed: 0, linesRead: 0, bytesRead: 0 });
		expect(second.aggregate.buckets).toEqual(first.aggregate.buckets);
	});

	test("an appended line is the only thing parsed", () => {
		run();
		const sizeBefore = statSync(sessionB()).size;
		const line = `${assistantLine("b2", 7, 9)}\n`;
		appendFileSync(sessionB(), line);
		const second = run();
		expect(second.counters).toMatchObject({ filesParsed: 1, linesRead: 1, bytesRead: Buffer.byteLength(line) });
		expect(sonnet(second)).toMatchObject({ tokens: { input: 107, output: 209 } });
		const entry = cacheOf().files[`claude\u0000${sessionB()}`];
		expect(entry?.offset).toBe(sizeBefore + Buffer.byteLength(line));
		expect(entry?.size).toBe(entry?.offset);
	});

	test("a streamed message split across runs still collapses to its final usage", () => {
		run();
		appendFileSync(sessionB(), `${assistantLine("b2", 7, 1)}\n`);
		expect(sonnet(run())).toMatchObject({ tokens: { input: 107, output: 201 } });
		appendFileSync(sessionB(), `${assistantLine("b2", 7, 90)}\n`);
		expect(sonnet(run())).toMatchObject({ tokens: { input: 107, output: 290 } });
	});

	test("a partial last line waits for its newline and is then parsed once", () => {
		run();
		const sizeBefore = statSync(sessionB()).size;
		const line = assistantLine("b2", 7, 9);
		const cut = Math.floor(line.length / 2);
		appendFileSync(sessionB(), line.slice(0, cut));
		const partial = run();
		expect(partial.counters.linesRead).toBe(0);
		expect(sonnet(partial)).toMatchObject({ tokens: { input: 100, output: 200 } });
		expect(cacheOf().files[`claude\u0000${sessionB()}`]?.offset).toBe(sizeBefore);

		appendFileSync(sessionB(), `${line.slice(cut)}\n`);
		const done = run();
		expect(done.counters.linesRead).toBe(1);
		expect(sonnet(done)).toMatchObject({ tokens: { input: 107, output: 209 } });
		expect(run().counters.linesRead).toBe(0);
	});

	test("an unterminated tail that is already complete JSON is taken once, not again after its newline", () => {
		run();
		appendFileSync(sessionB(), assistantLine("b2", 7, 9));
		const first = run();
		expect(first.counters.linesRead).toBe(1);
		expect(sonnet(first)).toMatchObject({ tokens: { input: 107 } });
		appendFileSync(sessionB(), "\n");
		const second = run();
		expect(second.counters.linesRead).toBe(0);
		expect(sonnet(second)).toMatchObject({ tokens: { input: 107 } });
	});

	test("a shrunk file is re-parsed from byte 0", () => {
		run();
		const replacement = `${assistantLine("b9", 1, 2)}\n`;
		expect(Buffer.byteLength(replacement)).toBeLessThan(statSync(sessionB()).size);
		writeFileSync(sessionB(), replacement);
		const second = run();
		expect(second.counters).toMatchObject({ filesParsed: 1, linesRead: 1, bytesRead: Buffer.byteLength(replacement) });
		expect(sonnet(second)).toMatchObject({ tokens: { input: 1, output: 2 } });
	});

	test("a file whose mtime went backwards is re-parsed from byte 0", () => {
		run();
		const replacement = `${assistantLine("b9", 3, 4)}\n${assistantLine("b10", 5, 6)}\n`;
		writeFileSync(sessionB(), replacement);
		const past = new Date(Date.now() - 86_400_000);
		utimesSync(sessionB(), past, past);
		const second = run();
		expect(second.counters).toMatchObject({ filesParsed: 1, linesRead: 2 });
		expect(sonnet(second)).toMatchObject({ tokens: { input: 8, output: 10 } });
	});

	test("a corrupt cache is rebuilt", () => {
		const first = run();
		writeFileSync(h.cacheFile, "{ not json");
		const second = run();
		expect(second.counters.linesRead).toBe(10);
		expect(second.aggregate.buckets).toEqual(first.aggregate.buckets);
		expect(cacheOf().version).toBe(1);
	});

	test("a structurally wrong cache entry is dropped, others survive", () => {
		run(BOTH);
		const cache = cacheOf();
		cache.files[`claude\u0000${sessionB()}`] = { size: "x" } as never;
		writeFileSync(h.cacheFile, JSON.stringify(cache));
		const second = run(BOTH);
		expect(second.counters.filesParsed).toBe(1);
		expect(sonnet(second)).toMatchObject({ tokens: { input: 100, output: 200 } });
	});

	test("a cache built for another timezone is discarded", () => {
		run();
		const seoul = collectStats({ roots: h.roots, harnesses: ["claude"], tz: "Asia/Seoul", cacheFile: h.cacheFile });
		expect(seoul.counters.linesRead).toBe(10);
		expect(cacheOf().tz).toBe("Asia/Seoul");
	});

	test("deleted files drop out of the totals and the cache", () => {
		run();
		rmSync(sessionB());
		const second = run();
		expect(sonnet(second)).toBeUndefined();
		expect(Object.keys(cacheOf().files).some((k) => k.includes("claude-sess-b"))).toBe(false);
	});

	test("harnesses that were not requested keep their cached state", () => {
		run(BOTH);
		run(["claude"]);
		const keys = Object.keys(cacheOf().files);
		expect(keys.some((k) => k.startsWith("omp\u0000"))).toBe(true);
		expect(run(BOTH).counters.linesRead).toBe(0);
	});

	test("sqlite stores are re-queried only when their file signature changes", () => {
		const full = makeHome("UTC", ["codex", "opencode"]);
		try {
			const go = () => collectStats({ roots: full.roots, harnesses: ["codex", "opencode"], tz: "UTC", cacheFile: full.cacheFile });
			expect(go().counters.dbsQueried).toBe(2);
			expect(go().counters.dbsQueried).toBe(0);
			const later = new Date(Date.now() + 60_000);
			utimesSync(`${full.home}/.local/share/opencode/opencode.db`, later, later);
			expect(go().counters.dbsQueried).toBe(1);
		} finally {
			full.cleanup();
		}
	});
});
