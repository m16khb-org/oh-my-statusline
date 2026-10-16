// Ported from codex-statusline/test/test_statusline.py (12 tests) plus the launcher and collector
// rules those tests relied on: rollout consumption, the snapshot mapping, thread lookup, tmux
// style conversion, CLI classification.

import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { findThread, initialState, workingChanges } from "../../../src/harnesses/codex/collector.ts";
import { interactiveArgs, shouldPassThrough } from "../../../src/harnesses/codex/launcher.ts";
import { type PayloadInput, snapshotFor, threadIdFromTitle } from "../../../src/harnesses/codex/payload.ts";
import { consume, RolloutReader, type RolloutState } from "../../../src/harnesses/codex/rollout.ts";
import { ansiToTmux } from "../../../src/harnesses/codex/tmux.ts";
import { NOW_MS, renderRows, stripAnsi } from "./helpers.ts";

let tmp: string;
beforeEach(() => {
	tmp = mkdtempSync(path.join(tmpdir(), "oms-codex-"));
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

const input = (over: Partial<PayloadInput> = {}): PayloadInput => ({
	cwd: "/tmp",
	startedMs: NOW_MS,
	nowMs: NOW_MS,
	linesAdded: 0,
	linesRemoved: 0,
	git: null,
	...over,
});

const tokenCount = (payload: Record<string, unknown>) => ({ type: "event_msg", payload: { type: "token_count", ...payload } });

describe("rate limits and context", () => {
	// test_weekly_primary_is_not_mislabelled_as_five_hour
	test("a weekly primary window is labelled 7d, never 5h; Codex has no cost or cache lifetime", () => {
		const state: RolloutState = {};
		consume(state, tokenCount({
			info: { last_token_usage: { total_tokens: 25000 }, model_context_window: 100000 },
			rate_limits: { primary: { used_percent: 83, window_minutes: 10080, resets_at: 2000 } },
		}));
		const snapshot = snapshotFor(state, input({ startedMs: 1_000_000 }));
		expect(snapshot.limits).toEqual([{ label: "7d", usedPct: 83, resetsAtMs: 2_000_000, windowMs: 604_800_000, scopedModel: null }]);
		expect(snapshot.context?.usedPct).toBe(15);
		expect(snapshot.stats.costUsd).toBeNull();
		expect(snapshot.cache).toBeNull();
		expect(snapshot.pr).toBeNull();
	});

	// test_rate_limit_refresh_does_not_erase_token_usage
	test("a rate-limit refresh with info null keeps the token usage", () => {
		const state: RolloutState = {};
		consume(state, tokenCount({ info: { last_token_usage: { total_tokens: 20800 }, model_context_window: 100000 } }));
		consume(state, tokenCount({ info: null, rate_limits: { secondary: { used_percent: 5, window_minutes: 300, resets_at: 4000 } } }));
		const snapshot = snapshotFor(state, input());
		expect(snapshot.context?.usedPct).toBe(10);
		expect(snapshot.limits[0]).toMatchObject({ label: "5h", usedPct: 5, resetsAtMs: 4_000_000 });
	});

	test("rate limits of another limit id are ignored; the default and codex ids are taken", () => {
		const state: RolloutState = {};
		consume(state, tokenCount({ rate_limits: { limit_id: "codex_other", primary: { used_percent: 99, window_minutes: 300 } } }));
		expect(state.rate_limits).toBeUndefined();
		consume(state, tokenCount({ rate_limits: { limit_id: "codex", primary: { used_percent: 7, window_minutes: 300 } } }));
		expect(snapshotFor(state, input()).limits[0]?.usedPct).toBe(7);
	});

	test("context follows Codex 0.156.1: the first 12,000 tokens are a baseline", () => {
		const used = (tokens: number, size: number) =>
			snapshotFor({ info: { last_token_usage: { total_tokens: tokens }, model_context_window: size } }, input()).context?.usedPct;
		expect(used(12000, 100000)).toBe(0);
		expect(used(5000, 100000)).toBe(0);
		expect(used(56000, 100000)).toBe(50);
		expect(used(100000, 100000)).toBe(100);
		expect(used(500000, 100000)).toBe(100);
		expect(used(1000, 12000)).toBe(100);
	});

	test("without a reading the context and 7d show placeholders; a missing 5h window is omitted", () => {
		const snapshot = snapshotFor({}, input());
		expect(snapshot.context?.usedPct).toBeNull();
		expect(snapshot.limits).toMatchObject([{ label: "7d", usedPct: null, resetsAtMs: null }]);
		const window = snapshotFor({ info: { model_context_window: 100000 } }, input());
		expect(window.context?.usedPct).toBeNull();
	});

	// test_renderer_preserves_two_rows_with_unavailable_metrics
	test("two rows survive unavailable metrics: no cost, cache or 5h; ctx and 7d placeholders", () => {
		const snapshot = snapshotFor({ model: "gpt-6-astra", effort: "max" }, input({ cwd: tmp }));
		const rows = renderRows(snapshot, 140).map(stripAnsi);
		expect(rows[0]).toContain("GPT-6 Astra");
		expect(rows[0]).not.toContain("$—");
		expect(rows[0]).not.toContain("cache —");
		expect(rows[1]).not.toContain("5h —");
		expect(rows[1]).toContain("ctx —");
		expect(rows[1]).toContain("7d —");
	});
});

describe("prompt cache", () => {
	// test_cache_hit_uses_last_request_input_not_session_total
	test("the hit rate uses the last request, not the session total", () => {
		const state: RolloutState = {
			info: {
				total_token_usage: { input_tokens: 90620, cached_input_tokens: 58240 },
				last_token_usage: { input_tokens: 31990, cached_input_tokens: 30592, total_tokens: 32018 },
			},
		};
		const snapshot = snapshotFor(state, input());
		expect(snapshot.cache).toEqual({ hitPct: 96, ttlRemainingMs: null });
		const row = stripAnsi(renderRows(snapshot, 140)[0] ?? "");
		expect(row).toContain("cache hit ");
		expect(row).toContain("96%");
	});

	// test_zero_cache_hits_are_known_and_visible
	test("a zero hit rate is known and shown", () => {
		const snapshot = snapshotFor({ info: { last_token_usage: { input_tokens: 1000, cached_input_tokens: 0 } } }, input());
		expect(snapshot.cache?.hitPct).toBe(0);
		const row = stripAnsi(renderRows(snapshot, 140)[0] ?? "");
		expect(row).toContain("cache hit ");
		expect(row).toContain("0%");
	});
});

describe("rollout reading", () => {
	// test_partial_json_line_is_read_only_once_when_completed
	test("a partial line is read once, when it is completed", () => {
		const file = path.join(tmp, "rollout.jsonl");
		const first = JSON.stringify({ type: "turn_context", payload: { model: "gpt-6-astra", effort: "max" } });
		writeFileSync(file, first.slice(0, 25));
		const reader = new RolloutReader(file);
		expect(reader.read()).toEqual({});
		appendFileSync(file, `${first.slice(25)}\n`);
		expect(reader.read().model).toBe("gpt-6-astra");
		expect(reader.read().effort).toBe("max");
	});

	test("only new bytes are consumed, and a file that shrinks is read from the start", () => {
		const file = path.join(tmp, "rollout.jsonl");
		const line = (model: string) => `${JSON.stringify({ type: "turn_context", payload: { model } })}\n`;
		writeFileSync(file, `${line("one")}not json\n`);
		const reader = new RolloutReader(file);
		expect(reader.read().model).toBe("one");
		appendFileSync(file, line("two"));
		expect(reader.read().model).toBe("two");
		writeFileSync(file, line("x"));
		expect(reader.read()).toEqual({ model: "x" });
	});

	test("session_meta supplies cwd and the start time that the duration counts from", () => {
		const state: RolloutState = {};
		consume(state, { type: "session_meta", payload: { cwd: "/work/app", timestamp: "2026-10-17T08:00:00.123456Z" } });
		const started = Date.parse("2026-10-17T08:00:00.123Z");
		const snapshot = snapshotFor(state, input({ nowMs: started + 90_000, cwd: "/elsewhere" }));
		expect(snapshot.stats.durationMs).toBe(90_000);
		expect(snapshot.dir.name).toBe("app");
	});

	// test_model_change_without_another_turn_updates_status
	test("a model change without another turn updates the status", () => {
		const state: RolloutState = { model: "gpt-6-astra", effort: "high" };
		consume(state, { type: "event_msg", payload: { type: "thread_settings_applied", thread_settings: { model: "gpt-6-sol", reasoning_effort: "max", cwd: "/tmp/new" } } });
		const snapshot = snapshotFor(state, input({ cwd: "/tmp/old" }));
		expect(snapshot.model).toMatchObject({ family: "gpt-6-sol", name: "GPT-6 Sol" });
		expect(snapshot.effort).toBe("max");
		expect(snapshot.dir.name).toBe("new");
	});
});

describe("thread lookup", () => {
	function threads(file: string, rows: string[][]): void {
		const db = new Database(file);
		db.exec("CREATE TABLE threads (id TEXT, rollout_path TEXT, cwd TEXT, model TEXT, reasoning_effort TEXT)");
		for (const row of rows) db.query("INSERT INTO threads VALUES (?, ?, ?, ?, ?)").run(...row);
		db.close();
	}

	// test_thread_lookup_rejects_ambiguous_prefix
	test("an ambiguous or unknown prefix selects nothing; a unique one finds the thread", () => {
		threads(path.join(tmp, "state_5.sqlite"), [
			["abc-one", "/one", "/one", "model-one", "high"],
			["abc-two", "/two", "/two", "model-two", "max"],
		]);
		expect(findThread(tmp, "abc")).toBeNull();
		expect(findThread(tmp, "missing")).toBeNull();
		expect(findThread(tmp, "abc-two")).toMatchObject({ rollout_path: "/two", model: "model-two", reasoning_effort: "max" });
	});

	test("the newest state database is searched first, and unreadable ones are skipped", () => {
		writeFileSync(path.join(tmp, "state_1.sqlite"), "not a database");
		threads(path.join(tmp, "state_2.sqlite"), [["id-2", "/old", "/old", "m", "low"]]);
		threads(path.join(tmp, "state_3.sqlite"), [["id-3", "/new", "/new", "m", "low"]]);
		expect(findThread(tmp, "id-3")?.rollout_path).toBe("/new");
		expect(findThread(tmp, "id-2")?.rollout_path).toBe("/old");
		expect(findThread(path.join(tmp, "absent"), "id")).toBeNull();
	});

	test("the first state comes from config.toml and the launch arguments", () => {
		writeFileSync(path.join(tmp, "config.toml"), 'model = "gpt-6-astra"\nmodel_reasoning_effort = "high"\n');
		expect(initialState(tmp, [])).toEqual({ model: "gpt-6-astra", effort: "high" });
		const state = initialState(tmp, ["-m", "gpt-6-sol", "-C", tmp, "-c", 'model_reasoning_effort="max"', "-c", "not toml ["]);
		expect(state).toMatchObject({ model: "gpt-6-sol", effort: "max", cwd: tmp });
	});
});

describe("terminal title", () => {
	// test_foreign_or_empty_title_never_selects_a_recent_session
	test("only a thread id, or its 32-cell cut, selects a session", () => {
		expect(threadIdFromTitle("12345678-1234-1234-1234-12345...")).toBe("12345678-1234-1234-1234-12345");
		expect(threadIdFromTitle("codex")).toBeNull();
		expect(threadIdFromTitle("project-name")).toBeNull();
		expect(threadIdFromTitle("")).toBeNull();
		expect(threadIdFromTitle("12345678-1234-1234-1234-123456789abc")).toBe("12345678-1234-1234-1234-123456789abc");
		expect(threadIdFromTitle("  12345678-1234-1234-1234-123456789abc \n")).toBe("12345678-1234-1234-1234-123456789abc");
	});
});

describe("tmux styles", () => {
	// test_ansi_style_and_literal_tmux_metacharacters
	test("SGR becomes tmux styles and tmux metacharacters stay literal", () => {
		const output = ansiToTmux("\x1b[1;38;2;187;154;247mGPT #[fg=red] #(touch /tmp/no)\x1b[0m");
		expect(output).toContain("fg=#bb9af7");
		expect(output).toContain("bold");
		expect(output).toContain("##[fg=red]");
		expect(output).toContain("##(touch /tmp/no)");
		expect(output).not.toContain("\x1b");
	});

	test("backgrounds, 256-color, resets and hyperlinks", () => {
		expect(ansiToTmux("\x1b[0;38;2;1;2;3;48;2;255;0;16mx")).toBe("#[default,fg=#010203,bg=#ff0010]x");
		expect(ansiToTmux("\x1b[38;5;99mx\x1b[m")).toBe("#[fg=colour99]x#[default]");
		expect(ansiToTmux("\x1b]8;;https://example.com\x07link\x1b]8;;\x07\x07\x1b[0m")).toBe("link#[default]");
		expect(ansiToTmux("a\x00b\x1bc")).toBe("abc");
	});
});

describe("line totals", () => {
	// test_working_changes_counts_staged_and_unstaged_lines
	test("counts staged and unstaged lines against HEAD", async () => {
		const git = (...args: string[]) => Bun.spawnSync(["git", "-C", tmp, ...args], { stdout: "ignore", stderr: "pipe" });
		git("init", "-q");
		const file = path.join(tmp, "sample");
		writeFileSync(file, "one\ntwo\n");
		git("add", "sample");
		git("-c", "user.name=Test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", "commit", "-qm", "initial");
		writeFileSync(file, "one\ntwo\nthree\n");
		git("add", "sample");
		writeFileSync(file, "two\nthree\n");
		expect(await workingChanges(tmp)).toEqual({ added: 1, removed: 1 });
	});

	test("outside a repository the totals are zero", async () => {
		mkdirSync(path.join(tmp, "plain"));
		expect(await workingChanges(path.join(tmp, "plain"))).toEqual({ added: 0, removed: 0 });
	});
});

describe("command classification", () => {
	// test_commands_and_option_values_are_not_mistaken_for_prompts
	test("subcommands, help and option values are not prompts", () => {
		for (const args of [[], ["hello"], ["resume", "--last"], ["-m", "gpt-6-astra"], ["-c", 'model="gpt-6-astra"', "hello"]]) {
			expect(interactiveArgs(args)).toBe(true);
		}
		for (const args of [["exec", "hello"], ["--version"], ["mcp", "list"], ["-C", "/tmp", "exec", "hello"], ["resume", "--help"], ["-h"]]) {
			expect(interactiveArgs(args)).toBe(false);
		}
	});

	test("the launcher passes through unless it can draw the status line", () => {
		expect(shouldPassThrough([], {}, true)).toBe(false);
		expect(shouldPassThrough([], {}, false)).toBe(true);
		expect(shouldPassThrough(["--help"], {}, true)).toBe(true);
		expect(shouldPassThrough(["exec", "x"], {}, true)).toBe(true);
		expect(shouldPassThrough([], { CODEX_STATUSLINE_DISABLE: "1" }, true)).toBe(true);
		expect(shouldPassThrough([], { CODEX_STATUSLINE_ACTIVE: "1" }, true)).toBe(true);
		expect(shouldPassThrough([], { CODEX_STATUSLINE_DISABLE: "0" }, true)).toBe(false);
	});
});
