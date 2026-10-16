import { describe, expect, test } from "bun:test";
import { toDirInfo } from "../../src/domain/model/dir.ts";
import { type HarnessId, toSnapshot } from "../../src/domain/model/snapshot.ts";
import { rgb, rgbFromHex, rgbToHex, toPercentage, toTokenAmount } from "../../src/domain/model/values.ts";

async function fixture(harness: HarnessId): Promise<unknown> {
	return Bun.file(new URL(`../fixtures/snapshots/${harness}.json`, import.meta.url)).json();
}

describe("Percentage", () => {
	test("clamps below 0 and above 100", () => {
		expect(toPercentage(-5)).toBe(0);
		expect(toPercentage(150)).toBe(100);
	});

	test("keeps one decimal place and accepts numeric strings", () => {
		expect(toPercentage(41.26)).toBe(41.3);
		expect(toPercentage("72")).toBe(72);
	});

	test("anything that is not a finite number is null, so 0% stays distinguishable from unknown", () => {
		expect(toPercentage(0)).toBe(0);
		for (const raw of [null, undefined, "", "abc", Number.NaN, Number.POSITIVE_INFINITY, {}, true]) {
			expect(toPercentage(raw)).toBeNull();
		}
	});
});

describe("TokenAmount", () => {
	test("is a non-negative whole number; garbage is 0", () => {
		expect(toTokenAmount(283_000)).toBe(283_000);
		expect(toTokenAmount(1.9)).toBe(1);
		expect(toTokenAmount("4096")).toBe(4096);
		expect(toTokenAmount(-10)).toBe(0);
		expect(toTokenAmount("x")).toBe(0);
		expect(toTokenAmount(undefined)).toBe(0);
	});
});

describe("Rgb", () => {
	test("channels clamp to 0..255 whole values", () => {
		expect(rgb(-1, 300, 12.7)).toEqual([0, 255, 12]);
	});

	test("hex round-trips, with or without the leading #", () => {
		expect(rgbFromHex("#bb9af7")).toEqual([187, 154, 247]);
		expect(rgbFromHex("7aa2f7")).toEqual([122, 162, 247]);
		expect(rgbToHex([26, 27, 38])).toBe("#1a1b26");
	});

	test("malformed hex is rejected rather than read as black", () => {
		expect(rgbFromHex("#12")).toBeNull();
		expect(rgbFromHex("#zzzzzz")).toBeNull();
	});
});

describe("StatusSnapshot fixtures", () => {
	test("claude: every field filled", async () => {
		const s = toSnapshot("claude", await fixture("claude"));
		expect(s.harness).toBe("claude");
		expect(s.model).toEqual({ name: "Opus 5.5", family: "claude-opus-5-5[1m]", isFast: false });
		expect(s.effort).toBe("max");
		expect(s.git?.branch).toBe("main");
		expect(s.pr).toEqual({ number: 512, url: "https://github.com/octocat/my-app/pull/512", state: "approved", kind: "pr" });
		expect(s.stats).toEqual({ costUsd: 4.21, durationMs: 1_380_000, linesAdded: 0, linesRemoved: 0 });
		expect(s.cache).toEqual({ hitPct: null, ttlRemainingMs: 2_520_000 });
		expect(s.context).toEqual({ usedPct: 28, tokens: 283_000, windowSize: 1_000_000, exceeds200k: true });
		expect(s.limits.map((l) => [l.label, l.usedPct, l.scopedModel])).toEqual([
			["5h", 41, null],
			["7d", 18, null],
			["Fable", 25, "Fable"],
		]);
		expect(s.counts).toBeNull();
	});

	test("codex: fields Codex does not fill stay null instead of fake values", async () => {
		const s = toSnapshot("codex", await fixture("codex"));
		expect(s.model.isFast).toBe(false);
		expect(s.pr).toBeNull();
		expect(s.stats.costUsd).toBeNull();
		expect(s.cache).toEqual({ hitPct: 96, ttlRemainingMs: null });
		expect(s.context?.exceeds200k).toBe(false);
		// A known window without a reading is kept, so the renderer can show a placeholder for it.
		expect(s.limits).toEqual([
			{ label: "5h", usedPct: 41, resetsAtMs: 1_790_004_320_000, windowMs: 18_000_000, scopedModel: null },
			{ label: "7d", usedPct: null, resetsAtMs: null, windowMs: 604_800_000, scopedModel: null },
		]);
		expect(s.stats.linesAdded).toBe(156);
	});

	test("omp: account tier windows, detached HEAD, merge request draft", async () => {
		const s = toSnapshot("omp", await fixture("omp"));
		expect(s.model.isFast).toBe(true);
		expect(s.git?.branch).toBe("");
		expect(s.git?.detachedOid).toBe("ca8cb99d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b");
		expect(s.dir).toEqual({ name: "my-app", relative: "packages/core/src/render", worktree: "fix-ladder" });
		expect(s.pr?.kind).toBe("mr");
		expect(s.pr?.state).toBe("draft");
		expect(s.limits[2]).toEqual({
			label: "Fable·5h",
			usedPct: 12,
			resetsAtMs: 1_790_007_200_000,
			windowMs: 18_000_000,
			scopedModel: "Fable",
		});
	});

	test("opencode: running counts, no limits, PR or cache data", async () => {
		const s = toSnapshot("opencode", await fixture("opencode"));
		expect(s.counts).toEqual({ subagents: 2, shells: 1 });
		expect(s.limits).toEqual([]);
		expect(s.pr).toBeNull();
		expect(s.cache).toBeNull();
		expect(s.context?.usedPct).toBe(28.3);
		expect(s.agents).toBeUndefined();
	});
});

describe("toSnapshot robustness", () => {
	test("missing optional parts become null or empty without throwing", () => {
		for (const raw of [undefined, null, 42, "text", [], {}]) {
			const s = toSnapshot("claude", raw);
			expect(s.git).toBeNull();
			expect(s.pr).toBeNull();
			expect(s.cache).toBeNull();
			expect(s.context).toBeNull();
			expect(s.counts).toBeNull();
			expect(s.limits).toEqual([]);
			expect(s.model).toEqual({ name: "", family: "", isFast: false });
			expect(s.dir).toEqual({ name: "", relative: "", worktree: null });
			expect(s.stats).toEqual({ costUsd: null, durationMs: 0, linesAdded: 0, linesRemoved: 0 });
		}
	});

	test("git without a branch or detached commit is no git state at all", () => {
		expect(toSnapshot("omp", { git: { branch: "", detachedOid: null } }).git).toBeNull();
		expect(toSnapshot("omp", { git: { branch: "main", staged: -3, ahead: "2" } }).git).toEqual({
			branch: "main",
			ahead: 2,
			behind: 0,
			conflicts: 0,
			staged: 0,
			modified: 0,
			untracked: 0,
			detachedOid: null,
		});
	});

	test("PR review states outside the known set read as pending; a PR needs a number", () => {
		expect(toSnapshot("claude", { pr: { number: 3, url: "u", state: "REVIEW_REQUIRED" } }).pr).toEqual({
			number: 3,
			url: "u",
			state: "pending",
			kind: "pr",
		});
		expect(toSnapshot("claude", { pr: { url: "u" } }).pr).toBeNull();
	});

	test("limits: malformed entries are dropped, percentages clamped, windows inferred from the label", () => {
		const s = toSnapshot("claude", {
			limits: [{ label: "5h", usedPct: 150 }, { usedPct: 10 }, "junk", { label: "Fable", usedPct: -5 }],
		});
		expect(s.limits).toEqual([
			{ label: "5h", usedPct: 100, resetsAtMs: null, windowMs: 18_000_000, scopedModel: null },
			{ label: "Fable", usedPct: 0, resetsAtMs: null, windowMs: 604_800_000, scopedModel: null },
		]);
		expect(toSnapshot("claude", { limits: "nope" }).limits).toEqual([]);
	});

	test("context: tokens past 200k mark the long-context rate unless the harness says otherwise", () => {
		expect(toSnapshot("omp", { context: { usedPct: 30, tokens: 250_000, windowSize: 1_000_000 } }).context?.exceeds200k).toBe(true);
		expect(
			toSnapshot("claude", { context: { usedPct: 30, tokens: 250_000, windowSize: 1_000_000, exceeds200k: false } }).context
				?.exceeds200k,
		).toBe(false);
		expect(toSnapshot("codex", { context: { usedPct: null, tokens: 0 } }).context).toEqual({
			usedPct: null,
			tokens: 0,
			windowSize: 0,
			exceeds200k: false,
		});
	});

	test("running agents keep only entries with an id and a model", () => {
		const s = toSnapshot("claude", {
			agents: [
				{ id: "a", model: "claude-haiku-4-5", tokens: 148_000, windowSize: 200_000, status: "running", startedAtMs: 1_000 },
				{ id: "b" },
				{ id: "c", model: "claude-sonnet-5-5", effort: "medium", status: "weird" },
			],
		});
		expect(s.agents).toEqual([
			{
				id: "a",
				model: "claude-haiku-4-5",
				effort: "",
				name: "",
				label: "",
				tokens: 148_000,
				windowSize: 200_000,
				status: "running",
				startedAtMs: 1_000,
			},
			{
				id: "c",
				model: "claude-sonnet-5-5",
				effort: "medium",
				name: "",
				label: "",
				tokens: 0,
				windowSize: 0,
				status: "running",
				startedAtMs: null,
			},
		]);
	});
});

describe("toDirInfo (claude/omp/opencode directory label)", () => {
	const top = "/home/you/src/my-app";
	test("the checkout root is the repository name; below it, the relative path", () => {
		expect(toDirInfo({ cwd: top, top, main: top })).toEqual({ name: "my-app", relative: "", worktree: null });
		expect(toDirInfo({ cwd: `${top}/a/b/c/`, top, main: top })).toEqual({ name: "my-app", relative: "a/b/c", worktree: null });
	});

	test("a harness-known repository name wins over the folder name (self-hosted remotes leave it empty)", () => {
		expect(toDirInfo({ cwd: "/w/checkout", top: "/w/checkout", main: "/w/checkout", repoName: "my-app" }).name).toBe("my-app");
		expect(toDirInfo({ cwd: "/w/checkout", top: "/w/checkout", main: "/w/checkout", repoName: "" }).name).toBe("checkout");
	});

	test("a linked worktree shows the main checkout's name and the worktree folder", () => {
		expect(toDirInfo({ cwd: "/home/you/wt/fix-login/src", top: "/home/you/wt/fix-login", main: top })).toEqual({
			name: "my-app",
			relative: "src",
			worktree: "fix-login",
		});
	});

	test("outside a repository the directory is the folder; the filesystem root is /", () => {
		expect(toDirInfo({ cwd: "/tmp/scratch" })).toEqual({ name: "scratch", relative: "", worktree: null });
		expect(toDirInfo({ cwd: "/" })).toEqual({ name: "/", relative: "", worktree: null });
		expect(toDirInfo({ cwd: "/elsewhere/x", top, main: top }).name).toBe("x");
	});
});
