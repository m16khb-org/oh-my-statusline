// Today's cost across all four harnesses, for the status line's `Σ` chip: the incremental stats
// collector over every harness's own storage, folded by todayCost. It reads files, so callers run
// it in the background and cache the number; it is never part of a render.

import { homedir } from "node:os";
import * as path from "node:path";
import { todayCost } from "../../application/stats/aggregate.ts";
import { STATS_HARNESSES } from "../../application/stats/model.ts";
import { defaultCacheDir } from "../cache.ts";
import { collectStats, defaultRoots, type StatsRoots } from "./collect.ts";

export interface TodayCostOptions {
	env: Record<string, string | undefined>;
	nowMs: number;
	/** Test seam; default: the real storage under HOME. */
	roots?: StatsRoots;
}

/** Today's cost in dollars; null when no harness stored a cost today or the read failed. */
export function readTodayCost(options: TodayCostOptions): number | null {
	const { env, nowMs } = options;
	try {
		const tz = env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone;
		const roots = options.roots ?? defaultRoots(env.HOME || homedir(), env);
		const cacheFile = path.join(defaultCacheDir(env), "stats-cache.json");
		const { aggregate } = collectStats({ roots, harnesses: STATS_HARNESSES, tz, cacheFile });
		return todayCost(aggregate, nowMs, tz);
	} catch {
		return null;
	}
}
