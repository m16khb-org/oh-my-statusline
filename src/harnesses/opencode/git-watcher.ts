// Polls the working tree of one directory for the git chip. `git status` can take a few hundred
// milliseconds in a busy repository, so runs are serialized, the interval is generous, and the
// diff is only read while the tree is dirty. Every failure (outside a repository, timeout, git
// missing) clears the chip. Parsing is the shared infrastructure's.

import type { GitState } from "../../domain/model/snapshot.ts";
import { EMPTY_TREE, findGitRoot, GIT, parsePorcelain, parseShortstat } from "../../infrastructure/git.ts";
import type { CommandRunner } from "../../infrastructure/process.ts";

/** What the last poll found. `root` is known even when the status read failed. */
export interface GitView {
	root: { top: string; main: string } | null;
	state: GitState | null;
	linesAdded: number;
	linesRemoved: number;
}

export const NO_GIT: GitView = { root: null, state: null, linesAdded: 0, linesRemoved: 0 };

export interface GitWatcherOptions {
	run: CommandRunner;
	intervalMs: number;
	onChange: (view: GitView) => void;
	/** Test seams: the checkout lookup and the interval timer. */
	findRoot?: typeof findGitRoot;
	schedule?: (tick: () => void, ms: number) => () => void;
}

const everyMs: NonNullable<GitWatcherOptions["schedule"]> = (tick, ms) => {
	const id = setInterval(tick, ms);
	return () => clearInterval(id);
};

export class GitWatcher {
	private directory: string | undefined;
	private running: Promise<void> | null = null;
	/** The directory changed while a run was in flight: read again once it ends. */
	private again = false;
	private cancel: (() => void) | null = null;

	constructor(private readonly options: GitWatcherOptions) {}

	/** Poll on the interval until `stop()`. */
	start(): void {
		this.cancel ??= (this.options.schedule ?? everyMs)(() => void this.refresh(), this.options.intervalMs);
	}

	stop(): void {
		this.cancel?.();
		this.cancel = null;
	}

	/** Follow another directory: read it at once. With none, the chip is cleared. */
	watch(directory: string | undefined): Promise<void> {
		if (directory === this.directory) return this.running ?? Promise.resolve();
		this.directory = directory;
		if (directory === undefined) {
			this.options.onChange(NO_GIT);
			return Promise.resolve();
		}
		if (this.running) {
			this.again = true;
			return this.running;
		}
		return this.refresh();
	}

	/** One poll of the watched directory. A tick that arrives during a run is dropped. */
	refresh(): Promise<void> {
		if (this.running) return this.running;
		if (this.directory === undefined) return Promise.resolve();
		const run = this.loop().finally(() => {
			this.running = null;
		});
		this.running = run;
		return run;
	}

	private async loop(): Promise<void> {
		do {
			this.again = false;
			const directory = this.directory;
			if (directory === undefined) return;
			const view = await this.read(directory);
			// A result for a directory we have left is stale.
			if (this.directory === directory) this.options.onChange(view);
		} while (this.again);
	}

	private async read(directory: string): Promise<GitView> {
		try {
			const root = (this.options.findRoot ?? findGitRoot)(directory);
			if (!root) return NO_GIT;
			const view: GitView = { root, state: null, linesAdded: 0, linesRemoved: 0 };
			const status = await this.options.run([...GIT, "status", "--porcelain=v2", "--branch"], { cwd: directory });
			const state = status === null ? null : parsePorcelain(status);
			if (!state) return view;
			view.state = state;
			if (state.staged + state.modified + state.untracked + state.conflicts > 0) {
				const head = await this.options.run([...GIT, "diff", "HEAD", "--shortstat", "--no-ext-diff"], { cwd: directory });
				// Before the first commit there is no HEAD: diff against the empty tree instead.
				const stat = head ?? (await this.options.run([...GIT, "diff", EMPTY_TREE, "--shortstat", "--no-ext-diff"], { cwd: directory }));
				const { added, removed } = parseShortstat(stat ?? "");
				view.linesAdded = added;
				view.linesRemoved = removed;
			}
			return view;
		} catch {
			return NO_GIT;
		}
	}
}
