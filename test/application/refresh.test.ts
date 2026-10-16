import { describe, expect, test } from "bun:test";
import type { CacheEntry, CachePort } from "../../src/application/ports.ts";
import { cacheFreshness, refreshEntry } from "../../src/application/refresh.ts";

class MemoryCache implements CachePort {
	entries = new Map<string, CacheEntry<unknown>>();
	locks = new Set<string>();
	lockedWith: number[] = [];
	constructor(private nowMs = 1000) {}
	read<T>(key: string): CacheEntry<T> | null {
		return (this.entries.get(key) as CacheEntry<T> | undefined) ?? null;
	}
	write<T>(key: string, value: T): void {
		this.entries.set(key, { value, storedAtMs: this.nowMs });
	}
	lock(key: string, staleAfterMs: number): boolean {
		this.lockedWith.push(staleAfterMs);
		if (this.locks.has(key)) return false;
		this.locks.add(key);
		return true;
	}
	unlock(key: string): void {
		this.locks.delete(key);
	}
}

describe("cacheFreshness", () => {
	const entry = { value: 1, storedAtMs: 1000 };
	test("missing, fresh, stale", () => {
		expect(cacheFreshness(null, 5000, 2000)).toBe("missing");
		expect(cacheFreshness(entry, 5000, 1000)).toBe("fresh");
		expect(cacheFreshness(entry, 5000, 5999)).toBe("fresh");
		expect(cacheFreshness(entry, 5000, 6000)).toBe("stale");
	});
	test("an entry stamped in the future is stale", () => {
		expect(cacheFreshness(entry, 5000, 999)).toBe("stale");
	});
});

describe("refreshEntry", () => {
	test("stores a fetched value and releases the lock", async () => {
		const cache = new MemoryCache();
		expect(await refreshEntry(cache, "git", async () => "new")).toBe(true);
		expect(cache.read("git")).toEqual({ value: "new", storedAtMs: 1000 });
		expect(cache.locks.size).toBe(0);
		expect(cache.lockedWith).toEqual([30_000]);
	});

	test("returns false without fetching while the lock is held", async () => {
		const cache = new MemoryCache();
		cache.locks.add("git");
		let fetched = false;
		const ok = await refreshEntry(cache, "git", async () => ((fetched = true), "x"), 10_000);
		expect(ok).toBe(false);
		expect(fetched).toBe(false);
		expect(cache.lockedWith).toEqual([10_000]);
		expect(cache.locks.has("git")).toBe(true);
	});

	test("a null fetch keeps the previous entry", async () => {
		const cache = new MemoryCache();
		cache.entries.set("git", { value: "old", storedAtMs: 1 });
		expect(await refreshEntry(cache, "git", async () => null)).toBe(true);
		expect(cache.read("git")).toEqual({ value: "old", storedAtMs: 1 });
		expect(cache.locks.size).toBe(0);
	});

	test("the lock is released when the fetch throws", async () => {
		const cache = new MemoryCache();
		cache.entries.set("git", { value: "old", storedAtMs: 1 });
		await expect(
			refreshEntry(cache, "git", async () => {
				throw new Error("boom");
			}),
		).rejects.toThrow("boom");
		expect(cache.locks.size).toBe(0);
		expect(cache.read("git")?.value).toBe("old");
	});
});
