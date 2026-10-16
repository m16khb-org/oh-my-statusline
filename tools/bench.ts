// Benchmarks for docs/performance.md: `bun run bench [--rounds N] [--runs N] [--json]`.
//
//   claude warm   `bun main.ts < session.json` with a warm cache (the per-render process Claude Code runs)
//   claude cold   the same with an empty cache (the first render in a directory waits for git once)
//   codex render  rollout state → snapshot → rows → tmux format, in-process (the collector's 2 s tick)
//   omp / opencode render   snapshot → rows (ANSI / TUI runs), in-process (what the host calls per frame)
//   demo          `bun src/cli/demo.ts` wall time (the invocation the pre-port baseline measured)
//   stats         `bun src/cli/stats.ts --json` over this machine's sessions: cold cache, then warm
//
// When the four original repositories are still checked out next to this one, the same claude
// warm render and the old `--demo` invocations are measured too, for a like-for-like comparison.

import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { resolveConfig } from "../src/application/config.ts";
import { renderStatusline } from "../src/application/render-statusline.ts";
import { toSnapshot } from "../src/domain/model/snapshot.ts";
import { snapshotFor } from "../src/harnesses/codex/payload.ts";
import { RolloutReader } from "../src/harnesses/codex/rollout.ts";
import { ansiToTmux } from "../src/harnesses/codex/tmux.ts";
import { readOptions } from "../src/harnesses/opencode/options.ts";
import { demoInput, toStatusSnapshot } from "../src/harnesses/opencode/snapshot.ts";
import { statusRows } from "../src/harnesses/opencode/view.ts";

const ROOT = path.resolve(import.meta.dir, "..");
const WORKSPACE = path.dirname(ROOT);
const args = Bun.argv.slice(2);
const ROUNDS = (args.includes("--rounds") && Number(args[args.indexOf("--rounds") + 1])) || 2;
const RUNS = (args.includes("--runs") && Number(args[args.indexOf("--runs") + 1])) || 20;

interface Result {
	name: string;
	unit: "ms";
	rounds: { median: number; min: number; max: number }[];
}

function summarize(samples: number[]): Result["rounds"][number] {
	const sorted = [...samples].sort((a, b) => a - b);
	const mid = sorted.length >> 1;
	const median = sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
	return { median, min: sorted[0]!, max: sorted[sorted.length - 1]! };
}

/** Wall time of a child process, `runs` times per round after one warm-up run. */
function processBench(name: string, cmd: string[], opts: { stdin?: string; env?: Record<string, string | undefined>; cwd?: string; before?: () => void } = {}): Result {
	const rounds: Result["rounds"] = [];
	// Measured with colors on: a NO_COLOR in the caller's shell would make every render cheaper.
	const { NO_COLOR: _, ...inherited } = process.env;
	const spawn = () =>
		Bun.spawnSync(cmd, { cwd: opts.cwd ?? ROOT, env: { ...inherited, ...opts.env }, stdin: opts.stdin ? new TextEncoder().encode(opts.stdin) : "ignore", stdout: "ignore", stderr: "ignore" });
	for (let r = 0; r < ROUNDS; r++) {
		opts.before?.();
		if (!opts.before) spawn();
		const samples: number[] = [];
		for (let i = 0; i < RUNS; i++) {
			opts.before?.();
			const start = performance.now();
			spawn();
			samples.push(performance.now() - start);
		}
		rounds.push(summarize(samples));
	}
	return { name, unit: "ms", rounds };
}

/** In-process time of `fn`, `runs * 50` calls per round after a warm-up. */
function functionBench(name: string, fn: () => unknown): Result {
	const rounds: Result["rounds"] = [];
	for (let i = 0; i < 200; i++) fn();
	for (let r = 0; r < ROUNDS; r++) {
		const samples: number[] = [];
		for (let i = 0; i < RUNS * 50; i++) {
			const start = performance.now();
			fn();
			samples.push(performance.now() - start);
		}
		rounds.push(summarize(samples));
	}
	return { name, unit: "ms", rounds };
}

const results: Result[] = [];
const scratch = mkdtempSync(path.join(tmpdir(), "oms-bench-"));
try {
	const nowS = Math.floor(Date.now() / 1000);
	const session = JSON.stringify({
		cwd: ROOT,
		model: { id: "claude-opus-5-5[1m]", display_name: "Opus 5.5 (1M context)" },
		workspace: { current_dir: ROOT, project_dir: ROOT, repo: { name: "oh-my-statusline" } },
		effort: { level: "max" },
		cost: { total_cost_usd: 4.21, total_duration_ms: 1_380_000 },
		context_window: { used_percentage: 28, total_input_tokens: 283_000, context_window_size: 1_000_000 },
		rate_limits: { five_hour: { used_percentage: 41, resets_at: nowS + 4320 }, seven_day: { used_percentage: 18, resets_at: nowS + 280_000 } },
	});
	const env = { XDG_CACHE_HOME: path.join(scratch, "cache"), STATUSLINE_THEME: "dark", COLORTERM: "truecolor", COLUMNS: "120", TMPDIR: scratch };
	const claudeMain = path.join(ROOT, "src", "harnesses", "claude", "main.ts");
	results.push(processBench("claude warm render (new)", [process.execPath, claudeMain], { stdin: session, env }));
	results.push(
		processBench("claude cold render (new, empty cache)", [process.execPath, claudeMain], {
			stdin: session,
			env,
			before: () => rmSync(path.join(scratch, "cache"), { recursive: true, force: true }),
		}),
	);
	const oldClaude = path.join(WORKSPACE, "claude-code-statusline", "statusline.sh");
	if (existsSync(oldClaude)) results.push(processBench("claude warm render (old statusline.sh)", ["bash", oldClaude], { stdin: session, env }));

	// Codex: the collector's per-tick work after the rollout has been read.
	const state = new RolloutReader(path.join(ROOT, "test", "fixtures", "codex", "rollout.jsonl")).read();
	const codexConfig = resolveConfig({ harness: "codex", installed: { colors: "truecolor" }, file: null, env: {}, flags: {} }).config;
	results.push(
		functionBench("codex render (snapshot → rows → tmux)", () => {
			const nowMs = Date.now();
			const snapshot = snapshotFor(state, { cwd: ROOT, startedMs: nowMs - 600_000, nowMs, linesAdded: 12, linesRemoved: 3, git: null });
			renderStatusline(snapshot, { config: codexConfig, width: 116, nowMs, appearance: "dark", env: {}, measure: Bun.stringWidth }).map(ansiToTmux);
		}),
	);
	const oldCodex = path.join(WORKSPACE, "codex-statusline", "renderer.sh");
	if (existsSync(oldCodex)) {
		const payload = JSON.stringify({ cwd: ROOT, model: { id: "gpt-6-astra", display_name: "GPT-6 Astra" }, effort: { level: "max" }, cost: { total_duration_ms: 600_000 } });
		results.push(processBench("codex render (old renderer.sh, per tick)", ["bash", oldCodex], { stdin: payload, env: { ...env, CODEX_STATUSLINE_CACHE: path.join(scratch, "codex") } }));
	}

	// omp: the widget's render(width) on a snapshot; OpenCode: the footer's runs.
	const ompSnapshot = toSnapshot("omp", await Bun.file(path.join(ROOT, "test", "fixtures", "snapshots", "omp.json")).json());
	const ompConfig = resolveConfig({ harness: "omp", file: null, env: {}, flags: {} }).config;
	results.push(
		functionBench("omp render (snapshot → rows)", () =>
			renderStatusline(ompSnapshot, { config: ompConfig, width: 160, nowMs: Date.now(), appearance: "dark", env: { COLORTERM: "truecolor" }, measure: Bun.stringWidth }),
		),
	);
	const options = readOptions();
	results.push(functionBench("opencode render (input → snapshot → runs)", () => {
		const nowMs = Date.now();
		statusRows(toStatusSnapshot(demoInput(nowMs), options, nowMs), options, 160, nowMs);
	}));

	results.push(processBench("demo, all harnesses (new)", [process.execPath, path.join(ROOT, "src", "cli", "demo.ts")], { env }));
	for (const [repo, cmd] of [
		["claude-code-statusline", ["bash", "statusline.sh", "--demo"]],
		["codex-statusline", ["bash", "renderer.sh", "--demo"]],
		["omp-statusline", [process.execPath, "render.ts", "--demo"]],
		["opencode-statusline", [process.execPath, "render.ts", "--demo"]],
	] as const) {
		const dir = path.join(WORKSPACE, repo);
		if (existsSync(dir)) results.push(processBench(`demo (old ${repo})`, [...cmd], { cwd: dir, env: { ...env, CODEX_STATUSLINE_CACHE: path.join(scratch, "codex") } }));
	}

	// Stats over this machine's real session files (read-only): a cold incremental cache, then warm.
	if (existsSync(path.join(process.env.HOME ?? homedir(), ".claude"))) {
		const statsEnv = { XDG_CACHE_HOME: path.join(scratch, "stats-cache") };
		const stats = [process.execPath, path.join(ROOT, "src", "cli", "stats.ts"), "--json"];
		const cold = Bun.spawnSync(stats, { env: { ...process.env, ...statsEnv }, stdout: "ignore" });
		const start = performance.now();
		Bun.spawnSync(stats, { env: { ...process.env, ...statsEnv }, stdout: "ignore" });
		const warm = performance.now() - start;
		results.push({ name: `stats --json (warm cache; cold run exit ${cold.exitCode})`, unit: "ms", rounds: [{ median: warm, min: warm, max: warm }] });
	}
} finally {
	rmSync(scratch, { recursive: true, force: true });
}

if (args.includes("--json")) console.log(JSON.stringify({ bun: Bun.version, platform: `${process.platform}-${process.arch}`, runs: RUNS, results }, null, 2));
else {
	console.log(`bun ${Bun.version} ${process.platform}-${process.arch}, ${ROUNDS} round(s) × ${RUNS} runs (in-process: ×50 calls)\n`);
	for (const r of results) {
		const rounds = r.rounds.map((x) => `${x.median.toFixed(x.median < 1 ? 3 : 1).padStart(7)} (${x.min.toFixed(x.min < 1 ? 3 : 1)}–${x.max.toFixed(x.max < 1 ? 3 : 1)})`).join("   ");
		console.log(`${r.name.padEnd(48)} ${rounds} ms`);
	}
}
