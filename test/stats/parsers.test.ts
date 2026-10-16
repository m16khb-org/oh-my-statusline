import { describe, expect, test } from "bun:test";
import { claudeParser } from "../../src/application/stats/parse-claude.ts";
import { codexParser } from "../../src/application/stats/parse-codex.ts";
import type { UsageEvent } from "../../src/application/stats/model.ts";
import { opencodeEvent } from "../../src/application/stats/parse-opencode.ts";
import { ompParser } from "../../src/application/stats/parse-omp.ts";

function feed<C>(parser: { initial(h: string): C; line(c: C, t: string, e: (x: UsageEvent) => void): void; pending(c: C): UsageEvent[] }, lines: unknown[]): UsageEvent[] {
	const carry = parser.initial("hint");
	const out: UsageEvent[] = [];
	for (const l of lines) parser.line(carry, typeof l === "string" ? l : JSON.stringify(l), (e) => out.push(e));
	return [...out, ...parser.pending(carry)];
}

const assistant = (id: string, output: number, ts = "2026-10-15T10:00:00.000Z") => ({
	type: "assistant",
	timestamp: ts,
	sessionId: "s",
	requestId: "r",
	message: { id, model: "m", usage: { input_tokens: 1, output_tokens: output, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } },
});

describe("claude parser", () => {
	test("a cost-state total that goes backwards restarts the delta", () => {
		const cost = (total: number) => ({ type: "cost-state", sessionId: "s", modelUsage: { m: { costUSD: total } } });
		const events = feed(claudeParser, [assistant("a", 1), cost(1), cost(1), cost(0.4)]);
		expect(events.filter((e) => e.costUsd !== null).map((e) => e.costUsd)).toEqual([1, 0.4]);
	});

	test("only equal consecutive message+request ids collapse; keyless lines never do", () => {
		const keyless = { ...assistant("", 5), message: { model: "m", usage: { output_tokens: 5 } } };
		expect(feed(claudeParser, [assistant("a", 1), assistant("b", 2), assistant("b", 3)]).map((e) => e.output)).toEqual([1, 3]);
		expect(feed(claudeParser, [keyless, keyless]).map((e) => e.output)).toEqual([5, 5]);
	});

	test("ignores junk lines without throwing", () => {
		expect(feed(claudeParser, ['{"usage":', "not json at all", '"cost-state"', "[]"])).toEqual([]);
	});
});

describe("codex parser", () => {
	const count = (ts: string, input: number, cached: number, output: number) => ({
		timestamp: ts,
		type: "event_msg",
		payload: { type: "token_count", info: { total_token_usage: { input_tokens: input, cached_input_tokens: cached, output_tokens: output } } },
	});

	test("a total that goes backwards is counted whole", () => {
		const events = feed(codexParser, [count("2026-10-15T10:00:00Z", 100, 50, 10), count("2026-10-15T10:01:00Z", 30, 0, 5)]);
		expect(events.map((e) => [e.input, e.cacheRead, e.output])).toEqual([
			[50, 50, 10],
			[30, 0, 5],
		]);
	});

	test("model names follow the latest turn_context", () => {
		const events = feed(codexParser, [
			{ timestamp: "2026-10-15T10:00:00Z", type: "turn_context", payload: { model: "a" } },
			count("2026-10-15T10:00:01Z", 10, 0, 1),
			{ timestamp: "2026-10-15T10:00:02Z", type: "turn_context", payload: { model: "b" } },
			count("2026-10-15T10:00:03Z", 20, 0, 2),
		]);
		expect(events.map((e) => e.model)).toEqual(["a", "b"]);
	});
});

describe("omp parser", () => {
	test("non-assistant messages and usage-less lines are ignored; missing cost stays null", () => {
		const events = feed(ompParser, [
			{ type: "session", id: "sid" },
			{ type: "message", timestamp: "2026-10-15T10:00:00Z", message: { role: "user", usage: { input: 5 } } },
			{ type: "message", timestamp: "2026-10-15T10:00:00Z", message: { role: "assistant", model: "m", usage: { input: 5, output: 1, cacheRead: 0, cacheWrite: 0 } } },
		]);
		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({ sessionId: "sid", costUsd: null, input: 5 });
	});
});

describe("opencode mapper", () => {
	const row = { sessionId: "s", model: "m", createdMs: 1000, rowMs: 2000, input: 1, output: 2, cacheRead: 3, cacheWrite: 4, cost: 0 };
	test("zero cost is no cost; created time wins over the row time; reasoning is not added", () => {
		expect(opencodeEvent(row)).toMatchObject({ tsMs: 1000, costUsd: null, output: 2 });
		expect(opencodeEvent({ ...row, createdMs: null, cost: 0.5 })).toMatchObject({ tsMs: 2000, costUsd: 0.5 });
		expect(opencodeEvent({ ...row, model: null })).toBeNull();
	});
});
