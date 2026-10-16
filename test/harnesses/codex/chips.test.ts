// Codex's environment chips, pull request and today's cost: the payload mapping, and the outer
// tmux the launcher records before Codex moves into its private server.

import { describe, expect, test } from "bun:test";
import type { PrState } from "../../../src/domain/model/snapshot.ts";
import { EnvAdapter } from "../../../src/infrastructure/env-chips.ts";
import { PrAdapter } from "../../../src/infrastructure/pr.ts";
import { outerTmux } from "../../../src/harnesses/codex/launcher.ts";
import { snapshotFor } from "../../../src/harnesses/codex/payload.ts";
import { NOW_MS, renderRows, stripAnsi } from "./helpers.ts";

const base = { cwd: "/tmp", startedMs: NOW_MS, nowMs: NOW_MS, linesAdded: 0, linesRemoved: 0, git: { top: "/r", main: "/r", state: { branch: "main", ahead: 0, behind: 0, conflicts: 0, staged: 0, modified: 0, untracked: 0, detachedOid: null } } };
const PR: PrState = { number: 12, url: "https://github.com/o/r/pull/12", state: "approved", kind: "pr" };
const row = (input: object) => stripAnsi(renderRows(snapshotFor({ model: "gpt-6-astra" }, { ...base, ...input }), 160)[0]!);

describe("payload", () => {
	test("a pull request read through gh/glab becomes the PR chip; Codex itself still reports none", () => {
		expect(row({})).not.toMatch(/#\d/);
		expect(row({ pr: PR })).toContain("#12 ✓");
	});

	test("environment chips and today's cost are shown when given", () => {
		const r = row({ env: { ssh: "dev-box", tmux: "work:1", venv: ".venv", k8s: null }, todayCostUsd: 3.5 });
		for (const part of ["ssh dev-box", "tmux work:1", "venv .venv", "Σ $3.50"]) expect(r).toContain(part);
		expect(r).not.toContain("k8s");
	});

	test("no cost chip, no cost: Codex has no per-session cost", () => {
		expect(row({ todayCostUsd: null })).not.toContain("$");
	});

	test("gh missing: the adapter returns no PR, so no chip", async () => {
		const exec = async (cmd: string[]) => (cmd[0] === "git" ? "git@github.com:o/r.git" : "{}");
		const pr = await new PrAdapter(exec, () => null).read("/r");
		expect(pr).toBeNull();
		expect(row({ pr })).not.toMatch(/#\d/);
	});
});

describe("outer tmux recorded at launch", () => {
	test("the user's TMUX, pane and the session:window they resolve to", async () => {
		const calls: string[][] = [];
		const adapter = new EnvAdapter({ exec: async (cmd) => (calls.push(cmd), "work:editor\n") });
		const spec = await outerTmux({ TMUX: "/tmp/tmux-501/default,77,2", TMUX_PANE: "%5" }, adapter);
		expect(spec).toEqual({ outerTmux: "/tmp/tmux-501/default,77,2", outerPane: "%5", outerLabel: "work:editor" });
		expect(calls).toEqual([["tmux", "-S", "/tmp/tmux-501/default", "display-message", "-p", "-t", "%5", "#S:#W"]]);
	});

	test("outside tmux nothing is recorded and tmux is never run", async () => {
		const calls: string[][] = [];
		const adapter = new EnvAdapter({ exec: async (cmd) => (calls.push(cmd), "x:y") });
		expect(await outerTmux({}, adapter)).toEqual({ outerTmux: null, outerPane: null, outerLabel: null });
		expect(calls).toEqual([]);
	});

	test("a tmux that cannot answer records a null label", async () => {
		const adapter = new EnvAdapter({ exec: async () => null });
		expect((await outerTmux({ TMUX: "/s,1,0" }, adapter)).outerLabel).toBeNull();
	});
});
