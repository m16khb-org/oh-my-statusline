import { describe, expect, test } from "bun:test";
import { findBun, todayCostViaProcess } from "../../src/infrastructure/stats/today-process.ts";

describe("todayCostViaProcess", () => {
	test("runs `bun <today-cost.ts>` through the runner and parses the number", async () => {
		const calls: string[][] = [];
		const cost = await todayCostViaProcess(async (cmd) => (calls.push(cmd), "12.34\n"), "/usr/bin/bun");
		expect(cost).toBe(12.34);
		expect(calls).toHaveLength(1);
		expect(calls[0]?.[0]).toBe("/usr/bin/bun");
		expect(calls[0]?.[1]).toMatch(/src\/cli\/today-cost\.ts$/);
	});

	test("null output, a failing child, junk, or no bun give null without running anything", async () => {
		expect(await todayCostViaProcess(async () => "null\n", "bun")).toBeNull();
		expect(await todayCostViaProcess(async () => null, "bun")).toBeNull();
		expect(await todayCostViaProcess(async () => "oops", "bun")).toBeNull();
		let ran = false;
		expect(await todayCostViaProcess(async () => ((ran = true), "1"), null)).toBeNull();
		expect(ran).toBe(false);
	});
});

describe("findBun", () => {
	test("PATH first, then the running executable only when it is bun", () => {
		expect(findBun(() => "/p/bun", "/x/omp")).toBe("/p/bun");
		expect(findBun(() => null, "/opt/bun")).toBe("/opt/bun");
		expect(findBun(() => null, "/opt/omp")).toBeNull();
	});
});
