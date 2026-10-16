// The git watcher of the OpenCode plugin. Ported from opencode-statusline test/render.test.ts › git
// (porcelain and shortstat parsing, now through the shared parsers), plus the watcher semantics the
// original tui.tsx had no test for: serialized runs, immediate refresh on a directory change,
// the diff only while dirty, failures clearing the chip.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { GitWatcher, type GitView, NO_GIT } from "../../../src/harnesses/opencode/git-watcher.ts";
import { nodeRunner } from "../../../src/harnesses/opencode/runtime.ts";
import type { CommandRunner } from "../../../src/infrastructure/process.ts";

const CLEAN = "# branch.oid ca8cb99\n# branch.head main\n# branch.ab +0 -0";
const DIRTY = [
	"# branch.oid ca8cb99",
	"# branch.head feature/statusline",
	"# branch.ab +2 -1",
	"1 .M N... 100644 100644 100644 ce01362 ce01362 file.txt",
	"1 M. N... 100644 100644 100644 ce01362 ce01362 staged.txt",
	"2 R. N... 100644 100644 100644 ce01362 ce01362 renamed.txt",
	"u UU N... 100644 100644 100644 100644 ce01362 ce01362 conflict.txt",
	"? extra.txt",
].join("\n");
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

const ROOT = { top: "/repo", main: "/repo" };
const inRepo = () => ROOT;

interface Call {
	args: string[];
	cwd: string | undefined;
}

/** A runner that answers by git subcommand and records every call. */
function fakeGit(answers: { status?: string | null; head?: string | null; empty?: string | null }) {
	const calls: Call[] = [];
	const run: CommandRunner = async (cmd, opts) => {
		calls.push({ args: cmd.slice(1), cwd: opts?.cwd });
		if (cmd.includes("status")) return answers.status ?? null;
		if (cmd.includes("HEAD")) return answers.head ?? null;
		if (cmd.includes(EMPTY_TREE)) return answers.empty ?? null;
		return null;
	};
	return { run, calls };
}

function watcher(run: CommandRunner, extra: Partial<ConstructorParameters<typeof GitWatcher>[0]> = {}) {
	const views: GitView[] = [];
	const instance = new GitWatcher({ run, intervalMs: 4000, onChange: (view) => views.push(view), findRoot: inRepo, ...extra });
	return { instance, views };
}

describe("one poll", () => {
	test("reads branch, tracking and change counts", async () => {
		const clean = watcher(fakeGit({ status: CLEAN }).run);
		await clean.instance.watch("/repo");
		expect(clean.views.at(-1)).toEqual({
			root: ROOT,
			state: { branch: "main", ahead: 0, behind: 0, conflicts: 0, staged: 0, modified: 0, untracked: 0, detachedOid: null },
			linesAdded: 0,
			linesRemoved: 0,
		});

		const dirty = watcher(fakeGit({ status: DIRTY, head: " 2 files changed, 156 insertions(+), 23 deletions(-)" }).run);
		await dirty.instance.watch("/repo");
		expect(dirty.views.at(-1)).toEqual({
			root: ROOT,
			state: { branch: "feature/statusline", ahead: 2, behind: 1, conflicts: 1, staged: 2, modified: 1, untracked: 1, detachedOid: null },
			linesAdded: 156,
			linesRemoved: 23,
		});
	});

	test("keeps the object id for a detached head, and has no state without a branch line", async () => {
		const detached = watcher(fakeGit({ status: "# branch.oid 1234567890abcdef\n# branch.head (detached)" }).run);
		await detached.instance.watch("/repo");
		expect(detached.views.at(-1)?.state).toMatchObject({ branch: "", detachedOid: "1234567890abcdef" });

		for (const status of ["", "? only-a-file"]) {
			const none = watcher(fakeGit({ status }).run);
			await none.instance.watch("/repo");
			expect(none.views.at(-1)).toEqual({ root: ROOT, state: null, linesAdded: 0, linesRemoved: 0 });
		}
	});

	test("reads the diff only while the tree is dirty, without optional locks, in the watched directory", async () => {
		const clean = fakeGit({ status: CLEAN });
		await watcher(clean.run).instance.watch("/repo/sub");
		expect(clean.calls).toEqual([{ args: ["--no-optional-locks", "status", "--porcelain=v2", "--branch"], cwd: "/repo/sub" }]);

		const dirty = fakeGit({ status: DIRTY, head: " 1 file changed, 5 insertions(+)" });
		await watcher(dirty.run).instance.watch("/repo/sub");
		expect(dirty.calls).toEqual([
			{ args: ["--no-optional-locks", "status", "--porcelain=v2", "--branch"], cwd: "/repo/sub" },
			{ args: ["--no-optional-locks", "diff", "HEAD", "--shortstat", "--no-ext-diff"], cwd: "/repo/sub" },
		]);
	});

	test("a untracked-only tree counts as dirty", async () => {
		const git = fakeGit({ status: `${CLEAN}\n? new.txt`, head: " 1 file changed, 2 insertions(+), 1 deletion(-)" });
		const { instance, views } = watcher(git.run);
		await instance.watch("/repo");
		expect(git.calls).toHaveLength(2);
		expect(views.at(-1)).toMatchObject({ linesAdded: 2, linesRemoved: 1 });
	});

	test("before the first commit it diffs against the empty tree", async () => {
		const git = fakeGit({ status: DIRTY, head: null, empty: " 1 file changed, 7 insertions(+)" });
		const { instance, views } = watcher(git.run);
		await instance.watch("/repo");
		expect(git.calls.at(-1)?.args).toEqual(["--no-optional-locks", "diff", EMPTY_TREE, "--shortstat", "--no-ext-diff"]);
		expect(views.at(-1)).toMatchObject({ linesAdded: 7, linesRemoved: 0 });

		const neither = watcher(fakeGit({ status: DIRTY }).run);
		await neither.instance.watch("/repo");
		expect(neither.views.at(-1)).toMatchObject({ linesAdded: 0, linesRemoved: 0 });
	});
});

describe("failures clear the chip", () => {
	test("outside a repository nothing runs and the view is empty", async () => {
		const git = fakeGit({ status: CLEAN });
		const { instance, views } = watcher(git.run, { findRoot: () => null });
		await instance.watch("/tmp/scratch");
		expect(git.calls).toEqual([]);
		expect(views.at(-1)).toEqual(NO_GIT);
	});

	test("a failing or missing git keeps the checkout root but drops the state", async () => {
		const { instance, views } = watcher(fakeGit({ status: null }).run);
		await instance.watch("/repo");
		expect(views.at(-1)).toEqual({ root: ROOT, state: null, linesAdded: 0, linesRemoved: 0 });
	});

	test("a runner that throws clears everything", async () => {
		const { instance, views } = watcher(async () => {
			throw new Error("spawn failed");
		});
		await instance.watch("/repo");
		expect(views.at(-1)).toEqual(NO_GIT);
	});

	test("a good poll after a failed one brings the chip back", async () => {
		let status: string | null = null;
		const { instance, views } = watcher(async () => status);
		await instance.watch("/repo");
		expect(views.at(-1)?.state).toBeNull();
		status = CLEAN;
		await instance.refresh();
		expect(views.at(-1)?.state?.branch).toBe("main");
	});

	test("watching no directory clears the view", async () => {
		const { instance, views } = watcher(fakeGit({ status: CLEAN }).run);
		await instance.watch("/repo");
		await instance.watch(undefined);
		expect(views.at(-1)).toEqual(NO_GIT);
	});
});

/** A runner whose answers are released by hand. */
function gatedGit(status: string) {
	const started: string[] = [];
	const gates: Array<() => void> = [];
	const waiting: Array<() => void> = [];
	const run: CommandRunner = (cmd, opts) => {
		started.push(opts?.cwd ?? "");
		const { promise, resolve } = Promise.withResolvers<string | null>();
		gates.push(() => resolve(cmd.includes("status") ? status : null));
		waiting.shift()?.();
		return promise;
	};
	return {
		run,
		started,
		release: () => gates.shift()?.(),
		/** Resolves when the runner is called the next time. */
		nextStart: () => {
			const { promise, resolve } = Promise.withResolvers<void>();
			waiting.push(resolve);
			return promise;
		},
	};
}

describe("scheduling", () => {
	test("a new directory is read at once", () => {
		const git = fakeGit({ status: CLEAN });
		const { instance } = watcher(git.run);
		void instance.watch("/repo/a");
		// Synchronously: the poll has already started.
		expect(git.calls.map((call) => call.cwd)).toEqual(["/repo/a"]);
	});

	test("watching the same directory again does not poll", async () => {
		const git = fakeGit({ status: CLEAN });
		const { instance } = watcher(git.run);
		await instance.watch("/repo");
		await instance.watch("/repo");
		expect(git.calls).toHaveLength(1);
	});

	test("runs are serialized: a tick during a run is dropped", async () => {
		const git = gatedGit(CLEAN);
		const { instance, views } = watcher(git.run);
		const first = instance.watch("/repo");
		const second = instance.refresh();
		const third = instance.refresh();
		expect(git.started).toEqual(["/repo"]);
		git.release();
		await Promise.all([first, second, third]);
		expect(git.started).toEqual(["/repo"]);
		expect(views).toHaveLength(1);

		// Once the run ended the next tick polls again.
		const next = instance.refresh();
		expect(git.started).toHaveLength(2);
		git.release();
		await next;
	});

	test("a directory change during a run is read right after it, and the old result is not shown", async () => {
		const git = gatedGit(CLEAN);
		const { instance, views } = watcher(git.run);
		const run = instance.watch("/repo/a");
		void instance.watch("/repo/b");
		expect(git.started).toEqual(["/repo/a"]);
		const restarted = git.nextStart();
		git.release();
		await restarted;
		expect(git.started).toEqual(["/repo/a", "/repo/b"]);
		expect(views).toHaveLength(0);
		git.release();
		await run;
		expect(views).toHaveLength(1);
		expect(views[0]?.state?.branch).toBe("main");
	});

	test("polls on the interval until stopped", async () => {
		const git = fakeGit({ status: CLEAN });
		const scheduled: Array<{ tick: () => void; ms: number; cancelled: boolean }> = [];
		const { instance, views } = watcher(git.run, {
			intervalMs: 1500,
			schedule: (tick, ms) => {
				const timer = { tick, ms, cancelled: false };
				scheduled.push(timer);
				return () => {
					timer.cancelled = true;
				};
			},
		});
		await instance.watch("/repo");
		instance.start();
		instance.start();
		expect(scheduled.map((timer) => timer.ms)).toEqual([1500]);

		scheduled[0]?.tick();
		await instance.refresh();
		expect(git.calls).toHaveLength(2);
		expect(views).toHaveLength(2);

		instance.stop();
		expect(scheduled[0]?.cancelled).toBe(true);
	});

	test("a tick with no directory does nothing", async () => {
		const git = fakeGit({ status: CLEAN });
		const { instance, views } = watcher(git.run);
		await instance.refresh();
		expect(git.calls).toEqual([]);
		expect(views).toEqual([]);
	});
});

describe("a real repository", () => {
	let dir: string;
	afterEach(() => rmSync(dir, { recursive: true, force: true }));

	test("the node runner and the shared parsers read branch, change counts and diff lines", async () => {
		dir = realpathSync(mkdtempSync(path.join(tmpdir(), "oms-opencode-git-")));
		const git = (...args: string[]) => {
			const result = Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", ...args], { cwd: dir, env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" } });
			if (result.exitCode !== 0) throw new Error(result.stderr.toString());
		};
		git("init", "-q", "-b", "main");
		writeFileSync(path.join(dir, "a.txt"), "one\ntwo\n");
		git("add", "a.txt");
		git("commit", "-q", "-m", "first");
		mkdirSync(path.join(dir, "sub"));

		const views: GitView[] = [];
		const real = new GitWatcher({ run: nodeRunner, intervalMs: 4000, onChange: (view) => views.push(view) });
		await real.watch(path.join(dir, "sub"));
		expect(views.at(-1)?.root?.top).toBe(dir);
		expect(views.at(-1)?.state).toMatchObject({ branch: "main", modified: 0, untracked: 0 });
		expect(views.at(-1)).toMatchObject({ linesAdded: 0, linesRemoved: 0 });

		writeFileSync(path.join(dir, "a.txt"), "one\nthree\nfour\n");
		writeFileSync(path.join(dir, "b.txt"), "new\n");
		await real.refresh();
		expect(views.at(-1)?.state).toMatchObject({ branch: "main", modified: 1, untracked: 1 });
		expect(views.at(-1)).toMatchObject({ linesAdded: 2, linesRemoved: 1 });
	});
});
