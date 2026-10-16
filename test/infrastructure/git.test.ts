import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { findGitRoot, GitAdapter, parseNumstat, parsePorcelain, parseShortstat } from "../../src/infrastructure/git.ts";

let tmp: string;
beforeEach(() => {
	tmp = realpathSync(mkdtempSync(path.join(tmpdir(), "oms-git-")));
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

const ID = ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "init.defaultBranch=main", "-c", "commit.gpgsign=false"];
function git(cwd: string, ...args: string[]): void {
	const p = Bun.spawnSync(["git", ...ID, ...args], { cwd, stdout: "ignore", stderr: "pipe" });
	if (p.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${p.stderr.toString()}`);
}
function repo(name = "repo"): string {
	const dir = path.join(tmp, name);
	mkdirSync(dir);
	git(dir, "init", "-q");
	return dir;
}
function commit(dir: string): void {
	writeFileSync(path.join(dir, "a.txt"), "one\ntwo\nthree\n");
	git(dir, "add", ".");
	git(dir, "commit", "-q", "-m", "init");
}

test("parsePorcelain counts entries and branch info", () => {
	const raw = [
		"# branch.oid abc123",
		"# branch.head feat",
		"# branch.upstream origin/feat",
		"# branch.ab +2 -1",
		"1 M. N... 100644 100644 100644 a b x",
		"1 .M N... 100644 100644 100644 a b y",
		"2 R. N... 100644 100644 100644 a b R100 z\told",
		"u UU N... 1 2 3 4 a b c w",
		"? new.txt",
	].join("\n");
	expect(parsePorcelain(raw)).toEqual({
		branch: "feat",
		ahead: 2,
		behind: 1,
		conflicts: 1,
		staged: 2,
		modified: 1,
		untracked: 1,
		detachedOid: null,
	});
});

test("parsePorcelain detached and missing branch", () => {
	const d = parsePorcelain("# branch.oid deadbeef\n# branch.head (detached)\n");
	expect(d?.branch).toBe("");
	expect(d?.detachedOid).toBe("deadbeef");
	expect(parsePorcelain("")).toBeNull();
});

test("parseShortstat and parseNumstat", () => {
	expect(parseShortstat(" 3 files changed, 10 insertions(+), 2 deletions(-)")).toEqual({ added: 10, removed: 2 });
	expect(parseShortstat(" 1 file changed, 1 deletion(-)")).toEqual({ added: 0, removed: 1 });
	expect(parseShortstat("")).toEqual({ added: 0, removed: 0 });
	expect(parseNumstat("3\t1\ta.ts\n-\t-\timg.png\n2\t0\tb.ts\n")).toEqual({ added: 5, removed: 1 });
});

test("clean repository", async () => {
	const dir = repo();
	commit(dir);
	const r = await new GitAdapter().read(dir);
	expect(r?.top).toBe(dir);
	expect(r?.main).toBe(dir);
	expect(r?.state.branch).toBe("main");
	expect(r?.state).toMatchObject({ staged: 0, modified: 0, untracked: 0 });
	expect([r?.linesAdded, r?.linesRemoved]).toEqual([0, 0]);
});

test("dirty repository", async () => {
	const dir = repo();
	commit(dir);
	writeFileSync(path.join(dir, "a.txt"), "one\nTWO\nthree\nfour\n"); // +2 -1
	writeFileSync(path.join(dir, "s.txt"), "x\ny\n");
	git(dir, "add", "s.txt"); // +2 staged
	writeFileSync(path.join(dir, "u.txt"), "untracked\n");
	const r = await new GitAdapter().read(path.join(dir));
	expect(r?.state).toMatchObject({ staged: 1, modified: 1, untracked: 1 });
	expect([r?.linesAdded, r?.linesRemoved]).toEqual([4, 1]);
});

test("before the first commit diffs against the empty tree", async () => {
	const dir = repo();
	writeFileSync(path.join(dir, "a.txt"), "one\ntwo\n");
	git(dir, "add", ".");
	const r = await new GitAdapter().read(dir);
	expect(r?.state.branch).toBe("main");
	expect([r?.linesAdded, r?.linesRemoved]).toEqual([2, 0]);
});

test("detached HEAD", async () => {
	const dir = repo();
	commit(dir);
	git(dir, "checkout", "-q", "--detach");
	const r = await new GitAdapter().read(dir);
	expect(r?.state.branch).toBe("");
	expect(r?.state.detachedOid).toMatch(/^[0-9a-f]{40}$/);
});

test("linked worktree has top different from main", async () => {
	const dir = repo();
	commit(dir);
	const wt = path.join(tmp, "wt");
	git(dir, "worktree", "add", "-q", "-b", "side", wt);
	const r = await new GitAdapter().read(wt);
	expect(r?.top).toBe(wt);
	expect(r?.main).toBe(dir);
	expect(r?.state.branch).toBe("side");
	expect(findGitRoot(path.join(wt))).toEqual({ top: wt, main: dir });
});

test("outside a repository returns null", async () => {
	expect(await new GitAdapter().read(tmp)).toBeNull();
});

test("a timed-out or failing runner returns null", async () => {
	const dir = repo();
	expect(await new GitAdapter(async () => null).read(dir)).toBeNull();
});
