import { Database } from "bun:sqlite";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import type { StatsSummary } from "../../src/application/stats/model.ts";
import { stats } from "../../src/cli/stats.ts";
import type { StatsRoots } from "../../src/infrastructure/stats/collect.ts";
import { defaultRoots } from "../../src/infrastructure/stats/collect.ts";

const FIXTURES = path.join(import.meta.dir, "..", "fixtures", "stats");

/** 2026-10-16T12:00:00Z */
export const NOW = Date.parse("2026-10-16T12:00:00Z");

export interface Home {
	home: string;
	env: Record<string, string>;
	roots: StatsRoots;
	cacheFile: string;
	cleanup(): void;
}

/** A temp HOME holding copies of the synthetic fixtures laid out like the real storage. */
export function makeHome(tz = "UTC", only: readonly ("claude" | "codex" | "omp" | "opencode")[] = ["claude", "codex", "omp", "opencode"]): Home {
	const home = mkdtempSync(path.join(tmpdir(), "oms-stats-"));
	const env = { HOME: home, XDG_CACHE_HOME: path.join(home, ".cache"), TZ: tz };
	const seed = (db: string, sql: string): void => {
		mkdirSync(path.dirname(db), { recursive: true });
		const conn = new Database(db);
		conn.exec(readFileSync(path.join(FIXTURES, sql), "utf8"));
		conn.close();
	};
	if (only.includes("claude")) cpSync(path.join(FIXTURES, "claude", "projects"), path.join(home, ".claude", "projects"), { recursive: true });
	if (only.includes("codex")) {
		cpSync(path.join(FIXTURES, "codex", "sessions"), path.join(home, ".codex", "sessions"), { recursive: true });
		seed(path.join(home, ".codex", "state_5.sqlite"), "codex/state-seed.sql");
	}
	if (only.includes("omp")) cpSync(path.join(FIXTURES, "omp", "agent", "sessions"), path.join(home, ".omp", "agent", "sessions"), { recursive: true });
	if (only.includes("opencode")) seed(path.join(home, ".local", "share", "opencode", "opencode.db"), "opencode/opencode-seed.sql");
	return {
		home,
		env,
		roots: defaultRoots(home, env),
		cacheFile: path.join(home, ".cache", "oh-my-statusline", "stats-cache.json"),
		cleanup: () => rmSync(home, { recursive: true, force: true }),
	};
}

/** Run the CLI in-process against `h` and return the parsed `--json` document. */
export function runJson(h: Home, args: string[] = [], nowMs = NOW): StatsSummary {
	return JSON.parse(stats([...args, "--json"], h.env, { nowMs }).stdout) as StatsSummary;
}
