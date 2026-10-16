// Usage statistics across the four harnesses, read from their own session storage.
//
//   bun src/cli/stats.ts [--harness claude|codex|omp|opencode|all] [--since 7d|30d|today|all] [--json]

import { homedir } from "node:os";
import * as path from "node:path";
import { summarize } from "../application/stats/aggregate.ts";
import { renderTable } from "../application/stats/format.ts";
import type { StatsHarness } from "../application/stats/model.ts";
import { STATS_HARNESSES } from "../application/stats/model.ts";
import { defaultCacheDir } from "../infrastructure/cache.ts";
import type { StatsRoots } from "../infrastructure/stats/collect.ts";
import { collectStats, defaultRoots } from "../infrastructure/stats/collect.ts";

export interface StatsOverrides {
	nowMs?: number;
	roots?: StatsRoots;
	/** Cache file; null disables the cache. Defaults to `<cache dir>/stats-cache.json`. */
	cacheFile?: string | null;
}

export interface StatsOutput {
	stdout: string;
	warnings: string[];
}

function flag(argv: readonly string[], name: string): string | undefined {
	const i = argv.indexOf(name);
	if (i >= 0) return argv[i + 1];
	return argv.find((a) => a.startsWith(`${name}=`))?.slice(name.length + 1);
}

export function stats(argv: readonly string[], env: Record<string, string | undefined>, overrides: StatsOverrides = {}): StatsOutput {
	const known = new Set(["--harness", "--since", "--json"]);
	for (const a of argv) {
		if (a.startsWith("--") && !known.has(a.split("=")[0] ?? "")) throw new Error(`unknown option ${a}`);
	}
	const pick = flag(argv, "--harness") ?? "all";
	if (pick !== "all" && !STATS_HARNESSES.includes(pick as StatsHarness)) {
		throw new Error(`unknown --harness ${pick}; one of all, ${STATS_HARNESSES.join(", ")}`);
	}
	const harnesses = pick === "all" ? STATS_HARNESSES : [pick as StatsHarness];
	const since = flag(argv, "--since") ?? "all";
	const nowMs = overrides.nowMs ?? Date.now();
	const tz = env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone;
	const home = env.HOME || homedir();
	const cacheFile = overrides.cacheFile === undefined ? path.join(defaultCacheDir(env), "stats-cache.json") : overrides.cacheFile;

	const collected = collectStats({ roots: overrides.roots ?? defaultRoots(home, env), harnesses, tz, cacheFile });
	const summary = summarize(collected.aggregate, { harnesses, since, nowMs, tz });
	return { stdout: argv.includes("--json") ? `${JSON.stringify(summary, null, 2)}\n` : renderTable(summary), warnings: collected.warnings };
}

if (import.meta.main) {
	try {
		const result = stats(Bun.argv.slice(2), Bun.env);
		for (const warning of result.warnings) process.stderr.write(`warning: ${warning}\n`);
		process.stdout.write(result.stdout);
	} catch (error) {
		process.stderr.write(`${(error as Error).message}\n`);
		process.exit(2);
	}
}
