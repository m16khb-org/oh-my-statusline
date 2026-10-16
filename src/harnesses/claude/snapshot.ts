// Claude Code's statusLine session JSON → StatusSnapshot. Field for field, this is what the
// original statusline.sh read through its jq program; nothing else of the payload is used.
// Numeric strings are accepted the way jq's `tonumber` accepts them, and a missing optional part
// becomes `null` (the segment is omitted) instead of the text "null".

import type { GitReading } from "../../application/ports.ts";
import { type EnvChips, type LimitWindow, type PrState, type StatusSnapshot, toSnapshot } from "../../domain/model/snapshot.ts";
import { toDirInfo } from "../../domain/model/dir.ts";
import { finiteNumber } from "../../domain/model/values.ts";

export type Json = Record<string, unknown>;

const FIVE_HOURS_MS = 18_000_000;
const SEVEN_DAYS_MS = 604_800_000;

/** The value as an object; `{}` for anything else, so optional chains need no guards. */
export function asObject(value: unknown): Json {
	return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Json) : {};
}

/** jq's `a // b // c`: the first value that is neither null nor false. */
export function alt(...values: unknown[]): unknown {
	return values.find((value) => value !== undefined && value !== null && value !== false);
}

/** jq's `tostring` for the scalar types a payload carries; anything else is empty. */
export function text(value: unknown): string {
	return typeof value === "string" ? value : typeof value === "number" ? String(value) : "";
}

/** jq's `int`: a number or numeric string, floored; 0 for anything else. */
export function wholeNumber(value: unknown): number {
	return Math.floor(finiteNumber(value) ?? 0);
}

/** The session's working directory: `workspace.current_dir`, else `cwd`, else the process directory. */
export function sessionCwd(session: Json, fallback: string): string {
	return text(alt(asObject(session.workspace).current_dir, session.cwd)) || fallback;
}

export interface SessionContext {
	nowMs: number;
	/** The checkout roots found by walking up from the working directory; null outside a repository. */
	roots: { top: string; main: string } | null;
	/** The cached or fresh git reading of the working directory; null outside a repository. */
	git: GitReading | null;
	/** Model-scoped weekly windows (e.g. Fable) the status input does not carry. */
	scopedLimits: readonly LimitWindow[];
	cwd: string;
	/** Environment chips (ssh, tmux, venv, k8s); absent when none apply. */
	env?: EnvChips | null;
	/** The cached gh/glab pull request, used only when the session JSON names none. */
	pr?: PrState | null;
	/** Today's cost across all harnesses; null or absent leaves the chip out. */
	todayCostUsd?: number | null;
}

function limitWindow(label: string, window: unknown, windowMs: number): LimitWindow[] {
	const w = asObject(window);
	const usedPct = finiteNumber(w.used_percentage);
	if (usedPct === undefined) return [];
	const resetsAtS = wholeNumber(w.resets_at);
	return [{ label, usedPct, resetsAtMs: resetsAtS > 0 ? resetsAtS * 1000 : null, windowMs, scopedModel: null }];
}

export function toClaudeSnapshot(session: Json, ctx: SessionContext): StatusSnapshot {
	const workspace = asObject(session.workspace);
	const model = asObject(session.model);
	const cost = asObject(session.cost);
	const window = asObject(session.context_window);
	const limits = asObject(session.rate_limits);
	const promptCache = asObject(session.prompt_cache);
	const pr = asObject(session.pr);

	// Outside a repository the project directory stands in for the checkout root.
	const dir = toDirInfo({
		cwd: ctx.cwd,
		top: ctx.roots?.top ?? text(workspace.project_dir),
		main: ctx.roots?.main,
		repoName: text(asObject(workspace.repo).name),
	});
	const worktree = text(workspace.git_worktree) || dir.worktree;

	const usedPct = finiteNumber(window.used_percentage);
	const warm = promptCache.warm === true;
	const nowS = Math.floor(ctx.nowMs / 1000);

	return toSnapshot("claude", {
		// `Opus 5.5 (1M context)` shows as `Opus 5.5`.
		model: { name: text(alt(model.display_name, model.id)).replace(/ *\([^)]*\)$/, ""), family: text(model.id), isFast: session.fast_mode === true },
		effort: text(asObject(session.effort).level),
		dir: { ...dir, worktree },
		git: ctx.git?.state ?? null,
		pr: wholeNumber(pr.number) > 0 ? { number: pr.number, url: text(pr.url), state: text(pr.review_state), kind: text(pr.kind) } : (ctx.pr ?? null),
		// Line totals come from the working tree, not cost.total_lines_*: that counts every
		// Edit/Write, including files outside the repository and edits since undone or committed.
		stats: {
			costUsd: finiteNumber(cost.total_cost_usd) ?? null,
			durationMs: finiteNumber(cost.total_duration_ms) ?? 0,
			linesAdded: ctx.git?.linesAdded ?? 0,
			linesRemoved: ctx.git?.linesRemoved ?? 0,
		},
		cache: warm ? { hitPct: null, ttlRemainingMs: (wholeNumber(promptCache.expires_at) - nowS) * 1000 } : null,
		context:
			usedPct === undefined
				? null
				: {
						usedPct,
						tokens: wholeNumber(window.total_input_tokens),
						windowSize: wholeNumber(window.context_window_size),
						exceeds200k: session.exceeds_200k_tokens === true,
					},
		limits: [
			...limitWindow("5h", limits.five_hour, FIVE_HOURS_MS),
			...limitWindow("7d", limits.seven_day, SEVEN_DAYS_MS),
			...ctx.scopedLimits,
		],
		env: ctx.env,
		todayCostUsd: ctx.todayCostUsd,
	});
}
