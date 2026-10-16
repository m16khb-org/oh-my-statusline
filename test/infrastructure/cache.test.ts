import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { defaultCacheDir, FileCache } from "../../src/infrastructure/cache.ts";

let tmp: string;
let now = 1000;
const clock = { now: () => now };
beforeEach(() => {
	tmp = mkdtempSync(path.join(tmpdir(), "oms-cache-"));
	now = 1000;
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

test("defaultCacheDir", () => {
	expect(defaultCacheDir({ XDG_CACHE_HOME: "/x" })).toBe("/x/oh-my-statusline");
	expect(defaultCacheDir({ HOME: "/h" })).toBe("/h/.cache/oh-my-statusline");
});

test("write then read keeps the stored time; dir is created lazily", () => {
	const dir = path.join(tmp, "sub", "c");
	const cache = new FileCache(dir, clock);
	expect(cache.read("k")).toBeNull();
	cache.write("k", { a: 1 });
	now = 5000;
	expect(cache.read("k")).toEqual({ value: { a: 1 }, storedAtMs: 1000 });
	expect(readdirSync(dir).filter((f) => f.endsWith(".tmp"))).toEqual([]);
});

test("keys are sanitized and truncated to the last 180 chars", () => {
	const cache = new FileCache(tmp, clock);
	const key = `/a b/${"x".repeat(300)}`;
	cache.write(key, 1);
	const files = readdirSync(tmp);
	expect(files).toHaveLength(1);
	expect(files[0]).toBe(`${"x".repeat(180)}.json`);
	expect(cache.read(key)?.value).toBe(1);
});

test("corrupt entry reads as null", () => {
	const cache = new FileCache(tmp, clock);
	writeFileSync(path.join(tmp, "k.json"), "{trunc");
	expect(cache.read("k")).toBeNull();
	writeFileSync(path.join(tmp, "k.json"), JSON.stringify({ value: 1 }));
	expect(cache.read("k")).toBeNull();
});

test("lock contention, unlock and stale takeover", () => {
	const a = new FileCache(tmp, clock);
	const b = new FileCache(tmp, clock);
	expect(a.lock("k", 30_000)).toBe(true);
	expect(b.lock("k", 30_000)).toBe(false);
	now += 30_000;
	expect(b.lock("k", 30_000)).toBe(false);
	now += 1;
	expect(b.lock("k", 30_000)).toBe(true);
	expect(a.lock("k", 30_000)).toBe(false);
	b.unlock("k");
	expect(a.lock("k", 30_000)).toBe(true);
});
