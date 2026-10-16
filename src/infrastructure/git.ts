import { readFileSync, statSync } from "node:fs";
import * as path from "node:path";
import type { GitPort, GitReading } from "../application/ports.ts";
import type { GitState } from "../domain/model/snapshot.ts";
import { type CommandRunner, run } from "./process.ts";

/** Walk up from `cwd` to the checkout root; `main` differs from `top` in a linked worktree. */
export function findGitRoot(cwd: string): { top: string; main: string } | null {
	let dir = path.resolve(cwd);
	for (;;) {
		const dotGit = path.join(dir, ".git");
		try {
			if (statSync(dotGit).isDirectory()) return { top: dir, main: dir };
			// Linked worktree: "gitdir: <main>/.git/worktrees/<name>"
			const line = readFileSync(dotGit, "utf8").split("\n")[0] ?? "";
			const m = /^gitdir: (.*)\/\.git\/worktrees\/[^/]+$/.exec(line.trim());
			return { top: dir, main: m?.[1] ?? dir };
		} catch {}
		const parent = path.dirname(dir);
		if (parent === dir) return null;
		dir = parent;
	}
}

/** `git status --porcelain=v2 --branch` output; null without a branch line (not a repository). */
export function parsePorcelain(raw: string): GitState | null {
	let head: string | null = null;
	let oid = "";
	const state: GitState = { branch: "", ahead: 0, behind: 0, conflicts: 0, staged: 0, modified: 0, untracked: 0, detachedOid: null };
	for (const line of raw.split("\n")) {
		if (line.startsWith("# branch.oid ")) oid = line.slice(13).trim();
		else if (line.startsWith("# branch.head ")) head = line.slice(14).trim();
		else if (line.startsWith("# branch.ab ")) {
			const [a, b] = line.slice(12).split(" ");
			state.ahead = Number.parseInt(a?.replace("+", "") ?? "", 10) || 0;
			state.behind = Number.parseInt(b?.replace("-", "") ?? "", 10) || 0;
		} else if (line.startsWith("1 ") || line.startsWith("2 ")) {
			if (line[2] !== ".") state.staged++;
			if (line[3] !== ".") state.modified++;
		} else if (line.startsWith("u ")) state.conflicts++;
		else if (line.startsWith("? ")) state.untracked++;
	}
	if (head === null || head === "") return null;
	if (head === "(detached)") state.detachedOid = oid;
	else state.branch = head;
	return state;
}

export interface LineTotals {
	added: number;
	removed: number;
}

/** `git diff --shortstat`: "3 files changed, 10 insertions(+), 2 deletions(-)". */
export function parseShortstat(raw: string): LineTotals {
	return {
		added: Number.parseInt(/(\d+) insertion/.exec(raw)?.[1] ?? "", 10) || 0,
		removed: Number.parseInt(/(\d+) deletion/.exec(raw)?.[1] ?? "", 10) || 0,
	};
}

/** `git diff --numstat`: tab-separated added/removed per file; binary files ("-") are skipped. */
export function parseNumstat(raw: string): LineTotals {
	const total = { added: 0, removed: 0 };
	for (const line of raw.split("\n")) {
		const [a, d] = line.split("\t");
		if (a && d && /^\d+$/.test(a) && /^\d+$/.test(d)) {
			total.added += Number(a);
			total.removed += Number(d);
		}
	}
	return total;
}

const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const GIT = ["git", "--no-optional-locks"];

export class GitAdapter implements GitPort {
	constructor(private readonly exec: CommandRunner = run) {}

	async read(cwd: string): Promise<GitReading | null> {
		const root = findGitRoot(cwd);
		if (!root) return null;
		const [status, head] = await Promise.all([
			this.exec([...GIT, "status", "--porcelain=v2", "--branch"], { cwd }),
			this.exec([...GIT, "diff", "HEAD", "--shortstat", "--no-ext-diff"], { cwd }),
		]);
		if (status === null) return null;
		const state = parsePorcelain(status);
		if (!state) return null;
		// Before the first commit there is no HEAD: diff against the empty tree instead.
		const stat = head ?? (await this.exec([...GIT, "diff", EMPTY_TREE, "--shortstat", "--no-ext-diff"], { cwd }));
		const { added, removed } = parseShortstat(stat ?? "");
		return { ...root, state, linesAdded: added, linesRemoved: removed };
	}
}
