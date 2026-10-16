// Stale-first, refresh-in-background: a short-lived render process draws the cached value at any
// age and refreshes it for the next render, so a slow command never delays a frame.

import type { CacheEntry, CachePort } from "./ports.ts";

/** An entry stamped in the future (clock skew, a restored backup) counts as stale. */
export function cacheFreshness<T>(
	entry: CacheEntry<T> | null,
	ttlMs: number,
	nowMs: number,
): "fresh" | "stale" | "missing" {
	if (entry === null) return "missing";
	const age = nowMs - entry.storedAtMs;
	return age >= 0 && age < ttlMs ? "fresh" : "stale";
}

/**
 * Fetch and store a new value for `key`. Returns false when another process holds the lock (a lock
 * older than `staleLockMs` is taken over). Only a non-null result is written: a failed or null
 * fetch keeps the previous entry. The lock is always released.
 */
export async function refreshEntry<T>(
	cache: CachePort,
	key: string,
	fetch: () => Promise<T | null>,
	staleLockMs = 30_000,
): Promise<boolean> {
	if (!cache.lock(key, staleLockMs)) return false;
	try {
		const value = await fetch();
		if (value !== null) cache.write(key, value);
	} finally {
		cache.unlock(key);
	}
	return true;
}
