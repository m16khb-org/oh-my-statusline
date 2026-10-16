// OpenCode data → snapshot. Ported from opencode-statusline test/render.test.ts: context usage,
// directory label, counts chip, session stats, options, demo. The render rules themselves are
// covered in test/domain/render.test.ts.
import { describe, expect, test } from "bun:test";
import { type GitView, NO_GIT } from "../../../src/harnesses/opencode/git-watcher.ts";
import { readOptions } from "../../../src/harnesses/opencode/options.ts";
import { contextUsage, demoInput, type StatusInput, toStatusSnapshot } from "../../../src/harnesses/opencode/snapshot.ts";
import { statusRows } from "../../../src/harnesses/opencode/view.ts";

const ARROW = "\ue0b0";
const NOW = 1_700_000_000_000;

const repo = (top: string, branch = "main", extra: Partial<GitView> = {}): GitView => ({
	root: { top, main: top },
	state: { branch, ahead: 0, behind: 0, conflicts: 0, staged: 0, modified: 0, untracked: 0, detachedOid: null },
	linesAdded: 0,
	linesRemoved: 0,
	...extra,
});

const lines = (input: StatusInput, options = readOptions(), width = 200) => statusRows(toStatusSnapshot(input, options, NOW), options, width, NOW).map((row) => row.map((run) => run.text).join(""));

const input = (extra: Partial<StatusInput> = {}): StatusInput => ({ directory: "/home/you/src/my-app", git: NO_GIT, costUsd: 0, ...extra });

describe("context usage", () => {
	const model = { id: "gpt-5.5", providerID: "openai", limit: { context: 1_000_000 } };
	const assistant = { type: "assistant", model: { id: "gpt-5.5", providerID: "openai" }, tokens: { input: 200_000, output: 1000, reasoning: 0, cache: { read: 82_000, write: 0 } } };

	test("sums the tokens of the last assistant message", () => {
		expect(contextUsage([{ type: "user" }, assistant], [model])).toEqual({ tokens: 283_000, limit: 1_000_000 });
	});

	test("keeps the newest message that carries tokens", () => {
		const later = { type: "assistant", model: { id: "gpt-5.5", providerID: "openai" }, tokens: { input: 10, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } };
		expect(contextUsage([assistant, later], [model])?.tokens).toBe(10);
		const empty = { ...later, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } };
		expect(contextUsage([assistant, empty], [model])?.tokens).toBe(283_000);
	});

	test("has no window without a known model, and nothing without messages", () => {
		expect(contextUsage([assistant], [])).toEqual({ tokens: 283_000, limit: undefined });
		expect(contextUsage([assistant], [{ id: "gpt-5.5", providerID: "other", limit: { context: 9 } }])?.limit).toBeUndefined();
		expect(contextUsage([], [model])).toBeUndefined();
	});

	test("matches the model by id or modelID within its provider", () => {
		expect(contextUsage([assistant], [{ id: "alias", modelID: "gpt-5.5", providerID: "openai", limit: { context: 400_000 } }])?.limit).toBe(400_000);
	});
});

describe("directory label", () => {
	const dirOf = (extra: Partial<StatusInput>) => toStatusSnapshot(input(extra), readOptions(), NOW).dir;

	test("shows the repository name, and the path below the root", () => {
		expect(dirOf({ git: repo("/home/you/src/my-app") })).toEqual({ name: "my-app", relative: "", worktree: null });
		expect(dirOf({ directory: "/home/you/src/my-app/src/api", git: repo("/home/you/src/my-app") })).toEqual({ name: "my-app", relative: "src/api", worktree: null });
		expect(lines(input({ directory: "/home/you/src/my-app/src/api", git: repo("/home/you/src/my-app") }))[0]).toContain(" my-app/src/api ");
	});

	test("keeps the last two levels of a deeper path", () => {
		expect(lines(input({ directory: "/home/you/src/my-app/src/lib/statusline", git: repo("/home/you/src/my-app") }))[0]).toContain(" my-app/…/lib/statusline ");
	});

	test("appends a worktree name that differs from the branch", () => {
		const git = repo("/home/you/src/my-app", "feature/statusline");
		expect(dirOf({ git, subpath: "statusline", branch: "feature/statusline" }).worktree).toBe("statusline");
		expect(lines(input({ git, subpath: "statusline", branch: "feature/statusline" }))[0]).toContain(" my-app·statusline ");
		expect(dirOf({ git, subpath: "main", branch: "main" }).worktree).toBeNull();
		expect(dirOf({ git, subpath: "my-app", branch: "main" }).worktree).toBeNull();
		expect(dirOf({ git, subpath: "." }).worktree).toBeNull();
		expect(dirOf({ git, subpath: "/" }).worktree).toBeNull();
		expect(dirOf({ git, subpath: "wt/nested/" }).worktree).toBe("nested");
	});

	test("falls back to the directory name outside a repository", () => {
		expect(dirOf({ directory: "/tmp/scratch" })).toEqual({ name: "scratch", relative: "", worktree: null });
		expect(lines(input({ directory: "/tmp/scratch" }))[0]).toContain(" scratch ");
	});
});

describe("snapshot", () => {
	test("carries only what OpenCode has: no plan limits, PR or cache data", () => {
		const snapshot = toStatusSnapshot(demoInput(NOW), readOptions(), NOW);
		expect(snapshot.harness).toBe("opencode");
		expect(snapshot.limits).toEqual([]);
		expect(snapshot.pr).toBeNull();
		expect(snapshot.cache).toBeNull();
		expect(snapshot.model).toEqual({ name: "Opus 5.5", family: "claude-opus", isFast: false });
		expect(snapshot.effort).toBe("max");
		expect(snapshot.counts).toEqual({ subagents: 2, shells: 0 });
		expect(snapshot.stats).toEqual({ costUsd: 4.21, durationMs: 23 * 60_000, linesAdded: 156, linesRemoved: 23 });
		expect(snapshot.context).toMatchObject({ usedPct: 28.3, tokens: 283_000, windowSize: 1_000_000 });
	});

	test("the context window decides whether there is a gauge row", () => {
		expect(toStatusSnapshot(input({ context: { tokens: 5000 } }), readOptions(), NOW).context).toBeNull();
		expect(toStatusSnapshot(input({ context: { tokens: 0, limit: 1000 } }), readOptions(), NOW).context).toMatchObject({ usedPct: 0 });
		expect(toStatusSnapshot(input({ context: { tokens: 5000, limit: 1000 } }), readOptions(), NOW).context?.usedPct).toBe(100);
		expect(lines(input({ context: { tokens: 5000 } }))).toHaveLength(1);
	});

	test("a session without cost or age shows neither", () => {
		const one = lines(input({ model: { name: "Opus 5.5", family: "claude-opus", effort: "max" }, directory: "/home/you/my-app/src/lib/statusline", git: repo("/home/you/my-app"), costUsd: 0 }), readOptions({ git: false }))[0];
		expect(one).toBe(` Opus 5.5 ${ARROW} max ${ARROW} my-app/…/lib/statusline ${ARROW}`);
	});

	test("a session younger than a minute shows no age, an older one does", () => {
		const young = toStatusSnapshot(input({ createdMs: NOW - 59_000 }), readOptions(), NOW);
		expect(young.stats.durationMs).toBe(59_000);
		expect(lines(input({ createdMs: NOW - 59_000 }))[0]).not.toContain("59s");
		expect(lines(input({ createdMs: NOW - 5 * 60_000 }))[0]).toContain("5m");
		expect(toStatusSnapshot(input({ createdMs: NOW + 5000 }), readOptions(), NOW).stats.durationMs).toBe(0);
	});

	test("the model chip is bold dark ink on the family colour", () => {
		const row = statusRows(toStatusSnapshot(demoInput(NOW), readOptions(), NOW), readOptions(), 200, NOW)[0];
		expect(row?.[0]).toEqual({ text: " Opus 5.5 ", fg: "#1a1b26", bg: "#bb9af7", bold: true });
	});

	test("counts: subagents and shells show while they run", () => {
		expect(lines(input({ counts: { subagents: 2, shells: 1 } }))[0]).toContain("◈ 2 ⌘ 1");
		expect(lines(input({ counts: { subagents: 0, shells: 1 } }))[0]).toContain("⌘ 1");
		expect(lines(input({ counts: { subagents: 0, shells: 0 } }))[0]).not.toMatch(/[◈⌘]/);
		expect(lines(input())[0]).not.toMatch(/[◈⌘]/);
	});
});

describe("options", () => {
	test("chips can be turned off one by one", () => {
		const off = readOptions({ model: false, effort: false, dir: false, git: false, counts: false, lines: false, elapsed: false });
		expect(lines(demoInput(NOW), off)).toEqual(["  $4.21", "ctx ▆▆▆▆▆▆▆▆▆▆ 28% 283k/1M"]);
	});

	test("each switch removes exactly its own segment", () => {
		const row = (overrides: Record<string, boolean>) => lines(demoInput(NOW), readOptions({ glyphs: "plain", ...overrides }))[0] ?? "";
		const full = row({});
		expect(full).toContain("Opus 5.5");
		expect(full).toContain("max");
		expect(full).toContain("my-app");
		expect(full).toContain("feature/statusline");
		expect(full).toContain("◈ 2");
		expect(full).toContain("$4.21");
		expect(full).toContain("23m");
		expect(full).toContain("+156");

		expect(row({ model: false })).not.toContain("Opus 5.5");
		expect(row({ model: false })).toContain("max");
		expect(row({ effort: false })).not.toContain("max");
		expect(row({ dir: false })).not.toContain("my-app");
		expect(row({ git: false })).not.toContain("feature/statusline");
		expect(row({ git: false })).toContain("+156");
		expect(row({ lines: false })).not.toContain("+156");
		expect(row({ counts: false })).not.toContain("◈");
		expect(row({ cost: false })).not.toContain("$4.21");
		expect(row({ elapsed: false })).not.toContain("23m");
		expect(lines(demoInput(NOW), readOptions({ context: false }))).toHaveLength(1);
	});

	test("an effort without a model draws no effort chip", () => {
		expect(lines(input({ model: undefined }))[0]).not.toContain("max");
	});

	test("glyphs and theme come from the options", () => {
		const plain = statusRows(toStatusSnapshot(demoInput(NOW), readOptions({ glyphs: "plain" }), NOW), readOptions({ glyphs: "plain" }), 200, NOW);
		expect(plain.flat().some((run) => /[\ue000-\uf8ff]/.test(run.text))).toBe(false);
		const dark = statusRows(toStatusSnapshot(demoInput(NOW), readOptions(), NOW), readOptions({}, "dark"), 200, NOW);
		const light = statusRows(toStatusSnapshot(demoInput(NOW), readOptions({}, "light"), NOW), readOptions({}, "light"), 200, NOW);
		const cost = (rows: typeof dark) => rows[0]?.find((run) => run.text === "$4.21")?.fg;
		expect(cost(dark)).toBe("#737aa2");
		expect(cost(light)).toBe("#68709a");
	});
});

describe("demo", () => {
	test("the fixture is the line the README shows", () => {
		const snapshot = toStatusSnapshot(demoInput(NOW), readOptions(), NOW);
		expect(snapshot.model.name).toBe("Opus 5.5");
		expect(snapshot.stats.costUsd).toBe(4.21);
		expect(lines(demoInput(NOW))[1]).toBe("ctx ▆▆▆▆▆▆▆▆▆▆ 28% 283k/1M");
		expect(lines(demoInput(NOW))[0]).toContain(" my-app/…/lib/statusline ");
	});
});
