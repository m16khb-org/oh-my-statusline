// omp's environment chips, pull request switch and today's cost, read in the background by the
// shared Ambient pollers: environment variables of the omp process and config.toml.

import { afterEach, beforeEach, describe, expect, setSystemTime, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { CommandRunner } from "../../../src/infrastructure/process.ts";
import ompStatusline from "../../../src/harnesses/omp/main.ts";
import { makeHome, NOW } from "../../stats/helpers.ts";
import { draw, fakeOmp } from "./fake-omp.ts";

const KEYS = ["XDG_CONFIG_HOME", "STATUSLINE_GLYPHS", "STATUSLINE_COLORS", "STATUSLINE_THEME", "SSH_CONNECTION", "TMUX", "TMUX_PANE", "VIRTUAL_ENV", "CONDA_DEFAULT_ENV", "HOME", "XDG_CACHE_HOME", "TZ", "PATH"];
let saved: Record<string, string | undefined>;
let tmp: string;

beforeEach(() => {
	saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
	tmp = mkdtempSync(path.join(tmpdir(), "omp-chips-test-"));
	process.env.XDG_CONFIG_HOME = path.join(tmp, "config");
	process.env.STATUSLINE_GLYPHS = "plain";
	process.env.STATUSLINE_COLORS = "truecolor";
	process.env.STATUSLINE_THEME = "dark";
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

const config = (toml: string) => {
	mkdirSync(path.join(tmp, "config", "oh-my-statusline"), { recursive: true });
	writeFileSync(path.join(tmp, "config", "oh-my-statusline", "config.toml"), toml);
};

async function rows(runner?: CommandRunner) {
	const dir = path.join(tmp, "plain");
	mkdirSync(dir, { recursive: true });
	const h = fakeOmp(dir);
	await ompStatusline(h.pi, h.host, runner);
	await h.emit("session_start", {}, h.ctx());
	const read = async () => {
		// The pollers land in the background; the one-second tick redraws.
		for (let i = 0; i < 100; i++) await Bun.sleep(5);
		for (const tick of h.state.ticks) tick();
		return draw(h.widgets[0]?.content, 200)[0] ?? "";
	};
	return { read };
}

describe("omp chips", () => {
	test("ssh and venv come from the omp process environment", async () => {
		process.env.SSH_CONNECTION = "1.2.3.4 5 6.7.8.9 22";
		process.env.VIRTUAL_ENV = "/home/me/app/.venv";
		const row = await (await rows()).read();
		expect(row).toMatch(/ssh \S+/);
		expect(row).toContain("venv .venv");
	});

	test("the config file turns a chip off", async () => {
		process.env.SSH_CONNECTION = "1.2.3.4 5 6.7.8.9 22";
		process.env.VIRTUAL_ENV = "/home/me/app/.venv";
		config("[chips]\nssh = false\n");
		const row = await (await rows()).read();
		expect(row).not.toContain("ssh");
		expect(row).toContain("venv .venv");
	});

	test("a shell outside ssh/tmux/venv has no environment chips", async () => {
		const row = await (await rows()).read();
		for (const name of ["ssh", "tmux", "venv", "k8s", "Σ"]) expect(row).not.toContain(name);
	});

	test("stats.chip shows today's cost, computed in the background from the session storage", async () => {
		const home = makeHome("UTC");
		try {
			process.env.HOME = home.home;
			process.env.XDG_CACHE_HOME = home.env.XDG_CACHE_HOME;
			process.env.TZ = "UTC";
			config("[stats]\nchip = true\n");
			setSystemTime(new Date(NOW));
			const row = await (await rows()).read();
			expect(row).toMatch(/Σ \$\d+\.\d\d/);
		} finally {
			home.cleanup();
		}
	});

	test("today's cost runs out of process: the injected runner is called with the today-cost script, not the in-process collector", async () => {
		// An empty HOME: were the collector run in-process, there would be no cost at all.
		process.env.HOME = path.join(tmp, "empty-home");
		process.env.XDG_CACHE_HOME = path.join(tmp, "cache");
		config("[stats]\nchip = true\n");
		const calls: string[][] = [];
		const runner: CommandRunner = async (cmd) => {
			calls.push(cmd);
			return cmd.at(-1)?.endsWith("today-cost.ts") ? "12.5\n" : null;
		};
		const row = await (await rows(runner)).read();
		expect(row).toContain("Σ $12.50");
		const call = calls.find((c) => c.at(-1)?.endsWith("src/cli/today-cost.ts"));
		expect(call).toBeDefined();
		expect(call?.[0]).toMatch(/bun/);
	});

	test("kubectl missing with k8s on: omitted, and nothing is written to stderr", async () => {
		process.env.PATH = path.join(tmp, "no-bin");
		config("[chips]\nk8s = true\n");
		const writes: unknown[] = [];
		const original = process.stderr.write;
		process.stderr.write = ((chunk: unknown) => (writes.push(chunk), true)) as typeof process.stderr.write;
		try {
			const row = await (await rows(async () => null)).read();
			expect(row).not.toContain("k8s");
		} finally {
			process.stderr.write = original;
		}
		expect(writes).toEqual([]);
	});
});
