// OpenCode's data → the harness-neutral StatusSnapshot.
//
// What OpenCode has no data for stays null in the snapshot, so its segments are left out: the
// 5h/7d/per-model plan limits (`limits` is empty), the PR/MR chip (`pr`), and the prompt-cache
// hit rate and TTL (`cache`). A disabled option is expressed the same way: its field is null or
// empty, never a flag the renderer would have to know about.

import { toDirInfo } from "../../domain/model/dir.ts";
import { type StatusSnapshot, toSnapshot } from "../../domain/model/snapshot.ts";
import type { GitView } from "./git-watcher.ts";
import type { Options } from "./options.ts";

/** What the plugin collects from the TUI before options and the clock are applied. */
export interface StatusInput {
	/** Display name, provider family (for the chip color) and the model's effort variant. */
	model?: { name: string; family: string; effort?: string };
	directory: string;
	/** The session's subpath inside its checkout: a linked worktree's folder. */
	subpath?: string;
	/** The branch OpenCode's own VCS info reports; a worktree named like it is not repeated. */
	branch?: string;
	git: GitView;
	/** Running subagents and shells; undefined where there is no session to count for. */
	counts?: { subagents: number; shells: number };
	costUsd: number;
	/** When the session started, epoch milliseconds. */
	createdMs?: number;
	context?: ContextUsage;
}

export interface ContextUsage {
	/** Tokens the next request would resend. */
	tokens: number;
	/** The model's context window, when it is known. */
	limit?: number;
}

interface TokenLike {
	input: number;
	output: number;
	reasoning: number;
	cache: { read: number; write: number };
}

export interface MessageLike {
	type?: string;
	tokens?: TokenLike;
	model?: { id: string; providerID: string };
}

export interface ModelLike {
	id: string;
	modelID?: string;
	providerID: string;
	limit?: { context?: number };
}

/**
 * Context used by the next request: the totals of the last assistant message, the same sum the
 * TUI's own `% used` uses. `models` supplies the context window for the percentage.
 */
export function contextUsage(messages: readonly MessageLike[], models: readonly ModelLike[]): ContextUsage | undefined {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		if (message?.type !== "assistant" || !message.tokens || !message.model) continue;
		const { input, output, reasoning, cache } = message.tokens;
		const tokens = input + output + reasoning + cache.read + cache.write;
		if (!(tokens > 0)) continue;
		const { id, providerID } = message.model;
		const info = models.find((model) => model.providerID === providerID && (model.id === id || model.modelID === id));
		const limit = typeof info?.limit?.context === "number" && info.limit.context > 0 ? info.limit.context : undefined;
		return { tokens, limit };
	}
	return undefined;
}

/** The snapshot the renderer draws, with `options` and the clock applied. */
export function toStatusSnapshot(input: StatusInput, options: Options, nowMs: number): StatusSnapshot {
	const { git } = input;
	const dir = toDirInfo({ cwd: input.directory, top: git.root?.top });
	const subpath = (input.subpath ?? "").replace(/\/+$/, "");
	const worktree = subpath === "." ? "" : subpath.slice(subpath.lastIndexOf("/") + 1);
	const showWorktree = worktree !== "" && worktree !== input.branch && worktree !== dir.name;
	const { context } = input;

	return toSnapshot("opencode", {
		model: { name: options.model ? (input.model?.name ?? "") : "", family: input.model?.family ?? "" },
		// The effort needs a model to exist, not the model chip to be switched on.
		effort: options.effort ? (input.model?.effort ?? "") : "",
		dir: options.dir ? { name: dir.name, relative: dir.relative, worktree: showWorktree ? worktree : null } : { name: "", relative: "", worktree: null },
		git: options.git && git.state ? git.state : null,
		pr: null,
		stats: {
			costUsd: options.cost ? input.costUsd : null,
			durationMs: options.elapsed && input.createdMs !== undefined ? Math.max(0, nowMs - input.createdMs) : 0,
			linesAdded: options.lines ? git.linesAdded : 0,
			linesRemoved: options.lines ? git.linesRemoved : 0,
		},
		cache: null,
		// Without a known window there is no share to show: the gauge row is left out.
		context:
			options.context && context?.limit !== undefined
				? { usedPct: (context.tokens / context.limit) * 100, tokens: context.tokens, windowSize: context.limit }
				: null,
		limits: [],
		counts: options.counts && input.counts ? input.counts : null,
	});
}

/** The fixed sample session behind the `demo` option. */
export function demoInput(nowMs: number): StatusInput {
	return {
		model: { name: "Opus 5.5", family: "claude-opus", effort: "max" },
		directory: "/home/you/my-app/src/lib/statusline",
		git: {
			root: { top: "/home/you/my-app", main: "/home/you/my-app" },
			state: { branch: "feature/statusline", ahead: 2, behind: 0, conflicts: 0, staged: 1, modified: 3, untracked: 1, detachedOid: null },
			linesAdded: 156,
			linesRemoved: 23,
		},
		counts: { subagents: 2, shells: 0 },
		costUsd: 4.21,
		createdMs: nowMs - 23 * 60_000,
		context: { tokens: 283_000, limit: 1_000_000 },
	};
}
