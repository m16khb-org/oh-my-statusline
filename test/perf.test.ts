// Performance regression guards. The thresholds are deliberately loose so shared CI runners pass;
// the absolute numbers for this project live in docs/performance.md (`bun run bench`).
// SKIP_PERF=1 skips the process-level check (as the claude-code-statusline suite allowed).

import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { resolveConfig } from "../src/application/config.ts";
import { renderStatusline } from "../src/application/render-statusline.ts";
import { toSnapshot } from "../src/domain/model/snapshot.ts";

const ROOT = path.resolve(import.meta.dir, "..");

function median(samples: number[]): number {
	const sorted = [...samples].sort((a, b) => a - b);
	return sorted[sorted.length >> 1]!;
}

describe("render hot paths", () => {
	test("rendering a full snapshot takes well under a millisecond (budget: 10 ms)", async () => {
		const config = resolveConfig({ harness: "omp", file: null, env: {}, flags: {} }).config;
		const samples: number[] = [];
		for (const harness of ["claude", "codex", "omp", "opencode"] as const) {
			const snapshot = toSnapshot(harness, await Bun.file(path.join(ROOT, "test", "fixtures", "snapshots", `${harness}.json`)).json());
			for (let i = 0; i < 200; i++) {
				const start = performance.now();
				renderStatusline(snapshot, { config, width: 120, nowMs: 1_790_000_000_000, appearance: "dark", env: { COLORTERM: "truecolor" }, measure: Bun.stringWidth });
				samples.push(performance.now() - start);
			}
		}
		expect(median(samples)).toBeLessThan(10);
	});

	test.skipIf(Bun.env.SKIP_PERF === "1")("a warm Claude Code render process finishes within 150 ms (median of 7)", async () => {
		const dir = mkdtempSync(path.join(tmpdir(), "oms-perf-"));
		try {
			const session = new TextEncoder().encode(
				JSON.stringify({ cwd: ROOT, model: { id: "claude-opus-5-5", display_name: "Opus 5.5" }, context_window: { used_percentage: 28, total_input_tokens: 1, context_window_size: 10 } }),
			);
			// A temp HOME without credentials, and no transpiler cache: the background helpers a first
			// render starts finish fast and write only inside `dir`.
			const env = {
				HOME: dir,
				PATH: process.env.PATH,
				XDG_CACHE_HOME: path.join(dir, "cache"),
				XDG_CONFIG_HOME: path.join(dir, "config"),
				BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0",
				STATUSLINE_THEME: "dark",
				COLUMNS: "120",
			};
			const main = path.join(ROOT, "src", "harnesses", "claude", "main.ts");
			const run = () => Bun.spawnSync([process.execPath, main], { env, stdin: session, stdout: "pipe", stderr: "ignore" });
			expect(run().stdout.toString()).toContain("Opus 5.5");
			const samples: number[] = [];
			for (let i = 0; i < 7; i++) {
				const start = performance.now();
				run();
				samples.push(performance.now() - start);
			}
			expect(median(samples)).toBeLessThan(150);
			// The renders started detached refresh helpers (usage, PR); each holds a `<key>.lock` until it
			// is done. They are separate processes, so fake timers cannot drive them: wait for the locks
			// to go (bounded) before deleting the directory they write into.
			const cacheDir = path.join(dir, "cache", "oh-my-statusline");
			const locked = () => existsSync(cacheDir) && readdirSync(cacheDir).some((name) => name.endsWith(".lock"));
			for (let waited = 0; waited < 5000 && (locked() || !existsSync(path.join(cacheDir, "claude-usage.json"))); waited += 25) await Bun.sleep(25);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
