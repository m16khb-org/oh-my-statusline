// Git and usage data through the file cache: stale-first rendering, background refresh, and the
// working-tree line counts. Ported from test_statusline.py (test_line_counts_come_from_the_
// working_tree_diff, test_stale_git_cache_renders_immediately_and_refreshes_in_background,
// test_model_scoped_gauge_reads_fresh_cache, test_malformed_usage_lines_are_skipped).

import { afterEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { runClaude } from "../../../src/harnesses/claude/main.ts";
import { GitAdapter } from "../../../src/infrastructure/git.ts";
import { cleanTemps, FABLE, git, GIT_CLEAN, gitReading, harness, makeRepo, NOW_MS, render, session, strip, writeAged } from "./support.ts";

afterEach(cleanTemps);

const CWD = "/home/you/src/my-app";
const KEY = `claude-git:${CWD}`;
const input = () => session(CWD);

/** A harness whose git cache holds `branch`, stored `ageMs` before the clock. */
function withCachedGit(ageMs: number, branch = "cached-branch") {
	const h = harness({ git: GIT_CLEAN });
	writeAged(h, KEY, gitReading(`# branch.oid ca8cb99\n# branch.head ${branch}\n`), ageMs);
	return h;
}

describe("git through the cache", () => {
	test("the first render in a directory waits for git once, then caches it", async () => {
		const h = harness();
		const { rows } = await render(h, input());
		expect(strip(rows[0]!)).toContain("main");
		expect(h.git.calls).toEqual([CWD]);
		expect(h.cache.read(KEY)?.storedAtMs).toBe(NOW_MS);
		expect(h.spawned.filter(([kind]) => kind === "git")).toEqual([]);
	});

	test("a fresh entry is used without git or a background refresh", async () => {
		const h = withCachedGit(4_000);
		const { rows } = await render(h, input());
		expect(strip(rows[0]!)).toContain("cached-branch");
		expect(h.git.calls).toEqual([]);
		expect(h.spawned.filter(([kind]) => kind === "git")).toEqual([]);
	});

	test("a stale entry is drawn at once and refreshed by one detached process, which updates the cache", async () => {
		const h = withCachedGit(600_000);
		const { rows } = await render(h, input());
		expect(strip(rows[0]!)).toContain("cached-branch");
		expect(h.git.calls).toEqual([]);
		expect(h.spawned.filter(([kind]) => kind === "git")).toEqual([["git", CWD]]);

		// The detached helper: `main.ts --refresh git <cwd>`.
		expect(await runClaude(["--refresh", "git", CWD], "", h.deps)).toBe("");
		expect(h.git.calls).toEqual([CWD]);
		expect(h.cache.lock(KEY, 30_000)).toBe(true); // the refresh released its lock
		h.cache.unlock(KEY);
		expect(strip((await render(h, input())).rows[0]!)).toContain("main");
	});

	test("an entry stamped in the future counts as stale", async () => {
		const h = withCachedGit(-60_000);
		await render(h, input());
		expect(h.spawned.filter(([kind]) => kind === "git")).toEqual([["git", CWD]]);
	});

	test("a failed refresh keeps the old entry", async () => {
		const h = withCachedGit(600_000);
		h.git.reading = null;
		await runClaude(["--refresh", "git", CWD], "", h.deps);
		expect(h.git.calls).toEqual([CWD]);
		expect(strip((await render(h, input())).rows[0]!)).toContain("cached-branch");
	});

	test("a refresh does not start while another process holds the lock, and skips a fresh entry", async () => {
		const locked = withCachedGit(600_000);
		expect(locked.cache.lock(KEY, 30_000)).toBe(true);
		await runClaude(["--refresh", "git", CWD], "", locked.deps);
		expect(locked.git.calls).toEqual([]);

		const fresh = withCachedGit(1_000);
		await runClaude(["--refresh", "git", CWD], "", fresh.deps);
		expect(fresh.git.calls).toEqual([]);
	});

	test("outside a repository nothing is cached and the rows have no git chip", async () => {
		const h = harness({ git: null });
		const { rows } = await render(h, input());
		expect(rows).toHaveLength(2);
		expect(h.cache.read(KEY)).toBeNull();
	});
});

describe("line counts come from the working tree, with real git", () => {
	test("staged and unstaged changes against HEAD, untracked files not counted", async () => {
		const repo = makeRepo();
		const file = (name: string, body: string) => writeFileSync(path.join(repo, name), body);
		file("a.txt", "one\ntwo\nthree\n");
		git(repo, "add", "a.txt");
		git(repo, "commit", "-q", "-m", "init");
		file("a.txt", "one\n2\nthree\nfour\n"); // unstaged: +2 −1
		file("b.txt", "x\ny\n");
		git(repo, "add", "b.txt"); // staged: +2
		file("untracked.txt", "not counted\n");

		const h = harness();
		h.deps.git = new GitAdapter();
		const { rows } = await render(h, session(repo));
		expect(strip(rows[0]!)).toContain("+4 −1");
	});

	test("before the first commit the staged files count against the empty tree", async () => {
		const repo = makeRepo();
		writeFileSync(path.join(repo, "a.txt"), "one\ntwo\n");
		git(repo, "add", "a.txt");
		const h = harness();
		h.deps.git = new GitAdapter();
		expect(strip((await render(h, session(repo))).rows[0]!)).toContain("+2");
	});
});

describe("usage through the cache (per-model weekly limits)", () => {
	test("a fresh entry shows the scoped window and starts no refresh", async () => {
		const h = harness();
		h.cache.write("claude-usage", [FABLE]);
		const { rows } = await render(h, input());
		expect(strip(rows[1]!)).toContain("Fable");
		expect(h.spawned.filter(([kind]) => kind === "usage")).toEqual([]);
	});

	test("a stale entry is still shown and always refreshed in the background", async () => {
		const h = harness();
		writeAged(h, "claude-usage", [FABLE], 121_000);
		const { rows } = await render(h, input());
		expect(strip(rows[1]!)).toContain("Fable");
		expect(h.spawned.filter(([kind]) => kind === "usage")).toEqual([["usage"]]);
		expect(h.usage.reads).toBe(0); // never on the render path
	});

	test("a missing entry shows no window and starts a refresh", async () => {
		const h = harness();
		const { rows } = await render(h, input());
		expect(strip(rows[1]!)).not.toContain("Fable");
		expect(h.spawned).toContainEqual(["usage"]);
		expect(h.usage.reads).toBe(0);
	});

	test("malformed cached windows are skipped", async () => {
		const h = harness();
		h.cache.write("claude-usage", [{ label: "Broken", usedPct: "x" }, "junk", null, { usedPct: 10 }, FABLE]);
		const v = strip((await render(h, input())).rows[1]!);
		expect(v).not.toContain("Broken");
		expect(v).toContain("Fable");
		h.cache.write("claude-usage", { not: "a list" });
		expect(strip((await render(h, input())).rows[1]!)).not.toContain("Fable");
	});

	test("the refresh helper stores the fetched windows, keeps the old ones on failure, and skips a fresh entry", async () => {
		const h = harness();
		h.usage.windows = [FABLE];
		await runClaude(["--refresh", "usage"], "", h.deps);
		expect(h.cache.read("claude-usage")?.value).toEqual([FABLE]);

		const failing = harness();
		writeAged(failing, "claude-usage", [FABLE], 200_000);
		failing.usage.windows = null;
		await runClaude(["--refresh", "usage"], "", failing.deps);
		expect(failing.usage.reads).toBe(1);
		expect(failing.cache.read("claude-usage")?.value).toEqual([FABLE]);

		const fresh = harness();
		fresh.cache.write("claude-usage", []);
		await runClaude(["--refresh", "usage"], "", fresh.deps);
		expect(fresh.usage.reads).toBe(0);

		const empty = harness();
		empty.usage.windows = [];
		await runClaude(["--refresh", "usage"], "", empty.deps);
		expect(empty.cache.read("claude-usage")?.value).toEqual([]);
	});
});
