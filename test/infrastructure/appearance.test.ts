import { expect, test } from "bun:test";
import { AppearanceAdapter } from "../../src/infrastructure/appearance.ts";
import type { CachePort } from "../../src/application/ports.ts";

function memCache(): CachePort & { writes: number } {
	const m = new Map<string, { value: unknown; storedAtMs: number }>();
	const c = {
		writes: 0,
		now: () => 0,
		read: <T>(k: string) => (m.get(k) as { value: T; storedAtMs: number } | undefined) ?? null,
		write: <T>(k: string, value: T) => {
			c.writes++;
			m.set(k, { value, storedAtMs: now });
		},
		lock: () => true,
		unlock: () => {},
	};
	return c;
}
let now = 0;

function make(out: string | null, hasDefaults = true) {
	now = 0;
	const cache = memCache();
	let calls = 0;
	const adapter = new AppearanceAdapter(
		cache,
		{ now: () => now },
		async () => {
			calls++;
			return out;
		},
		() => (hasDefaults ? "/usr/bin/defaults" : null),
	);
	return { adapter, calls: () => calls };
}

test("no defaults binary is dark", async () => {
	const { adapter, calls } = make("Dark\n", false);
	expect(await adapter.theme()).toBe("dark");
	expect(calls()).toBe(0);
});
test("Dark is dark; failure and other output are light", async () => {
	expect(await make("Dark\n").adapter.theme()).toBe("dark");
	expect(await make(null).adapter.theme()).toBe("light");
	expect(await make("Other\n").adapter.theme()).toBe("light");
});
test("cached for 30 seconds", async () => {
	const { adapter, calls } = make(null);
	expect(await adapter.theme()).toBe("light");
	now = 29_999;
	await adapter.theme();
	expect(calls()).toBe(1);
	now = 30_000;
	await adapter.theme();
	expect(calls()).toBe(2);
});
