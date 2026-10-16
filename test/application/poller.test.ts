// Ported from omp-statusline/test/statusline.test.ts ("background polling"), with a fake clock.
import { describe, expect, test } from "bun:test";
import { Poller } from "../../src/application/poller.ts";

function fakeClock(start = 1_800_000_000_000) {
	let t = start;
	return { now: () => t, set: (ms: number) => void (t = ms), start };
}

/** Poll once and resolve when that poll's fetch has settled (onUpdate runs last). */
function pollOnce<T>(poller: Poller<T>, key: string, fetch: () => Promise<T | undefined>): Promise<void> {
	const { promise, resolve } = Promise.withResolvers<void>();
	poller.poll(key, fetch, resolve);
	return promise;
}

describe("Poller", () => {
	test("a key that changes during a fetch is fetched right after it", async () => {
		const poller = new Poller<string>(fakeClock(), 60_000, 60_000);
		const gate = Promise.withResolvers<void>();
		const first = pollOnce(poller, "main", async () => (await gate.promise, "old"));
		poller.poll("feature", async () => "skipped while busy", () => {});
		gate.resolve();
		await first;
		expect(poller.value).toBeUndefined();
		await pollOnce(poller, "feature", async () => "new");
		expect(poller.value).toBe("new");
	});

	test("invalidation refetches after the minimum gap; otherwise the value is kept until it ages", async () => {
		const clock = fakeClock();
		const poller = new Poller<number>(clock, 60_000, 2000);
		let n = 0;
		const fetch = async () => ++n;
		await pollOnce(poller, "k", fetch);
		poller.invalidate();
		poller.poll("k", fetch, () => {});
		expect(n).toBe(1);
		clock.set(clock.start + 2000);
		await pollOnce(poller, "k", fetch);
		expect(n).toBe(2);
		clock.set(clock.start + 30_000);
		poller.poll("k", fetch, () => {});
		expect(n).toBe(2);
		clock.set(clock.start + 62_000);
		await pollOnce(poller, "k", fetch);
		expect(n).toBe(3);
	});

	test("invalidation is immediate once the gap has passed", async () => {
		const clock = fakeClock();
		const poller = new Poller<number>(clock, 60_000, 0);
		let n = 0;
		const fetch = async () => ++n;
		await pollOnce(poller, "k", fetch);
		poller.invalidate();
		await pollOnce(poller, "k", fetch);
		expect(n).toBe(2);
		expect(poller.value).toBe(2);
	});

	test("one fetch at a time", async () => {
		const poller = new Poller<number>(fakeClock(), 0, 0);
		const gate = Promise.withResolvers<void>();
		let calls = 0;
		const fetch = async () => (calls++, await gate.promise, calls);
		const done = pollOnce(poller, "k", fetch);
		poller.poll("k", fetch, () => {});
		expect(calls).toBe(1);
		gate.resolve();
		await done;
	});

	test("a rejected fetch keeps the last value and waits out maxAgeMs", async () => {
		const clock = fakeClock();
		const poller = new Poller<string>(clock, 60_000, 0);
		await pollOnce(poller, "k", async () => "good");
		clock.set(clock.start + 61_000);
		let calls = 0;
		const failing = async (): Promise<string> => {
			calls++;
			throw new Error("offline");
		};
		await pollOnce(poller, "k", failing);
		expect(poller.value).toBe("good");
		poller.poll("k", failing, () => {});
		expect(calls).toBe(1);
	});
});
