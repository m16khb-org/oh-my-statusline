// Ported from omp-statusline test/statusline.test.ts ("extension" suite), plus the behavior the
// port changed: snapshot-based rendering, the shared Poller, one git parse per refresh.

import { afterEach, beforeEach, describe, expect, setSystemTime, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { UsageReport } from "../../../src/harnesses/omp/host.ts";
import ompStatusline from "../../../src/harnesses/omp/main.ts";
import { draw, fakeOmp, mount, OPUS, plain } from "./fake-omp.ts";

const ENV_KEYS = ["XDG_CONFIG_HOME", "STATUSLINE_GLYPHS", "STATUSLINE_COLORS", "STATUSLINE_THEME", "OMP_STATUSLINE_NATIVE", "NO_COLOR", "COLORTERM", "PATH", "SSH_CONNECTION", "TMUX", "TMUX_PANE", "VIRTUAL_ENV", "CONDA_DEFAULT_ENV", "HOME", "XDG_CACHE_HOME", "TZ"];
let saved: Record<string, string | undefined>;
let tmp: string;

beforeEach(() => {
	saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
	tmp = mkdtempSync(path.join(tmpdir(), "omp-ext-test-"));
	process.env.XDG_CONFIG_HOME = path.join(tmp, "config");
	process.env.STATUSLINE_GLYPHS = "powerline";
	process.env.STATUSLINE_COLORS = "truecolor";
	process.env.STATUSLINE_THEME = "dark";
	delete process.env.OMP_STATUSLINE_NATIVE;
	delete process.env.NO_COLOR;
	// The environment chips read the real environment: a developer's shell must not change the rows.
	for (const key of ["SSH_CONNECTION", "TMUX", "TMUX_PANE", "VIRTUAL_ENV", "CONDA_DEFAULT_ENV"]) delete process.env[key];
});

afterEach(() => {
	for (const [k, v] of Object.entries(saved)) {
		if (v === undefined) delete process.env[k];
		else process.env[k] = v;
	}
	setSystemTime();
	rmSync(tmp, { recursive: true, force: true });
});

/** A directory outside any repository (the temp dir's ancestors carry no `.git`). */
const plainDir = () => {
	const dir = path.join(tmp, "plain");
	mkdirSync(dir, { recursive: true });
	return dir;
};

async function waitFor(check: () => boolean, what: string): Promise<void> {
	for (let i = 0; i < 400; i++) {
		if (check()) return;
		await Bun.sleep(5);
	}
	throw new Error(`timed out waiting for ${what}`);
}

async function started(over: Parameters<typeof fakeOmp>[1] = {}) {
	const h = fakeOmp(plainDir(), over);
	await ompStatusline(h.pi, h.host);
	const c = h.ctx();
	await h.emit("session_start", {}, c);
	return { h, c, rows: () => draw(h.widgets[0]?.content) };
}

describe("widget", () => {
	test("the main interactive session gets two rows below the prompt", async () => {
		const { h, rows } = await started();
		expect(h.widgets).toHaveLength(1);
		expect(h.widgets[0]).toMatchObject({ key: "oh-my-statusline", placement: "belowEditor" });
		const [row1, row2] = rows();
		expect(row1).toStartWith(" Opus 5.5 \ue0b0 high·fast \ue0b0 ");
		expect(row1).toContain("$4.21 · 23m");
		expect(row2).toStartWith("ctx ▆▆▆▆▆▆▆▆▆▆ 28% 283k/1M");
		expect(rows()).toHaveLength(2);
	});

	test("subagents and non-interactive modes get no status line", async () => {
		const h = fakeOmp(plainDir());
		await ompStatusline(h.pi, h.host);
		await h.emit("session_start", {}, h.ctx({ agent: { kind: "sub" } }));
		await h.emit("session_start", {}, h.ctx({ mode: "rpc" }));
		await h.emit("session_start", {}, h.ctx({ hasUI: false }));
		expect(h.widgets).toHaveLength(0);
		expect(h.state.ticks).toHaveLength(0);
	});

	test("events before the main session starts change nothing", async () => {
		const h = fakeOmp(plainDir());
		await ompStatusline(h.pi, h.host);
		const c = h.ctx({ agent: { kind: "sub" } });
		for (const event of ["session_switch", "message_end", "turn_start", "tool_execution_end", "agent_end", "after_provider_response"]) {
			await h.emit(event, { message: { role: "assistant" }, status: 200 }, c);
		}
		expect(h.widgets).toHaveLength(0);
		expect(h.state.contextReads).toBe(0);
	});

	test("the widget draws at the width it is given and keeps the same rows while nothing changes", async () => {
		const { h } = await started();
		const { widget } = mount(h.widgets[0]?.content);
		const wide = widget.render(160);
		expect(widget.render(160)).toBe(wide);
		const narrow = widget.render(60);
		expect(narrow).not.toBe(wide);
		expect(narrow).toHaveLength(2);
		for (const row of narrow) expect(Bun.stringWidth(row)).toBeLessThanOrEqual(60);
		expect(widget.render(60)).toBe(narrow);
		// Below the minimum width nothing is drawn.
		expect(widget.render(10)).toEqual([]);
	});

	test("invalidate redraws, and a tick that changes nothing requests no repaint", async () => {
		const { h } = await started();
		const mounted = mount(h.widgets[0]?.content);
		const first = mounted.widget.render(160);
		(mounted.widget as unknown as { invalidate(): void }).invalidate();
		expect(mounted.widget.render(160)).not.toBe(first);
		const before = mounted.renders;
		h.state.ticks[0]?.();
		h.state.ticks[0]?.();
		expect(mounted.renders).toBe(before);
		h.state.context = { tokens: 500_000, contextWindow: 1_000_000, percent: 50 };
		const c = h.ctx();
		await h.emit("message_end", { message: { role: "user" } }, c);
		expect(mounted.renders).toBe(before + 1);
	});

	test("the light theme of omp is followed unless STATUSLINE_THEME says otherwise", async () => {
		delete process.env.STATUSLINE_THEME;
		const dark = await started();
		const darkRaw = (dark.h.widgets[0]?.content as (t: unknown) => { render(w: number): string[] })({ requestRender() {} }).render(160)[0];
		const light = fakeOmp(plainDir());
		light.state.isLight = true;
		await ompStatusline(light.pi, light.host);
		await light.emit("session_start", {}, light.ctx());
		const lightRaw = (light.widgets[0]?.content as (t: unknown) => { render(w: number): string[] })({ requestRender() {} }).render(160)[0];
		expect(lightRaw).not.toBe(darkRaw);
		expect(plain(lightRaw ?? "")).toBe(plain(darkRaw ?? ""));
	});

	test("session shutdown stops the drawing", async () => {
		const { h } = await started();
		const { widget } = mount(h.widgets[0]?.content);
		await h.emit("session_shutdown", {}, h.ctx());
		h.state.ticks[0]?.();
		expect(widget.render(160)).toEqual([]);
	});
});

describe("prompt cache", () => {
	const reply = (over: object) => ({
		message: { role: "assistant", model: OPUS.id, timestamp: Date.now() - 61_000, usage: { cacheRead: 9000 }, ...over },
	});

	test("a finished response starts the prompt-cache countdown", async () => {
		const { h, c, rows } = await started();
		await h.emit("message_end", reply({}), c);
		expect(rows()[0]).toEndWith("· cache 58m");
	});

	test("a failed response keeps the cache countdown of the last good one", async () => {
		const { h, c, rows } = await started();
		await h.emit("message_end", reply({}), c);
		await h.emit("message_end", { message: { role: "assistant", model: OPUS.id, usage: { input: 0, output: 0 } } }, c);
		expect(rows()[0]).toEndWith("· cache 58m");
	});

	test("a successful cache-warmer replay restarts the lifetime; a failed one or another model's does not", async () => {
		// A frozen clock: the replay restarts a full hour, which a second ticking by would make 59m.
		setSystemTime(new Date(Date.now()));
		const { h, c, rows } = await started();
		await h.emit("message_end", reply({}), c);
		await h.emit("after_provider_response", { status: 500 }, c);
		h.state.ticks[0]?.();
		expect(rows()[0]).toEndWith("· cache 58m");
		await h.emit("after_provider_response", { status: 200 }, h.ctx({ model: { ...OPUS, id: "claude-sonnet-5-5" } }));
		h.state.ticks[0]?.();
		expect(rows()[0]).toEndWith("· cache 58m");
		await h.emit("after_provider_response", { status: 200 }, c);
		h.state.ticks[0]?.();
		expect(rows()[0]).toEndWith("· cache 1h");
	});

	test("a session that already has answers shows its countdown when it starts", async () => {
		const h = fakeOmp(plainDir());
		await ompStatusline(h.pi, h.host);
		const base = h.ctx();
		const c = h.ctx({
			sessionManager: {
				...base.sessionManager,
				getBranch: () => [{ type: "message", message: reply({}).message }],
			},
		});
		await h.emit("session_start", {}, c);
		expect(draw(h.widgets[0]?.content)[0]).toEndWith("· cache 58m");
	});

	test("models without a known lifetime show the hit rate", async () => {
		const { h, c, rows } = await started();
		const gpt = { id: "gpt-5.5", name: "GPT-5.5", provider: "openai-codex", api: "openai-codex-responses" };
		const gptCtx = h.ctx({ model: gpt });
		await h.emit("message_end", { message: { role: "assistant", model: gpt.id, usage: { input: 1000, cacheRead: 9000 } } }, gptCtx);
		expect(rows()[0]).toEndWith("· cache hit 90%");
		expect(c.model).toBe(OPUS);
	});
});

describe("fast mode and effort", () => {
	test("fast disappears when Anthropic refuses it, and returns when /fast changes the tier", async () => {
		const { h, c, rows } = await started();
		const refused = { role: "assistant", model: OPUS.id, usage: { input: 10 }, disabledFeatures: ["priority"] };
		await h.emit("message_end", { message: refused }, c);
		expect(rows()[0]).toStartWith(" Opus 5.5 \ue0b0 high \ue0b0 ");
		// /fast off, then on again: omp re-arms fast mode before the next request.
		h.state.tiers = {};
		h.state.ticks[0]?.();
		h.state.tiers = { anthropic: "priority" };
		h.state.ticks[0]?.();
		expect(rows()[0]).toStartWith(" Opus 5.5 \ue0b0 high·fast \ue0b0 ");
	});

	test("models without reasoning show no effort", async () => {
		const h = fakeOmp(plainDir());
		await ompStatusline(h.pi, h.host);
		await h.emit("session_start", {}, h.ctx({ model: { ...OPUS, reasoning: false } }));
		expect(draw(h.widgets[0]?.content)[0]).toStartWith(" Opus 5.5 \ue0b0 ");
		expect(draw(h.widgets[0]?.content)[0]).not.toContain("high");
	});
});

describe("context", () => {
	test("context usage is read when the conversation changes, not on every tick", async () => {
		const { h, c } = await started();
		for (let i = 0; i < 5; i++) h.state.ticks[0]?.();
		expect(h.state.contextReads).toBe(1);
		await h.emit("message_end", { message: { role: "toolResult" } }, c);
		h.state.ticks[0]?.();
		expect(h.state.contextReads).toBe(2);
		await h.emit("message_end", { message: { role: "user" } }, h.ctx({ model: { ...OPUS, id: "claude-sonnet-5-5" } }));
		expect(h.state.contextReads).toBe(3);
		for (const event of ["turn_start", "session_compact", "auto_compaction_end"]) await h.emit(event, {}, c);
		expect(h.state.contextReads).toBe(6);
	});

	test("right after compaction omp has no percentage, and the gauge is left out", async () => {
		const { h, c, rows } = await started();
		expect(rows()).toHaveLength(2);
		h.state.context = { tokens: 0, contextWindow: 1_000_000, percent: null };
		await h.emit("session_compact", {}, c);
		expect(rows()).toHaveLength(1);
		h.state.context = { tokens: 40_000, contextWindow: 1_000_000, percent: 4 };
		await h.emit("message_end", { message: { role: "user" } }, c);
		expect(rows()[1]).toStartWith("ctx ");
	});
});

describe("usage limits", () => {
	const report: UsageReport = {
		provider: "anthropic",
		limits: [
			{ scope: { windowId: "5h" }, amount: { usedFraction: 0.41 }, window: { resetsAt: Date.now() + 4_320_000 } },
			{ scope: { windowId: "7d" }, amount: { usedFraction: 0.18 }, window: { resetsAt: Date.now() + 280_000_000 } },
		],
	};

	function withUsage(h: ReturnType<typeof fakeOmp>) {
		const calls = { reports: 0 };
		const c = h.ctx();
		c.modelRegistry = {
			isUsingOAuth: () => true,
			authStorage: {
				usage: {
					reports: async () => {
						calls.reports++;
						return [report];
					},
				},
			},
		};
		return { c, calls };
	}

	test("the active provider's windows join the second row once the reports arrive", async () => {
		const h = fakeOmp(plainDir());
		await ompStatusline(h.pi, h.host);
		const { c } = withUsage(h);
		await h.emit("session_start", {}, c);
		await waitFor(() => (draw(h.widgets[0]?.content)[1] ?? "").includes("5h"), "usage windows");
		const row2 = draw(h.widgets[0]?.content)[1] ?? "";
		expect(row2).toContain("5h ");
		expect(row2).toContain("41%");
		expect(row2).toContain("7d ");
	});

	test("reports are fetched once per minimum gap, however many events arrive", async () => {
		const h = fakeOmp(plainDir());
		await ompStatusline(h.pi, h.host);
		const { c, calls } = withUsage(h);
		const start = Date.now();
		setSystemTime(start);
		await h.emit("session_start", {}, c);
		await waitFor(() => calls.reports === 1, "first fetch");
		for (let i = 0; i < 5; i++) h.state.ticks[0]?.();
		await h.emit("agent_end", {}, c);
		await Bun.sleep(10);
		expect(calls.reports).toBe(1);
		setSystemTime(start + 61_000);
		await h.emit("agent_end", {}, c);
		await waitFor(() => calls.reports === 2, "refetch after the gap");
		// Without an invalidation the value is kept until it ages (5 minutes).
		setSystemTime(start + 200_000);
		h.state.ticks[0]?.();
		await Bun.sleep(10);
		expect(calls.reports).toBe(2);
		setSystemTime(start + 400_000);
		h.state.ticks[0]?.();
		await waitFor(() => calls.reports === 3, "refetch after aging");
	});

	test("a failing usage service leaves the row without windows", async () => {
		const h = fakeOmp(plainDir());
		await ompStatusline(h.pi, h.host);
		const c = h.ctx();
		c.modelRegistry = {
			authStorage: {
				usage: {
					reports: async () => {
						throw new Error("offline");
					},
				},
			},
		};
		await h.emit("session_start", {}, c);
		await Bun.sleep(10);
		expect(draw(h.widgets[0]?.content)[1]).toStartWith("ctx ");
		expect(draw(h.widgets[0]?.content)[1]).not.toContain("5h");
	});
});

describe("git", () => {
	test("the branch and working-tree changes appear once git answers; no repository, no chip", async () => {
		const bin = path.join(tmp, "bin");
		mkdirSync(bin);
		// Only git on PATH: gh/glab would be asked about the branch's pull request.
		symlinkSync(Bun.which("git") ?? "git", path.join(bin, "git"));
		process.env.PATH = bin;
		const repo = path.join(tmp, "repo");
		const git = (...args: string[]) => Bun.spawnSync([path.join(bin, "git"), ...args], { cwd: repo, stdout: "ignore", stderr: "ignore" });
		mkdirSync(repo);
		git("init", "-q", "-b", "trunk");
		git("config", "user.email", "t@example.com");
		git("config", "user.name", "t");
		git("config", "commit.gpgsign", "false");
		writeFileSync(path.join(repo, "a.txt"), "1\n2\n");
		git("add", "a.txt");
		git("commit", "-q", "-m", "init");
		writeFileSync(path.join(repo, "a.txt"), "1\nchanged\n3\n4\n");
		writeFileSync(path.join(repo, "new.txt"), "untracked\n");

		const h = fakeOmp(path.join(repo));
		await ompStatusline(h.pi, h.host);
		await h.emit("session_start", {}, h.ctx());
		await waitFor(() => (draw(h.widgets[0]?.content)[0] ?? "").includes("trunk"), "git state");
		const row1 = draw(h.widgets[0]?.content)[0] ?? "";
		expect(row1).toContain("repo");
		expect(row1).toContain("+3");
		expect(row1).toContain("\u22121");
		expect(row1).toContain("?1");
	});
});

describe("omp's own status bar", () => {
	const expected: [string, unknown][] = [
		["statusLine.preset", "custom"],
		["statusLine.leftSegments", ["vim", "mode", "collab", "stream"]],
		["statusLine.rightSegments", ["session_name"]],
	];

	test("keeps only what this one does not show, once per settings scope", async () => {
		const settings = {};
		const h = fakeOmp(plainDir(), settings);
		await ompStatusline(h.pi, h.host);
		await ompStatusline(h.pi, h.host);
		expect(h.overrides).toEqual(expected);
	});

	test("a reload brings a new settings scope, which is overridden again", async () => {
		const first = fakeOmp(plainDir(), {});
		await ompStatusline(first.pi, first.host);
		const reloaded = fakeOmp(plainDir(), {});
		await ompStatusline(reloaded.pi, reloaded.host);
		expect(first.overrides).toEqual(expected);
		expect(reloaded.overrides).toEqual(expected);
	});

	test("OMP_STATUSLINE_NATIVE=keep leaves it alone", async () => {
		process.env.OMP_STATUSLINE_NATIVE = "keep";
		const h = fakeOmp(plainDir());
		await ompStatusline(h.pi, h.host);
		expect(h.overrides).toEqual([]);
	});

	test("a settings API that throws, or is missing, does not stop the extension", async () => {
		const h = fakeOmp(plainDir(), {});
		h.host.lookupSetting = () => {
			throw new Error("unknown setting");
		};
		await ompStatusline(h.pi, h.host);
		await h.emit("session_start", {}, h.ctx());
		expect(h.widgets).toHaveLength(1);
	});
});

describe("host modules", () => {
	test("without the service-tier module there is no fast chip; the rest keeps working", async () => {
		const h = fakeOmp(plainDir(), {});
		await ompStatusline(h.pi, { lookupSetting: h.host.lookupSetting });
		await h.emit("session_start", {}, h.ctx());
		expect(h.overrides).toHaveLength(3);
		const [row1, row2] = draw(h.widgets[0]?.content);
		expect(row1).toStartWith(" Opus 5.5 \ue0b0 high \ue0b0 ");
		expect(row2).toStartWith("ctx ");
	});

	test("without the registry module omp's status bar is left alone; fast still works", async () => {
		const h = fakeOmp(plainDir(), {});
		await ompStatusline(h.pi, { serviceTierFamily: h.host.serviceTierFamily });
		await h.emit("session_start", {}, h.ctx());
		expect(h.overrides).toEqual([]);
		expect(draw(h.widgets[0]?.content)[0]).toContain("high·fast");
	});

	test("outside omp the host packages do not resolve, and the extension still loads", async () => {
		const h = fakeOmp(plainDir(), {});
		await ompStatusline(h.pi);
		await h.emit("session_start", {}, h.ctx());
		expect(h.overrides).toEqual([]);
		expect(draw(h.widgets[0]?.content)).toHaveLength(2);
	});
});
