// The TUI-facing readers and the row fitting, driven by a fake data store and a fake context:
// session vs home rows, the input gate, the running counts, width and minimumWidth.
import { describe, expect, test } from "bun:test";
import { NO_GIT } from "../../../src/harnesses/opencode/git-watcher.ts";
import { readOptions } from "../../../src/harnesses/opencode/options.ts";
import { toStatusSnapshot } from "../../../src/harnesses/opencode/snapshot.ts";
import { footerVisible, homeDirectory, homeInput, sessionDirectory, sessionInput, statusRows, terminalWidth, type TuiContext } from "../../../src/harnesses/opencode/view.ts";

const NOW = 1_700_000_000_000;
const LOCATION = { directory: "/home/you/src/my-app" };

interface FakeSession {
	location?: { directory: string };
	model?: { id: string; providerID: string; variant?: string };
	subpath?: string;
	time?: { created: number };
	cost?: number;
	messages?: unknown[];
	status?: "idle" | "running";
}

interface Fake {
	sessions?: Record<string, FakeSession>;
	families?: Record<string, string[]>;
	shells?: Array<{ status: string; metadata?: { sessionID?: string } }>;
	models?: Array<Record<string, unknown>>;
	branch?: string;
	current?: { providerID: string; modelID: string; variant?: string };
	location?: { directory: string };
	defaultLocation?: { directory: string };
}

/** A data store with just what the readers touch; every read is recorded. */
function fakeContext(fake: Fake) {
	const sessions = fake.sessions ?? {};
	const reads: string[] = [];
	const context = {
		location: fake.location,
		ui: { model: { current: () => fake.current } },
		data: {
			session: {
				get: (id: string) => sessions[id],
				family: (id: string) => fake.families?.[id] ?? [id],
				status: (id: string) => sessions[id]?.status ?? "idle",
				cost: (id: string) => sessions[id]?.cost ?? 0,
				message: {
					list: (id: string) => {
						reads.push(`messages:${id}`);
						return sessions[id]?.messages ?? [];
					},
				},
			},
			shell: { list: () => fake.shells ?? [] },
			location: {
				default: () => fake.defaultLocation ?? LOCATION,
				model: { list: () => fake.models },
				vcs: { info: () => (fake.branch ? { branch: { current: fake.branch } } : undefined) },
			},
		},
	};
	return { context: context as unknown as TuiContext, reads };
}

const OPUS = { id: "claude-opus-5-5", providerID: "anthropic", name: "Opus 5.5 (latest)", family: "claude-opus", limit: { context: 1_000_000 } };
const assistant = { type: "assistant", model: { id: OPUS.id, providerID: "anthropic" }, tokens: { input: 200_000, output: 1000, reasoning: 0, cache: { read: 82_000, write: 0 } } };

const GIT = {
	root: { top: "/home/you/src/my-app", main: "/home/you/src/my-app" },
	state: { branch: "main", ahead: 0, behind: 0, conflicts: 0, staged: 0, modified: 2, untracked: 0, detachedOid: null },
	linesAdded: 10,
	linesRemoved: 3,
};

const rows = (input: ReturnType<typeof sessionInput>, width = 200, options = readOptions()) =>
	statusRows(toStatusSnapshot(input, options, NOW), options, width, NOW).map((row) => row.map((run) => run.text).join(""));

describe("the input gate", () => {
	test("the line shows in normal mode of an open session only", () => {
		expect(footerVisible({ mode: "normal", sessionID: "s1" })).toBe(true);
		expect(footerVisible({ mode: "shell", sessionID: "s1" })).toBe(false);
		expect(footerVisible({ mode: "normal" })).toBe(false);
		expect(footerVisible({ mode: "normal", sessionID: "" })).toBe(false);
	});
});

describe("session view", () => {
	const session = (extra: Partial<FakeSession> = {}): FakeSession => ({
		model: { id: OPUS.id, providerID: "anthropic", variant: "max" },
		time: { created: NOW - 23 * 60_000 },
		cost: 4.21,
		messages: [{ type: "user" }, assistant],
		...extra,
	});

	test("reads the model with its effort, cost, age and context, and is two rows with a git chip", () => {
		const { context } = fakeContext({ sessions: { s1: session() }, models: [OPUS], branch: "main" });
		const input = sessionInput(context, "s1", GIT);
		expect(input).toMatchObject({
			model: { name: "Opus 5.5", family: "claude-opus", effort: "max" },
			directory: LOCATION.directory,
			branch: "main",
			costUsd: 4.21,
			createdMs: NOW - 23 * 60_000,
			context: { tokens: 283_000, limit: 1_000_000 },
		});
		const text = rows(input);
		expect(text).toHaveLength(2);
		expect(text[0]).toContain("Opus 5.5");
		expect(text[0]).toContain("my-app");
		expect(text[0]).toContain("~2");
		expect(text[0]).toContain("$4.21");
		expect(text[0]).toContain("23m");
		expect(text[0]).toContain("+10");
		expect(text[1]).toBe("ctx ▆▆▆▆▆▆▆▆▆▆ 28% 283k/1M");
	});

	test("a session without messages has one row", () => {
		const { context } = fakeContext({ sessions: { s1: session({ messages: [] }) }, models: [OPUS] });
		expect(rows(sessionInput(context, "s1", NO_GIT))).toHaveLength(1);
	});

	test("the effort follows the prompt's selection when the session's model has none", () => {
		const { context } = fakeContext({
			sessions: { s1: session({ model: { id: OPUS.id, providerID: "anthropic" } }) },
			models: [OPUS],
			current: { providerID: "anthropic", modelID: OPUS.id, variant: "high" },
		});
		expect(sessionInput(context, "s1", NO_GIT).model?.effort).toBe("high");

		const other = fakeContext({
			sessions: { s1: session({ model: { id: OPUS.id, providerID: "anthropic" } }) },
			models: [OPUS],
			current: { providerID: "openai", modelID: "gpt-5.5", variant: "high" },
		});
		expect(sessionInput(other.context, "s1", NO_GIT).model?.effort).toBeUndefined();
	});

	test("without a session model it takes the prompt's model; without a catalogue entry, the id", () => {
		const { context } = fakeContext({ sessions: { s1: { cost: 0 } }, models: [], current: { providerID: "x", modelID: "mystery-1", variant: "low" } });
		expect(sessionInput(context, "s1", NO_GIT).model).toEqual({ name: "mystery-1", family: "mystery-1", effort: "low" });
		const none = fakeContext({ sessions: { s1: {} } });
		expect(sessionInput(none.context, "s1", NO_GIT).model).toBeUndefined();
		expect(sessionInput(none.context, "s1", NO_GIT).costUsd).toBe(0);
	});

	test("the directory is the session's own location, else the context's, else the default", () => {
		const own = fakeContext({ sessions: { s1: { location: { directory: "/own" } } }, location: { directory: "/ctx" } });
		expect(sessionDirectory(own.context, "s1")).toBe("/own");
		expect(sessionInput(own.context, "s1", NO_GIT).directory).toBe("/own");
		const ctx = fakeContext({ sessions: { s1: {} }, location: { directory: "/ctx" } });
		expect(sessionDirectory(ctx.context, "s1")).toBe("/ctx");
		const fallback = fakeContext({ sessions: { s1: {} } });
		expect(sessionDirectory(fallback.context, "s1")).toBe(LOCATION.directory);
		expect(sessionDirectory(fallback.context, undefined)).toBe(LOCATION.directory);
	});

	test("the session's subpath names a worktree that differs from the branch", () => {
		const { context } = fakeContext({ sessions: { s1: session({ subpath: "statusline" }) }, models: [OPUS], branch: "feature/statusline" });
		expect(rows(sessionInput(context, "s1", GIT))[0]).toContain("my-app·statusline");
		const same = fakeContext({ sessions: { s1: session({ subpath: "main" }) }, models: [OPUS], branch: "main" });
		expect(rows(sessionInput(same.context, "s1", GIT))[0]).not.toContain("my-app·");
	});
});

describe("running counts", () => {
	test("subagents are the other running sessions of the family, shells the running ones that session started", () => {
		const { context } = fakeContext({
			sessions: {
				root: { status: "running" },
				a: { status: "running" },
				b: { status: "idle" },
				c: { status: "running" },
			},
			families: { root: ["root", "a", "b", "c"] },
			shells: [
				{ status: "running", metadata: { sessionID: "root" } },
				{ status: "running", metadata: { sessionID: "root" } },
				{ status: "exited", metadata: { sessionID: "root" } },
				{ status: "running", metadata: { sessionID: "a" } },
				{ status: "running" },
			],
		});
		expect(sessionInput(context, "root", NO_GIT).counts).toEqual({ subagents: 2, shells: 2 });
		expect(rows(sessionInput(context, "root", NO_GIT))[0]).toContain("◈ 2 ⌘ 2");
	});

	test("known limitation: in a child session the family also holds its siblings and the parent", () => {
		// session.family() is every session under the same root, so these are counted for "a" too.
		const { context } = fakeContext({
			sessions: { root: { status: "running" }, a: { status: "running" }, b: { status: "running" } },
			families: { a: ["root", "a", "b"] },
		});
		expect(sessionInput(context, "a", NO_GIT).counts).toEqual({ subagents: 2, shells: 0 });
	});

	test("nothing running draws no chip, and the counts option switches it off", () => {
		const { context } = fakeContext({ sessions: { s1: {} } });
		expect(rows(sessionInput(context, "s1", NO_GIT))[0]).not.toMatch(/[◈⌘]/);
		const busy = fakeContext({ sessions: { s1: {}, s2: { status: "running" } }, families: { s1: ["s1", "s2"] } });
		expect(rows(sessionInput(busy.context, "s1", NO_GIT))[0]).toContain("◈ 1");
		expect(rows(sessionInput(busy.context, "s1", NO_GIT), 200, readOptions({ counts: false }))[0]).not.toContain("◈");
	});
});

describe("home view", () => {
	test("one row: the same chips, no session to describe", () => {
		const { context } = fakeContext({ models: [OPUS], current: { providerID: "anthropic", modelID: OPUS.id, variant: "max" }, branch: "main" });
		const input = homeInput(context, GIT);
		expect(input).toMatchObject({ model: { name: "Opus 5.5", effort: "max" }, directory: LOCATION.directory, costUsd: 0 });
		expect(input.counts).toBeUndefined();
		expect(input.context).toBeUndefined();
		expect(input.createdMs).toBeUndefined();
		const text = rows(input);
		expect(text).toHaveLength(1);
		expect(text[0]).toContain("Opus 5.5");
		expect(text[0]).toContain("my-app");
		expect(text[0]).not.toContain("$");
	});

	test("the directory comes from the context, else the default; no model selected means no chip", () => {
		expect(homeDirectory(fakeContext({ location: { directory: "/ctx" } }).context)).toBe("/ctx");
		const { context } = fakeContext({});
		expect(homeDirectory(context)).toBe(LOCATION.directory);
		expect(homeInput(context, NO_GIT).model).toBeUndefined();
	});
});

describe("width", () => {
	const wide = () => {
		const { context } = fakeContext({ sessions: { s1: { model: { id: OPUS.id, providerID: "anthropic", variant: "max" }, time: { created: NOW - 23 * 60_000 }, cost: 4.21, messages: [assistant] } }, models: [OPUS], branch: "main" });
		return sessionInput(context, "s1", GIT);
	};

	test("nothing is drawn on a terminal narrower than minimumWidth", () => {
		expect(rows(wide(), 43)).toEqual([]);
		expect(rows(wide(), 44).length).toBeGreaterThan(0);
		expect(rows(wide(), 59, readOptions({ minimumWidth: 60 }))).toEqual([]);
		expect(rows(wide(), 60, readOptions({ minimumWidth: 60 })).length).toBeGreaterThan(0);
	});

	test("the rows fit the terminal width minus 4 columns and the reserve", () => {
		for (const width of [60, 80, 100, 140]) {
			const options = readOptions({ glyphs: "plain" });
			const drawn = rows(wide(), width, options);
			for (const row of drawn) expect(Bun.stringWidth(row)).toBeLessThanOrEqual(width - 4 - options.reserve);
		}
		// A smaller reserve leaves room for more.
		const tight = rows(wide(), 70, readOptions({ glyphs: "plain" }))[0] ?? "";
		const roomy = rows(wide(), 70, readOptions({ glyphs: "plain", reserve: 0 }))[0] ?? "";
		expect(roomy.length).toBeGreaterThan(tight.length);
	});

	test("a narrow terminal drops stats before chips", () => {
		const full = rows(wide(), 200)[0] ?? "";
		const narrow = rows(wide(), 70)[0] ?? "";
		expect(full).toContain("23m");
		expect(narrow).not.toContain("23m");
		expect(narrow).toContain("Opus 5.5");
	});

	test("the terminal width comes from the renderer, 80 until it reports one", () => {
		expect(terminalWidth({ width: 132 })).toBe(132);
		expect(terminalWidth({ width: 100.9 })).toBe(100);
		expect(terminalWidth({ width: 0 })).toBe(80);
		expect(terminalWidth({ width: "wide" })).toBe(80);
		expect(terminalWidth({})).toBe(80);
		expect(terminalWidth(undefined)).toBe(80);
	});
});

describe("cells to text runs", () => {
	test("colors become #rrggbb strings, and cells without a color have none", () => {
		const { context } = fakeContext({ sessions: { s1: { cost: 4.21 } }, models: [OPUS], current: { providerID: "anthropic", modelID: OPUS.id } });
		const options = readOptions();
		const [row] = statusRows(toStatusSnapshot(sessionInput(context, "s1", NO_GIT), options, NOW), options, 200, NOW);
		expect(row?.[0]).toEqual({ text: " Opus 5.5 ", fg: "#1a1b26", bg: "#bb9af7", bold: true });
		expect(row?.some((run) => run.fg === undefined && run.bg === undefined)).toBe(true);
		for (const run of row ?? []) {
			for (const color of [run.fg, run.bg]) if (color !== undefined) expect(color).toMatch(/^#[0-9a-f]{6}$/);
		}
	});
});
