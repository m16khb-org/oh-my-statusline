// Environment chips and the background reads behind them: ssh and venv from the environment
// alone, tmux and kubectl through an injected runner, the Ambient pollers on a fake clock.

import { describe, expect, test } from "bun:test";
import { type Config, DEFAULT_CONFIG } from "../../src/application/config.ts";
import type { PrPort } from "../../src/application/ports.ts";
import type { PrState } from "../../src/domain/model/snapshot.ts";
import { Ambient, type AmbientOptions } from "../../src/infrastructure/ambient.ts";
import { buildEnvChips, EnvAdapter, sshChip, tmuxTarget, venvChip } from "../../src/infrastructure/env-chips.ts";
import type { CommandRunner } from "../../src/infrastructure/process.ts";

const clock = { ms: 1_000_000, now() { return this.ms; } };
const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

/** A runner that answers by command name and records every argv. */
function runner(answers: Record<string, string | null>) {
	const calls: string[][] = [];
	const exec: CommandRunner = async (cmd) => {
		calls.push(cmd);
		return answers[cmd[0] ?? ""] ?? null;
	};
	return { exec, calls };
}

describe("ssh", () => {
	test("short hostname when SSH_CONNECTION is set, nothing otherwise", () => {
		expect(sshChip({ SSH_CONNECTION: "1.2.3.4 5 6.7.8.9 22" }, () => "dev-box.example.com")).toBe("dev-box");
		expect(sshChip({}, () => "dev-box")).toBeNull();
		expect(sshChip({ SSH_CONNECTION: "" }, () => "dev-box")).toBeNull();
	});
});

describe("venv", () => {
	test("basename of VIRTUAL_ENV, else CONDA_DEFAULT_ENV", () => {
		expect(venvChip({ VIRTUAL_ENV: "/home/me/proj/.venv" })).toBe(".venv");
		expect(venvChip({ VIRTUAL_ENV: "/home/me/proj/.venv/" })).toBe(".venv");
		expect(venvChip({ CONDA_DEFAULT_ENV: "ml" })).toBe("ml");
		expect(venvChip({ VIRTUAL_ENV: "/x/venv", CONDA_DEFAULT_ENV: "ml" })).toBe("venv");
	});

	test("conda's base is skipped, nothing set gives null", () => {
		expect(venvChip({ CONDA_DEFAULT_ENV: "base" })).toBeNull();
		expect(venvChip({})).toBeNull();
	});
});

describe("tmux", () => {
	test("the target comes from TMUX and TMUX_PANE", () => {
		expect(tmuxTarget({})).toBeNull();
		expect(tmuxTarget({ TMUX: "/tmp/tmux-501/default,1234,3", TMUX_PANE: "%7" })).toEqual({ socket: "/tmp/tmux-501/default", target: "%7" });
		expect(tmuxTarget({ TMUX: "/tmp/tmux-501/default,1234,3" })).toEqual({ socket: "/tmp/tmux-501/default", target: "$3" });
		expect(tmuxTarget({ TMUX: "/tmp/a,b/sock,1234,0" })?.socket).toBe("/tmp/a,b/sock");
	});

	test("session:window from `tmux display-message`, addressed to the outer socket and pane", async () => {
		const { exec, calls } = runner({ tmux: "work:editor\n" });
		const label = await new EnvAdapter({ exec }).tmux({ socket: "/tmp/outer", target: "%7" });
		expect(label).toBe("work:editor");
		expect(calls).toEqual([["tmux", "-S", "/tmp/outer", "display-message", "-p", "-t", "%7", "#S:#W"]]);
	});

	test("a missing server or binary omits the chip", async () => {
		expect(await new EnvAdapter({ exec: runner({}).exec }).tmux({ socket: null, target: null })).toBeNull();
		expect(await new EnvAdapter({ exec: runner({ tmux: "\n" }).exec }).tmux({ socket: null, target: null })).toBeNull();
	});
});

describe("k8s", () => {
	test("kubectl's current context", async () => {
		const { exec, calls } = runner({ kubectl: "prod-eu\n" });
		expect(await new EnvAdapter({ exec, which: () => "/bin/kubectl" }).k8s()).toBe("prod-eu");
		expect(calls).toEqual([["kubectl", "config", "current-context"]]);
	});

	test("kubectl without a current context omits the chip without a warning", async () => {
		const warnings: string[] = [];
		const adapter = new EnvAdapter({ exec: runner({}).exec, which: () => "/bin/kubectl", warn: (m) => warnings.push(m) });
		expect(await adapter.k8s()).toBeNull();
		expect(warnings).toEqual([]);
	});

	test("kubectl missing: the chip is omitted, nothing is run, and exactly one warning is written", async () => {
		const { exec, calls } = runner({ kubectl: "prod" });
		const warnings: string[] = [];
		const adapter = new EnvAdapter({ exec, which: () => null, warn: (m) => warnings.push(m) });
		for (let i = 0; i < 4; i++) expect(await adapter.k8s()).toBeNull();
		expect(adapter.hasKubectl()).toBe(false);
		expect(calls).toEqual([]);
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toContain("kubectl");
	});
});

describe("buildEnvChips", () => {
	const adapter = new EnvAdapter({ hostname: () => "box.local" });
	const env = { SSH_CONNECTION: "a b c d", VIRTUAL_ENV: "/p/.venv" };
	const dynamic = { tmux: "s:w", k8s: "ctx" };

	test("defaults: ssh, tmux and venv on, k8s off", () => {
		expect(buildEnvChips(DEFAULT_CONFIG.chips, env, adapter, dynamic)).toEqual({ ssh: "box", tmux: "s:w", venv: ".venv", k8s: null });
	});

	test("each switch turns its chip off", () => {
		const off = { ssh: false, tmux: false, venv: false, k8s: true };
		expect(buildEnvChips(off, env, adapter, dynamic)).toEqual({ ssh: null, tmux: null, venv: null, k8s: "ctx" });
	});
});

describe("Ambient", () => {
	const env = { TMUX: "/tmp/outer,99,1", TMUX_PANE: "%3", SSH_CONNECTION: "a b c d" };
	const make = (over: Omit<Partial<AmbientOptions>, "config"> & { answers?: Record<string, string | null>; config?: Partial<Config> } = {}) => {
		const { answers = {}, config, ...options } = over;
		const { exec, calls } = runner(answers);
		const warnings: string[] = [];
		const adapter = new EnvAdapter({ exec, which: (bin) => (answers[bin] !== undefined ? `/bin/${bin}` : null), warn: (m) => warnings.push(m), hostname: () => "box" });
		const ambient = new Ambient({ clock, env, adapter, config: { ...DEFAULT_CONFIG, ...config }, ...options });
		return { ambient, calls, warnings };
	};

	test("tmux is read in the background, cached for 5 s, and shown", async () => {
		const { ambient, calls } = make({ answers: { tmux: "work:editor" } });
		ambient.poll(() => {});
		expect(ambient.read().env.tmux).toBeNull();
		await settle();
		expect(ambient.read().env).toEqual({ ssh: "box", tmux: "work:editor", venv: null, k8s: null });
		ambient.poll(() => {});
		clock.ms += 4_999;
		ambient.poll(() => {});
		await settle();
		expect(calls).toHaveLength(1);
		clock.ms += 2;
		ambient.poll(() => {});
		await settle();
		expect(calls).toHaveLength(2);
	});

	test("the tmux recorded at launch shows until the first poll lands; a vanished server then omits it", async () => {
		const { ambient } = make({ initialTmux: "outer:shell", answers: {} });
		expect(ambient.read().env.tmux).toBe("outer:shell");
		ambient.poll(() => {});
		await settle();
		expect(ambient.read().env.tmux).toBeNull();
	});

	test("an explicit null tmux (Codex launched outside tmux) never asks tmux, whatever the environment says", async () => {
		const { ambient, calls } = make({ tmux: null, answers: { tmux: "private:codex" } });
		ambient.poll(() => {});
		await settle();
		expect(calls).toEqual([]);
		expect(ambient.read().env.tmux).toBeNull();
	});

	test("Codex's private tmux is never shown: the outer target is the one queried", async () => {
		const { ambient, calls } = make({ tmux: tmuxTarget({ TMUX: "/tmp/outer,1,2", TMUX_PANE: "%9" }), answers: { tmux: "outer:win" } });
		ambient.poll(() => {});
		await settle();
		expect(calls[0]).toEqual(["tmux", "-S", "/tmp/outer", "display-message", "-p", "-t", "%9", "#S:#W"]);
	});

	test("k8s is off by default and cached for 60 s when on", async () => {
		const off = make({ answers: { kubectl: "prod" } });
		off.ambient.poll(() => {});
		await settle();
		expect(off.calls.filter((c) => c[0] === "kubectl")).toEqual([]);

		const on = make({ answers: { kubectl: "prod" }, config: { chips: { ...DEFAULT_CONFIG.chips, k8s: true } } });
		on.ambient.poll(() => {});
		await settle();
		expect(on.ambient.read().env.k8s).toBe("prod");
		clock.ms += 59_999;
		on.ambient.poll(() => {});
		await settle();
		expect(on.calls.filter((c) => c[0] === "kubectl")).toHaveLength(1);
		clock.ms += 2;
		on.ambient.poll(() => {});
		await settle();
		expect(on.calls.filter((c) => c[0] === "kubectl")).toHaveLength(2);
	});

	test("k8s on but kubectl missing: chip omitted and one warning however often it polls", async () => {
		const { ambient, warnings } = make({ answers: {}, config: { chips: { ...DEFAULT_CONFIG.chips, k8s: true } } });
		for (let i = 0; i < 3; i++) {
			ambient.poll(() => {});
			await settle();
			clock.ms += 120_000;
		}
		expect(ambient.read().env.k8s).toBeNull();
		expect(warnings).toHaveLength(1);
	});

	const PR: PrState = { number: 9, url: "https://x/pull/9", state: "approved", kind: "pr" };
	const prPort = (result: PrState | null): PrPort & { reads: string[] } => ({
		reads: [],
		async read(cwd) {
			this.reads.push(cwd);
			return result;
		},
	});

	test("the pull request is read once per branch for 300 s, and only with pr.enabled", async () => {
		const pr = prPort(PR);
		const { ambient } = make({ pr });
		ambient.poll(() => {}, { cwd: "/repo", key: "/repo\0main" });
		await settle();
		expect(ambient.read().pr).toEqual(PR);
		clock.ms += 299_000;
		ambient.poll(() => {}, { cwd: "/repo", key: "/repo\0main" });
		await settle();
		expect(pr.reads).toHaveLength(1);
		clock.ms += 2_000;
		ambient.poll(() => {}, { cwd: "/repo", key: "/repo\0main" });
		await settle();
		expect(pr.reads).toHaveLength(2);

		const off = prPort(PR);
		const disabled = make({ pr: off, config: { pr: { enabled: false } } });
		disabled.ambient.poll(() => {}, { cwd: "/repo", key: "k" });
		await settle();
		expect(off.reads).toEqual([]);
		expect(disabled.ambient.read().pr).toBeNull();
	});

	test("gh missing or failing: no PR chip", async () => {
		const missing = make({ pr: prPort(null) });
		missing.ambient.poll(() => {}, { cwd: "/repo", key: "k" });
		await settle();
		expect(missing.ambient.read().pr).toBeNull();
	});

	test("today's cost: only with stats.chip, in the background, cached; null omits it", async () => {
		let reads = 0;
		const todayCost = async () => {
			reads++;
			return 12.34;
		};
		const off = make({ todayCost });
		off.ambient.poll(() => {});
		await settle();
		expect(reads).toBe(0);
		expect(off.ambient.read().todayCostUsd).toBeNull();

		const on = make({ todayCost, config: { stats: { chip: true } } });
		on.ambient.poll(() => {});
		expect(reads).toBe(0);
		await settle();
		expect(on.ambient.read().todayCostUsd).toBe(12.34);
		clock.ms += 119_000;
		on.ambient.poll(() => {});
		await settle();
		expect(reads).toBe(1);
		clock.ms += 2_000;
		on.ambient.poll(() => {});
		await settle();
		expect(reads).toBe(2);

		const none = make({ todayCost: async () => null, config: { stats: { chip: true } } });
		none.ambient.poll(() => {});
		await settle();
		expect(none.ambient.read().todayCostUsd).toBeNull();
	});
});
