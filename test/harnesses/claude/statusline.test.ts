// The statusLine command end to end, in-process with fake ports. Ported from
// claude-code-statusline/test/test_statusline.py: the render rules themselves are covered by
// test/domain/render.test.ts; here each case drives them through the session JSON.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
	ARROW,
	BRANCH,
	COLORS,
	colorBefore,
	DELETE,
	FABLE,
	GIT_BRANCH,
	GIT_CLEAN,
	GIT_CONFLICT,
	GIT_DETACHED,
	GIT_DIRTY,
	cleanTemps,
	harness,
	makeRepo,
	NOW_S,
	PR_URL,
	render,
	session,
	strip,
	THIN,
	tmp,
} from "./support.ts";

let REPO: string;
beforeAll(() => {
	REPO = makeRepo();
});
afterAll(cleanTemps);

const full = (over: Record<string, unknown> = {}) => session(REPO, over);
const row1 = async (over: Record<string, unknown> = {}, opts: Parameters<typeof harness>[0] = {}) =>
	(await render(harness(opts), full(over))).rows[0]!;
const row2 = async (over: Record<string, unknown> = {}, opts: Parameters<typeof harness>[0] = {}) =>
	(await render(harness(opts), full(over))).rows[1]!;

describe("stdin contract", () => {
	test("a full session prints two rows and never the text null", async () => {
		const { out, rows } = await render(harness(), full());
		expect(rows).toHaveLength(2);
		expect(strip(out)).not.toContain("null");
	});

	test("minimal input prints a single row", async () => {
		const { out, rows } = await render(harness({ git: null }), { model: { display_name: "Opus" }, workspace: { current_dir: "/tmp" } });
		expect(rows).toHaveLength(1);
		expect(strip(out)).toContain("Opus");
		expect(strip(out)).not.toContain("null");
	});

	test("empty, broken or non-object stdin prints one hint line", async () => {
		for (const stdin of ["", "   \n", "{ not json", "[]", "null", "42", '"text"']) {
			const { out } = await render(harness(), stdin);
			expect(out).toContain("oh-my-statusline:");
			expect(out).not.toContain("\n");
		}
	});

	test("an empty object renders from the process working directory", async () => {
		const h = harness({ cwd: REPO });
		const { rows } = await render(h, {});
		expect(rows).toHaveLength(1);
		expect(strip(rows[0]!)).toContain("my-app");
		expect(h.git.calls).toEqual([REPO]);
	});

	test("the working directory is workspace.current_dir, else cwd, else the process directory", async () => {
		const a = harness();
		await render(a, { workspace: { current_dir: "/w" }, cwd: "/c" });
		const b = harness();
		await render(b, { cwd: "/c" });
		const c = harness();
		await render(c, { model: { display_name: "Opus" } });
		expect([a.git.calls, b.git.calls, c.git.calls]).toEqual([["/w"], ["/c"], ["/tmp"]]);
	});

	test("numeric strings count as numbers", async () => {
		const rows = (
			await render(
				harness(),
				full({
					"context_window.used_percentage": "28.3",
					"context_window.total_input_tokens": "283000",
					"context_window.context_window_size": "1000000",
					"cost.total_cost_usd": "4.2137",
					"rate_limits.five_hour": { used_percentage: "41", resets_at: String(NOW_S + 4350) },
				}),
			)
		).rows.map(strip);
		expect(rows[0]).toContain("$4.21");
		expect(rows[1]).toContain("28%");
		expect(rows[1]).toContain("283k/1M");
		expect(rows[1]).toContain("5h");
		expect(rows[1]).toContain("↻1h12m");
	});
});

describe("row 1: chips", () => {
	test("the model chip drops the context suffix and is purple for Opus", async () => {
		const r = await row1();
		expect(strip(r)).toContain("Opus 5.5");
		expect(strip(r)).not.toContain("(1M context)");
		expect(colorBefore(r, "Opus 5.5")).toContain(`48;2;${COLORS.purple}`);
	});

	test("the effort chip shows max in red, and is absent without an effort field", async () => {
		const r = await row1();
		expect(strip(r)).toContain("max");
		expect(colorBefore(r, "max")).toContain(`48;2;${COLORS.red}`);
		expect(strip(await row1({ effort: DELETE }))).not.toContain("max");
	});

	test("fast mode is marked next to the effort", async () => {
		expect(strip(await row1({ fast_mode: true }))).toContain("max·fast");
	});

	test("chips are joined by powerline arrows, with a tail arrow after the last", async () => {
		expect((await row1()).split(ARROW)).toHaveLength(6); // model → effort → dir → git → PR, plus the tail
	});

	test("same-colored neighbors use the thin separator", async () => {
		const pr = { number: 5, url: "https://github.com/octocat/my-app/pull/5", review_state: "changes_requested" };
		expect(await row1({ pr }, { git: GIT_CONFLICT })).toContain(THIN);
	});

	test("the GitHub PR chip links to the PR; a GitLab MR uses the bang prefix", async () => {
		const r = await row1();
		expect(strip(r)).toContain("#512");
		expect(strip(r)).toContain("✓");
		expect(r).toContain(`\x1b]8;;${PR_URL}\x07`);
		const mr = { number: 77, url: "https://gitlab.com/g/p/-/merge_requests/77", review_state: "pending", kind: "mr" };
		expect(strip(await row1({ pr: mr }))).toContain("!77");
		expect(strip(await row1({ pr: mr }))).not.toContain("#77");
	});

	test("no PR chip without a pr field", async () => {
		expect(strip(await row1({ pr: DELETE }))).not.toContain("#512");
	});
});

describe("row 1: directory", () => {
	test("the repo name from workspace.repo, in blue", async () => {
		const r = await row1();
		expect(strip(r)).toContain("my-app");
		expect(colorBefore(r, "my-app")).toContain(`48;2;${COLORS.blue}`);
	});

	test("a subdirectory shows its path below the project, and a deep one is elided", async () => {
		const sub = `${REPO}/cmd/io`;
		expect(strip(await row1({ cwd: sub, "workspace.current_dir": sub }))).toContain("my-app/cmd/io");
		const deep = `${REPO}/a/b/c/d`;
		expect(strip(await row1({ cwd: deep, "workspace.current_dir": deep }))).toContain("my-app/…/c/d");
	});

	test("workspace.git_worktree shows when it differs from the branch, and not twice when equal", async () => {
		expect(strip(await row1({ "workspace.git_worktree": "wt-feature" }, { git: GIT_BRANCH }))).toContain("wt-feature");
		const same = strip(await row1({ "workspace.git_worktree": "octocat/issue-9" }, { git: GIT_BRANCH }));
		expect(same.split("octocat/issue-9")).toHaveLength(2);
	});

	/** tmp/proj (main checkout) and tmp/proj.worktrees/wt-dir (linked worktree). */
	function repoLayout() {
		const base = path.dirname(tmp("layout"));
		const main = path.join(base, "proj");
		mkdirSync(path.join(main, ".git", "worktrees", "wt-dir"), { recursive: true });
		mkdirSync(path.join(main, "src", "app"), { recursive: true });
		const wt = path.join(base, "proj.worktrees", "wt-dir");
		mkdirSync(path.join(wt, "sub"), { recursive: true });
		writeFileSync(path.join(wt, ".git"), `gitdir: ${main}/.git/worktrees/wt-dir\n`);
		return { main, wt };
	}
	const at = (cwd: string, project = cwd): Record<string, unknown> => ({
		cwd,
		"workspace.current_dir": cwd,
		"workspace.project_dir": project,
		"workspace.repo": DELETE,
		"workspace.git_worktree": null,
		pr: DELETE,
	});

	test("a linked worktree shows the main repository's name and its own folder once", async () => {
		const { wt } = repoLayout();
		const v = strip(await row1(at(wt), { git: "# branch.head wt-dir\n" }));
		expect(v).toContain("proj");
		expect(v).not.toContain("proj.worktrees");
		expect(v.split("wt-dir")).toHaveLength(2); // the branch chip only: the worktree name repeats the branch
	});

	test("a linked worktree's folder shows next to the name when it differs from the branch", async () => {
		const { wt } = repoLayout();
		expect(strip(await row1(at(wt), { git: "# branch.head octocat/feature\n" }))).toContain("proj·wt-dir");
	});

	test("a subdirectory path is relative to the repository root, not the project directory", async () => {
		const { main } = repoLayout();
		expect(strip(await row1(at(path.join(main, "src", "app"), path.join(main, "src"))))).toContain("proj/src/app");
	});

	test("without a repository the project directory stands in for the checkout root", async () => {
		const dir = tmp("plain");
		mkdirSync(path.join(dir, "x", "y"), { recursive: true });
		const r = strip(await row1(at(path.join(dir, "x", "y"), dir), { git: null }));
		expect(r).toContain("plain/x/y");
		expect(r).not.toContain(BRANCH);
	});
});

describe("row 1: git chip", () => {
	const LONG_BRANCH = "octocat/1234-add-rate-limit-aware-retry-logic";

	test("a long branch keeps 40 characters when wide and 20 when narrow", async () => {
		expect(strip(await row1({}, { git: `# branch.head ${LONG_BRANCH}\n` }))).toContain(`${LONG_BRANCH.slice(0, 39)}…`);
		const narrow = await row1({}, { git: `# branch.head ${LONG_BRANCH}\n`, env: { COLUMNS: "50" } });
		expect(strip(narrow)).toContain(`${LONG_BRANCH.slice(0, 19)}…`);
	});

	test("a clean repository is green", async () => {
		const r = await row1({}, { git: GIT_CLEAN });
		expect(strip(r)).toContain(`${BRANCH} main`);
		expect(colorBefore(r, " main")).toContain(`48;2;${COLORS.green}`);
	});

	test("a dirty one is yellow with counts", async () => {
		const r = await row1({}, { git: GIT_DIRTY });
		expect(strip(r)).toContain("main ⇡1 +1 ~2 ?1");
		expect(colorBefore(r, " main")).toContain(`48;2;${COLORS.yellow}`);
	});

	test("a conflicted one is red", async () => {
		const r = await row1({}, { git: GIT_CONFLICT });
		expect(strip(r)).toContain("main ✘1");
		expect(colorBefore(r, " main")).toContain(`48;2;${COLORS.red}`);
	});

	test("a detached HEAD shows the short commit id", async () => {
		expect(strip(await row1({}, { git: GIT_DETACHED }))).toContain("ca8cb99");
	});

	test("no git chip outside a repository", async () => {
		expect(strip(await row1({}, { git: null }))).not.toContain(BRANCH);
	});
});

describe("row 1: session stats", () => {
	test("cost, duration, working-tree lines and cache time follow the chips", async () => {
		const v = strip(await row1({}, { git: GIT_DIRTY, lines: [12, 4] }));
		for (const token of ["$4.21", "23m", "+12 −4", "cache 42m"]) expect(v).toContain(token);
	});

	test("line counts ignore the session's own edit counters", async () => {
		const v = strip(await row1({}, { git: GIT_CLEAN }));
		for (const token of ["+156", "−23"]) expect(v).not.toContain(token);
	});

	test("zero stats and a cold prompt cache are hidden", async () => {
		const over = { "cost.total_cost_usd": 0, "cost.total_duration_ms": 0, "cost.total_lines_added": 0, "cost.total_lines_removed": 0, prompt_cache: DELETE };
		const v = strip(await row1(over));
		for (const token of ["$", "+0", "−0", "0m", "cache"]) expect(v).not.toContain(token);
		expect(strip(await row1({ "prompt_cache.warm": false }))).not.toContain("cache");
	});

	test("an expired prompt cache shows no countdown", async () => {
		expect(strip(await row1({ "prompt_cache.expires_at": NOW_S - 5 }))).not.toContain("cache");
	});
});

describe("row 2: gauges", () => {
	test("the ctx gauge shows used, not remaining, percent and the token counts", async () => {
		const v = strip(await row2());
		expect(v).toContain("ctx");
		expect(v).toContain("28%");
		expect(v).toContain("283k/1M");
		expect(v).not.toContain("72%");
	});

	test("the ctx bar has ten cells with a faint track when wide", async () => {
		const ctxRaw = (await row2()).split("│")[0]!;
		expect(strip(ctxRaw).split("▆")).toHaveLength(11);
		expect(ctxRaw.split(`38;2;${COLORS.faint}m▆`)).toHaveLength(8);
	});

	test("the ctx percent color follows the 50/65/80 thresholds", async () => {
		for (const [pct, color] of [[28.3, COLORS.green], [55, COLORS.yellow], [70, COLORS.orange], [85, COLORS.red]] as const) {
			const r = await row2({ "context_window.used_percentage": pct, exceeds_200k_tokens: false });
			expect(colorBefore(r, `${Math.round(pct)}%`)).toContain(`38;2;${color}`);
		}
	});

	test("the token count turns yellow past 200k", async () => {
		expect(colorBefore(await row2(), "283k")).toContain(`38;2;${COLORS.yellow}`);
		const r = await row2({ exceeds_200k_tokens: false, "context_window.total_input_tokens": 150_000 });
		expect(colorBefore(r, "150k")).not.toContain(`38;2;${COLORS.yellow}`);
	});

	test("rate limits show used percent and the reset countdown", async () => {
		const v = strip(await row2());
		for (const token of ["5h", "41%", "↻1h12m", "7d", "18%", "↻3d5h"]) expect(v).toContain(token);
	});

	test("a window missing from the payload is omitted, not drawn empty", async () => {
		const v = strip(await row2({ rate_limits: DELETE }));
		expect(v).toContain("ctx");
		expect(v).not.toContain("5h");
		expect(v).not.toContain("7d");
		expect(strip(await row2({ "rate_limits.seven_day": DELETE }))).not.toContain("7d");
	});

	test("a pace that exhausts the limit before the reset shows the time-to-limit warning", async () => {
		const v = strip(await row2({ "rate_limits.five_hour": { used_percentage: 80, resets_at: NOW_S + 7200 } }));
		expect(v).toContain("⚠~45m");
	});

	test("no warning when on pace", async () => {
		expect(strip(await row2())).not.toContain("⚠");
	});

	test("an expired reset hides the countdown", async () => {
		const v = strip(await row2({ "rate_limits.five_hour": { used_percentage: 41, resets_at: NOW_S - 60 } }));
		expect(v).toContain("5h");
		expect(v).not.toContain("↻-");
		expect(v.split("7d")[0]).not.toContain("↻");
	});

	test("a missing context percentage omits the ctx gauge", async () => {
		const { out } = await render(harness(), full({ "context_window.used_percentage": null }));
		expect(strip(out)).not.toContain("ctx");
		expect(strip(out)).not.toContain("null");
	});

	test("model-scoped weekly windows from the usage cache follow the 7d gauge", async () => {
		const h = harness();
		h.cache.write("claude-usage", [FABLE]);
		const v = strip((await render(h, full())).rows[1]!);
		expect(v.indexOf("Fable")).toBeGreaterThan(v.indexOf("7d"));
		const after = v.split("Fable")[1]!;
		expect(after).toContain("25%");
		expect(after).toContain("↻3d5h");
	});

	test("no scoped gauge without cached usage", async () => {
		expect(strip(await row2())).not.toContain("Fable");
	});
});

describe("glyphs, colors and theme", () => {
	test("plain glyphs avoid private-use characters and keep chip colors with space gaps", async () => {
		const { out, rows } = await render(harness({ git: GIT_DIRTY, env: { STATUSLINE_GLYPHS: "plain" } }), full());
		expect(/[\ue000-\uf8ff]/.test(out)).toBe(false);
		expect(strip(rows[0]!)).toContain("main ↑1 +1 ~2 ?1");
		expect(colorBefore(rows[0]!, "Opus 5.5")).toContain(`48;2;${COLORS.purple}`);
	});

	test("without COLORTERM the output falls back to 256 colors; STATUSLINE_COLORS forces truecolor", async () => {
		const { out } = await render(harness({ env: { COLORTERM: undefined } }), full());
		expect(out).toContain("38;5;");
		expect(out).toContain("48;5;");
		expect(out).not.toMatch(/[34]8;2;/);
		const forced = (await render(harness({ env: { COLORTERM: undefined, STATUSLINE_COLORS: "truecolor" } }), full())).out;
		expect(forced).toContain("38;2;");
		expect(forced).toContain("48;2;");
	});

	test("the light theme uses the light palette", async () => {
		const r = await row2({}, { env: { STATUSLINE_THEME: "light" } });
		expect(r).toContain(`38;2;${COLORS.lightDim}`);
		expect(r).toContain(`38;2;${COLORS.lightGreen}`);
		expect(r).not.toContain(`38;2;${COLORS.dim}`);
	});

	test("an unset theme asks the desktop appearance; an explicit one does not", async () => {
		const auto = harness({ env: { STATUSLINE_THEME: undefined } });
		auto.appearance.value = "light";
		const rows = (await render(auto, full())).rows;
		expect(rows).toHaveLength(2);
		expect(rows[1]).toContain(`38;2;${COLORS.lightDim}`);
		expect(auto.appearance.reads).toBe(1);
		const explicit = harness();
		await render(explicit, full());
		expect(explicit.appearance.reads).toBe(0);
	});

	test("the config file's theme applies, and the environment overrides it", async () => {
		const file = { raw: { theme: "light", glyphs: "plain" } };
		const fromFile = harness({ env: { STATUSLINE_THEME: undefined } });
		fromFile.deps.configFile = file;
		const a = await render(fromFile, full());
		expect(a.rows[1]).toContain(`38;2;${COLORS.lightDim}`);
		expect(/[\ue000-\uf8ff]/.test(a.out)).toBe(false);
		const overridden = harness();
		overridden.deps.configFile = file;
		expect((await render(overridden, full())).rows[1]).toContain(`38;2;${COLORS.dim}`);
	});
});

describe("width", () => {
	test("rows fit COLUMNS minus four at every width", async () => {
		for (const columns of [100, 80, 60, 45]) {
			const { rows } = await render(harness({ git: GIT_DIRTY, env: { COLUMNS: String(columns) } }), full());
			rows.forEach((row) => expect(Bun.stringWidth(strip(row))).toBeLessThanOrEqual(columns - 4));
		}
	});

	test("COLUMNS defaults to 120 when unset, empty or not a number", async () => {
		const reference = (await render(harness({ env: { COLUMNS: "120" } }), full())).out;
		for (const value of [undefined, "", "wide", "12x"]) {
			expect((await render(harness({ env: { COLUMNS: value } }), full())).out).toBe(reference);
		}
	});

	test("below the minimum width nothing is drawn", async () => {
		expect((await render(harness({ env: { COLUMNS: "20" } }), full())).out).toBe("");
	});
});
