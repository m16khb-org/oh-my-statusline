// Claude's environment chips, gh/glab pull request and today's cost: each read through the
// FileCache stale-first, so a render never waits for tmux's slow siblings, kubectl, gh or the
// stats collector, and a detached helper (`--refresh <kind>`) fills the cache.

import { afterEach, describe, expect, test } from "bun:test";
import type { PrPort } from "../../../src/application/ports.ts";
import type { PrState } from "../../../src/domain/model/snapshot.ts";
import { EnvAdapter } from "../../../src/infrastructure/env-chips.ts";
import type { CommandRunner } from "../../../src/infrastructure/process.ts";
import { cleanTemps, DELETE, harness, type Harness, NOW_MS, render, session, strip, writeAged } from "./support.ts";

afterEach(cleanTemps);

const PR: PrState = { number: 31, url: "https://github.com/octocat/my-app/pull/31", state: "pending", kind: "pr" };
const TMUX_ENV = { TMUX: "/tmp/outer,9,1", TMUX_PANE: "%4" };
const TMUX_KEY = "claude-tmux:/tmp/outer:%4";

interface Fakes {
	calls: string[][];
	warnings: string[];
	prReads: string[];
	costReads: number;
}

/** Wire the optional deps of a harness: a recording runner, kubectl presence, a PR port, today's cost. */
function wire(h: Harness, options: { answers?: Record<string, string | null>; kubectl?: boolean; pr?: PrState | null; cost?: number | null; config?: unknown } = {}): Fakes {
	const fakes: Fakes = { calls: [], warnings: [], prReads: [], costReads: 0 };
	// A fresh usage entry keeps its own background refresh out of `spawned`.
	h.cache.write("claude-usage", []);
	const exec: CommandRunner = async (cmd) => {
		fakes.calls.push(cmd);
		return options.answers?.[cmd[0] ?? ""] ?? null;
	};
	h.deps.chips = new EnvAdapter({ exec, which: () => (options.kubectl === false ? null : "/bin/kubectl"), warn: (m) => fakes.warnings.push(m), hostname: () => "dev-box.lan" });
	const pr: PrPort = {
		async read(cwd) {
			fakes.prReads.push(cwd);
			return options.pr ?? null;
		},
	};
	h.deps.pr = pr;
	h.deps.todayCost = () => {
		fakes.costReads++;
		return options.cost ?? null;
	};
	if (options.config !== undefined) h.deps.configFile = { raw: options.config };
	return fakes;
}

const row1 = async (h: Harness, over: Record<string, unknown> = {}) => strip((await render(h, session("/tmp", over))).rows[0]!);

describe("ssh and venv: environment only", () => {
	test("both appear after the counts, and never run a command", async () => {
		const h = harness({ env: { SSH_CONNECTION: "1.2.3.4 5 6.7.8.9 22", VIRTUAL_ENV: "/home/me/app/.venv" } });
		const fakes = wire(h);
		const row = await row1(h);
		expect(row).toContain("ssh dev-box");
		expect(row).toContain("venv .venv");
		expect(fakes.calls).toEqual([]);
	});

	test("the config switches turn them off", async () => {
		const h = harness({ env: { SSH_CONNECTION: "a b c d", VIRTUAL_ENV: "/x/.venv" } });
		wire(h, { config: { chips: { ssh: false, venv: false } } });
		const row = await row1(h);
		expect(row).not.toContain("ssh");
		expect(row).not.toContain("venv");
	});

	test("outside SSH and without a virtualenv there is nothing", async () => {
		const h = harness();
		wire(h);
		const row = await row1(h);
		expect(row).not.toContain("ssh");
		expect(row).not.toContain("venv");
	});
});

describe("tmux", () => {
	test("the first render asks tmux (cheap) and caches the answer; a fresh entry is used as is", async () => {
		const h = harness({ env: TMUX_ENV });
		const fakes = wire(h, { answers: { tmux: "work:editor\n" } });
		expect(await row1(h)).toContain("tmux work:editor");
		expect(fakes.calls).toEqual([["tmux", "-S", "/tmp/outer", "display-message", "-p", "-t", "%4", "#S:#W"]]);
		expect(h.cache.read(TMUX_KEY)?.value).toEqual({ v: "work:editor" });
		expect(await row1(h)).toContain("tmux work:editor");
		expect(fakes.calls).toHaveLength(1);
		expect(h.spawned).toEqual([]);
	});

	test("a stale entry is drawn now and refreshed in the background", async () => {
		const h = harness({ env: TMUX_ENV });
		const fakes = wire(h, { answers: { tmux: "new:name" } });
		writeAged(h, TMUX_KEY, { v: "old:name" }, 6_000);
		expect(await row1(h)).toContain("tmux old:name");
		expect(h.spawned).toEqual([["tmux"]]);
		expect(fakes.calls).toEqual([]);
		await render(h, "", ["--refresh", "tmux"]);
		expect(h.cache.read(TMUX_KEY)?.value).toEqual({ v: "new:name" });
	});

	test("no tmux server: the chip is omitted, and not retried within 5 s", async () => {
		const h = harness({ env: TMUX_ENV });
		const fakes = wire(h, { answers: {} });
		expect(await row1(h)).not.toContain("tmux");
		expect(await row1(h)).not.toContain("tmux");
		expect(fakes.calls).toHaveLength(1);
	});

	test("outside tmux, or with chips.tmux off, tmux is never asked", async () => {
		const outside = harness();
		const a = wire(outside, { answers: { tmux: "x:y" } });
		expect(await row1(outside)).not.toContain("tmux");
		const off = harness({ env: TMUX_ENV });
		const b = wire(off, { answers: { tmux: "x:y" }, config: { chips: { tmux: false } } });
		expect(await row1(off)).not.toContain("tmux");
		expect(a.calls.concat(b.calls)).toEqual([]);
	});
});

describe("k8s (opt-in)", () => {
	test("off by default: kubectl is never looked up", async () => {
		const h = harness();
		const fakes = wire(h, { answers: { kubectl: "prod" }, kubectl: false });
		expect(await row1(h)).not.toContain("k8s");
		expect(fakes.warnings).toEqual([]);
		expect(h.spawned).toEqual([]);
	});

	test("on: the first render starts a background read, the next one shows the cached context", async () => {
		const h = harness();
		const fakes = wire(h, { answers: { kubectl: "prod-eu\n" }, config: { chips: { k8s: true } } });
		expect(await row1(h)).not.toContain("k8s");
		expect(h.spawned).toEqual([["k8s"]]);
		await render(h, "", ["--refresh", "k8s"]);
		expect(fakes.calls).toEqual([["kubectl", "config", "current-context"]]);
		expect(await row1(h)).toContain("k8s prod-eu");
	});

	test("on but kubectl missing: omitted, one warning per process, nothing printed into the rows", async () => {
		const h = harness();
		const fakes = wire(h, { kubectl: false, config: { chips: { k8s: true } } });
		const { out } = await render(h, session("/tmp"));
		expect(strip(out)).not.toContain("k8s");
		expect(strip(out)).not.toContain("kubectl");
		await render(h, session("/tmp"));
		expect(fakes.warnings).toHaveLength(1);
		expect(h.spawned).toEqual([]);
	});
});

describe("pull request from gh/glab", () => {
	const noPr = { "pr.number": DELETE, "pr.url": DELETE, "pr.review_state": DELETE, pr: DELETE };
	const branch = "# branch.oid ca8cb99\n# branch.head feature\n";

	test("the session JSON's PR wins and gh is never asked", async () => {
		const h = harness();
		const fakes = wire(h, { pr: PR });
		expect(await row1(h)).toContain("#512");
		expect(fakes.prReads).toEqual([]);
	});

	test("without a session PR the cached gh result is drawn (300 s), refreshed in the background", async () => {
		const h = harness({ git: branch });
		const fakes = wire(h, { pr: PR });
		expect(await row1(h, noPr)).not.toContain("#31");
		expect(h.spawned).toEqual([["pr", "/tmp", "feature"]]);
		await render(h, "", ["--refresh", "pr", "/tmp", "feature"]);
		expect(fakes.prReads).toEqual(["/tmp"]);
		expect(await row1(h, noPr)).toContain("#31");
		h.spawned.length = 0;
		await row1(h, noPr);
		expect(h.spawned).toEqual([]);
		writeAged(h, "claude-pr:/tmp:feature", { v: PR }, 301_000);
		await row1(h, noPr);
		expect(h.spawned).toEqual([["pr", "/tmp", "feature"]]);
	});

	test("gh missing or no open PR: no chip; pr.enabled = false never asks", async () => {
		const h = harness({ git: branch });
		wire(h, { pr: null });
		await render(h, "", ["--refresh", "pr", "/tmp", "feature"]);
		expect(await row1(h, noPr)).not.toMatch(/#\d/);

		const off = harness({ git: branch });
		const fakes = wire(off, { pr: PR, config: { pr: { enabled: false } } });
		await row1(off, noPr);
		expect(off.spawned).toEqual([]);
		expect(fakes.prReads).toEqual([]);
	});
});

describe("today's cost", () => {
	const TODAY_KEY = (h: Harness) => `claude-today:${new Date(h.clock.ms).toISOString().slice(0, 10)}`;

	test("off by default: nothing is read or spawned", async () => {
		const h = harness({ env: { TZ: "UTC" } });
		const fakes = wire(h, { cost: 12.34 });
		expect(await row1(h)).not.toContain("Σ");
		expect(h.spawned).toEqual([]);
		expect(fakes.costReads).toBe(0);
	});

	test("on: never computed on the render path; the refresh helper caches it for 120 s and the chip shows Σ", async () => {
		const h = harness({ env: { TZ: "UTC" } });
		const fakes = wire(h, { cost: 12.34, config: { stats: { chip: true } } });
		expect(await row1(h)).not.toContain("Σ");
		expect(fakes.costReads).toBe(0);
		expect(h.spawned).toEqual([["stats"]]);
		await render(h, "", ["--refresh", "stats"]);
		expect(fakes.costReads).toBe(1);
		expect(h.cache.read(TODAY_KEY(h))?.value).toEqual({ v: 12.34 });
		expect(await row1(h)).toContain("Σ $12.34");
		h.spawned.length = 0;
		await render(h, session("/tmp"));
		expect(h.spawned).toEqual([]);
		h.clock.ms = NOW_MS + 121_000;
		writeAged(h, TODAY_KEY(h), { v: 12.34 }, 121_000);
		h.spawned.length = 0;
		await render(h, session("/tmp"));
		expect(h.spawned).toContainEqual(["stats"]);
	});

	test("no cost stored today: the chip is omitted", async () => {
		const h = harness({ env: { TZ: "UTC" } });
		wire(h, { cost: null, config: { stats: { chip: true } } });
		await render(h, "", ["--refresh", "stats"]);
		expect(await row1(h)).not.toContain("Σ");
	});
});

