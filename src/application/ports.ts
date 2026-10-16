// Ports: what the application layer needs from the outside world. Infrastructure adapters
// (src/infrastructure/) implement them; harness adapters wire them together. Every read reports
// absent data as null rather than throwing, so a failing command only omits its segment.

import type { GitState, LimitWindow, PrState } from "../domain/model/snapshot.ts";
import type { ThemeName } from "../domain/render/cells.ts";

export interface ClockPort {
	/** Epoch milliseconds. */
	now(): number;
}

/** One repository read: checkout roots, porcelain status, and working-tree line totals vs HEAD. */
export interface GitReading {
	/** Checkout root of the working directory. */
	top: string;
	/** Main checkout; differs from `top` in a linked worktree. */
	main: string;
	state: GitState;
	linesAdded: number;
	linesRemoved: number;
}

export interface GitPort {
	/** null outside a repository, or when git is missing or times out. */
	read(cwd: string): Promise<GitReading | null>;
}

export interface PrPort {
	/** The open pull/merge request of the checked-out branch; null when none or gh/glab is missing. */
	read(cwd: string): Promise<PrState | null>;
}

export interface UsagePort {
	/** Usage-limit windows from the provider; null when no credentials or the fetch failed. */
	read(): Promise<LimitWindow[] | null>;
}

export interface AppearancePort {
	/** The desktop's light/dark appearance; dark when it cannot be read. */
	theme(): Promise<ThemeName>;
}

export interface CacheEntry<T> {
	value: T;
	storedAtMs: number;
}

/** A persistent key/value cache shared by short-lived render processes. */
export interface CachePort {
	/** The stored entry at any age, or null. */
	read<T>(key: string): CacheEntry<T> | null;
	/** Store atomically: readers see the old or the new entry, never a partial one. */
	write<T>(key: string, value: T): void;
	/**
	 * Take the refresh lock for `key`; false while another process holds it. A lock older than
	 * `staleAfterMs` is taken over (its holder died).
	 */
	lock(key: string, staleAfterMs: number): boolean;
	unlock(key: string): void;
}
