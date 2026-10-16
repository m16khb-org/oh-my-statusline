// Today's cost for the status line's Σ chip: the incremental collector over every harness's
// storage, folded by todayCost. Fixture storage in a temp HOME only.

import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import path from "node:path";
import { readTodayCost } from "../../src/infrastructure/stats/today.ts";
import { type Home, makeHome, NOW } from "./helpers.ts";

let home: Home | undefined;
afterEach(() => home?.cleanup());

describe("readTodayCost", () => {
	test("the day's stored cost across all harnesses, computed through the shared stats cache", () => {
		home = makeHome("UTC");
		const cost = readTodayCost({ env: home.env, nowMs: NOW });
		expect(cost).not.toBeNull();
		expect(existsSync(path.join(home.env.XDG_CACHE_HOME!, "oh-my-statusline", "stats-cache.json"))).toBe(true);
		// A second read is incremental and gives the same number.
		expect(readTodayCost({ env: home.env, nowMs: NOW })).toBe(cost);
	});

	test("a day without stored cost is null (the chip is omitted)", () => {
		home = makeHome("UTC");
		expect(readTodayCost({ env: home.env, nowMs: Date.parse("2030-01-01T12:00:00Z") })).toBeNull();
	});

	test("unreadable storage never throws", () => {
		home = makeHome("UTC", []);
		expect(readTodayCost({ env: home.env, nowMs: NOW })).toBeNull();
	});
});
