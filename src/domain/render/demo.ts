// Representative sessions, one per harness, rendered with fake data for screenshots and a quick
// look (`bun run demo`). Each shows the data that harness actually has: Codex has no cost or PR,
// OpenCode no usage limits, PR or cache.

import { type RunningAgent, type StatusSnapshot, toSnapshot } from "../model/snapshot.ts";

export interface DemoCase {
	title: string;
	snapshot: StatusSnapshot;
}

export function demoCases(nowMs: number): DemoCase[] {
	const fiveHour = (usedPct: number, inMs: number) => ({ label: "5h", usedPct, resetsAtMs: nowMs + inMs, windowMs: 18_000_000 });
	const sevenDay = (usedPct: number, inMs: number) => ({ label: "7d", usedPct, resetsAtMs: nowMs + inMs, windowMs: 604_800_000 });
	const dir = { name: "my-app", relative: "", worktree: null };
	const dirty = { branch: "main", ahead: 2, staged: 1, modified: 2, untracked: 1 };
	return [
		{
			title: "Claude Code: Opus at max effort, cache countdown, per-model weekly limit",
			snapshot: toSnapshot("claude", {
				model: { name: "Opus 5.5", family: "claude-opus-5-5[1m]" },
				effort: "max",
				dir,
				git: { branch: "main" },
				pr: { number: 512, url: "https://github.com/octocat/my-app/pull/512", state: "approved" },
				stats: { costUsd: 4.21, durationMs: 1_380_000, linesAdded: 156, linesRemoved: 23 },
				cache: { ttlRemainingMs: 2_520_000 },
				context: { usedPct: 28, tokens: 283_000, windowSize: 1_000_000 },
				limits: [
					fiveHour(41, 4_320_000),
					sevenDay(18, 280_000_000),
					{ label: "Fable", usedPct: 25, resetsAtMs: nowMs + 280_000_000, scopedModel: "Fable" },
				],
			}),
		},
		{
			title: "Codex: no cost or PR data, cache hit rate, 5h limit on pace to run out",
			snapshot: toSnapshot("codex", {
				model: { name: "GPT-6 Astra", family: "gpt-6-astra" },
				effort: "xhigh",
				dir,
				git: dirty,
				stats: { costUsd: null, durationMs: 1_380_000, linesAdded: 156, linesRemoved: 23 },
				cache: { hitPct: 96 },
				context: { usedPct: 58, tokens: 146_000, windowSize: 243_200 },
				limits: [fiveHour(72, 7_200_000), sevenDay(18, 280_000_000)],
			}),
		},
		{
			title: "omp: fast tier, merge conflict, critical limits, account tier window",
			snapshot: toSnapshot("omp", {
				model: { name: "GPT-5.5", family: "gpt-5.5", isFast: true },
				effort: "high",
				dir: { name: "my-app", relative: "packages/core", worktree: null },
				git: { branch: "main", behind: 3, conflicts: 1 },
				pr: { number: 77, url: "https://gitlab.com/octocat/my-app/-/merge_requests/77", state: "changes_requested", kind: "mr" },
				stats: { costUsd: 12.5, durationMs: 9_000_000 },
				cache: { hitPct: 87 },
				context: { usedPct: 88, tokens: 240_000, windowSize: 272_000 },
				limits: [fiveHour(95, 2_400_000), sevenDay(83, 280_000_000)],
			}),
		},
		{
			title: "OpenCode: running subagents and shells, no usage limits",
			snapshot: toSnapshot("opencode", {
				model: { name: "Opus 5.5", family: "claude-opus" },
				effort: "max",
				dir: { name: "my-app", relative: "src/lib/statusline", worktree: null },
				git: { branch: "feature/statusline", ahead: 2, staged: 1, modified: 3, untracked: 1 },
				counts: { subagents: 2, shells: 1 },
				stats: { costUsd: 4.21, durationMs: 1_380_000, linesAdded: 156, linesRemoved: 23 },
				context: { usedPct: 28.3, tokens: 283_000, windowSize: 1_000_000 },
			}),
		},
	];
}

/**
 * A remote session in tmux inside a virtualenv, with today's cost: the environment chips and the
 * `Σ` stat. Separate from demoCases, which stays one case per harness.
 */
export function demoChipsCase(nowMs: number): DemoCase {
	return {
		title: "Environment chips: over SSH, in tmux, in a virtualenv, plus today's cost across harnesses",
		snapshot: toSnapshot("claude", {
			model: { name: "Opus 5.5", family: "claude-opus-5-5[1m]" },
			effort: "high",
			dir: { name: "my-app", relative: "", worktree: null },
			git: { branch: "main", modified: 1 },
			stats: { costUsd: 4.21, durationMs: 1_380_000, linesAdded: 156, linesRemoved: 23 },
			context: { usedPct: 28, tokens: 283_000, windowSize: 1_000_000 },
			limits: [{ label: "5h", usedPct: 41, resetsAtMs: nowMs + 4_320_000, windowMs: 18_000_000 }],
			env: { ssh: "dev-box", tmux: "work:editor", venv: ".venv", k8s: null },
			todayCostUsd: 12.34,
		}),
	};
}

/** Agent panel rows for the demo: running, just started, and finished. */
export function demoAgents(nowMs: number): RunningAgent[] {
	return (
		toSnapshot("claude", {
			agents: [
				{
					id: "a",
					name: "reviewer",
					label: "Reading statusline.ts",
					status: "running",
					startedAtMs: nowMs - 200_000,
					model: "claude-opus-5-5[1m]",
					effort: "high",
					windowSize: 1_000_000,
					tokens: 312_000,
				},
				{
					id: "b",
					label: "Find the auth handlers",
					status: "running",
					startedAtMs: nowMs - 42_000,
					model: "claude-haiku-4-5-20251001",
					windowSize: 200_000,
					tokens: 148_000,
				},
				{
					id: "c",
					label: "Summarize the open issues",
					status: "completed",
					startedAtMs: nowMs - 600_000,
					model: "claude-sonnet-5-5",
					effort: "medium",
					windowSize: 1_000_000,
					tokens: 61_000,
				},
			],
		}).agents ?? []
	);
}
