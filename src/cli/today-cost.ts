// Prints today's cost across all harnesses in dollars, or `null`, for the TUI harnesses (omp,
// OpenCode) that must not run the stats collector on their own event loop:
//
//   bun src/cli/today-cost.ts

import { readTodayCost } from "../infrastructure/stats/today.ts";

if (import.meta.main) {
	process.stdout.write(`${readTodayCost({ env: Bun.env, nowMs: Date.now() }) ?? "null"}\n`);
}
