// `stats-cache.json`: per-source incremental state so a rerun parses only new bytes.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import type { BucketMap, UsageEvent } from "../../application/stats/model.ts";

/** Bumped whenever a parser or the bucket shape changes meaning, so stale caches are rebuilt. */
export const STATS_CACHE_VERSION = 1;

/** A JSONL session file: bytes up to `offset` have been parsed. */
export interface FileState {
	size: number;
	mtimeMs: number;
	offset: number;
	/** The parser's JSON-serializable carry state. */
	carry: unknown;
	buckets: BucketMap;
}

/** A SQLite store, re-queried whenever its file signature changes. */
export interface DbState {
	sig: string;
	buckets: BucketMap;
	/** Codex thread rows, kept raw because they only count for threads no rollout covers. */
	threadEvents: UsageEvent[];
}

export interface StatsCache {
	version: number;
	tz: string;
	/** Keyed `<harness>\0<absolute path>`. */
	files: Record<string, FileState>;
	dbs: Record<string, DbState>;
}

export function emptyCache(tz: string): StatsCache {
	return { version: STATS_CACHE_VERSION, tz, files: {}, dbs: {} };
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The cache at `file`; an absent, corrupt, stale-version or other-timezone cache reads as empty. */
export function loadCache(file: string, tz: string): StatsCache {
	try {
		const raw: unknown = JSON.parse(readFileSync(file, "utf8"));
		if (!isObject(raw) || raw.version !== STATS_CACHE_VERSION || raw.tz !== tz || !isObject(raw.files) || !isObject(raw.dbs)) return emptyCache(tz);
		const cache = emptyCache(tz);
		for (const [key, v] of Object.entries(raw.files)) {
			if (isObject(v) && typeof v.size === "number" && typeof v.mtimeMs === "number" && typeof v.offset === "number" && isObject(v.buckets) && isObject(v.carry)) {
				cache.files[key] = v as unknown as FileState;
			}
		}
		for (const [key, v] of Object.entries(raw.dbs)) {
			if (isObject(v) && typeof v.sig === "string" && isObject(v.buckets) && Array.isArray(v.threadEvents)) cache.dbs[key] = v as unknown as DbState;
		}
		return cache;
	} catch {
		return emptyCache(tz);
	}
}

let tmpCounter = 0;

export function saveCache(file: string, cache: StatsCache): void {
	mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
	const tmp = `${file}.${process.pid}.${tmpCounter++}.tmp`;
	writeFileSync(tmp, JSON.stringify(cache));
	renameSync(tmp, file);
}
