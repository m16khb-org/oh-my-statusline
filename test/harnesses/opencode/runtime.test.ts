// Ported from opencode-statusline test/render.test.ts › text metrics (the plugin's own cell width,
// used when the host is not Bun), plus the node:child_process command runner.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { cellWidth, nodeRunner, nodeWhich, textWidth } from "../../../src/harnesses/opencode/runtime.ts";

describe("text metrics", () => {
	test("counts wide characters as two cells and combining marks as none", () => {
		expect(cellWidth("abc")).toBe(3);
		expect(cellWidth("한글")).toBe(4);
		expect(cellWidth("e\u0301")).toBe(1);
		expect(cellWidth("\ue0b0")).toBe(1);
	});

	test("the measure is Bun.stringWidth under Bun, and agrees with the fallback on the glyphs the line draws", () => {
		const measure = textWidth();
		expect(measure).toBe(Bun.stringWidth);
		for (const text of ["abc", "한글", "\ue0b0", "\ue0a0 main", "◈ 2 ⌘ 1", "−12"]) expect(measure(text)).toBe(cellWidth(text));
	});
});

describe("nodeRunner", () => {
	let dir: string;
	beforeEach(() => {
		dir = realpathSync(mkdtempSync(`${tmpdir()}/oms-opencode-runner-`));
	});
	afterEach(() => rmSync(dir, { recursive: true, force: true }));

	const script = (code: string) => [process.execPath, "-e", code];

	test("returns stdout when the command exits 0, in the given directory", async () => {
		expect(await nodeRunner(script("process.stdout.write(process.cwd())"), { cwd: dir })).toBe(dir);
	});

	test("returns null for a non-zero exit, a missing binary and an empty command", async () => {
		expect(await nodeRunner(script("process.exit(3)"))).toBeNull();
		expect(await nodeRunner(["oms-no-such-binary-here"])).toBeNull();
		expect(await nodeRunner([])).toBeNull();
	});

	test("returns null when the command outlives its timeout", async () => {
		// A real child process against the real kill timeout: fake timers cannot stand in for it.
		expect(await nodeRunner(script("setTimeout(() => {}, 10000)"), { timeoutMs: 200 })).toBeNull();
	});

	test("feeds stdin", async () => {
		const echo = script("process.stdin.on('data', (chunk) => process.stdout.write(String(chunk).toUpperCase()))");
		expect(await nodeRunner(echo, { stdin: "abc" })).toBe("ABC");
	});
});

describe("nodeWhich (Bun.which is not available under the Node loader)", () => {
	test("finds an executable on the given PATH and null on an empty one", () => {
		const sh = Bun.which("sh");
		expect(sh).not.toBeNull();
		const dir = sh?.slice(0, sh.lastIndexOf("/")) ?? "";
		expect(nodeWhich("sh", dir)).toBe(`${dir}/sh`);
		expect(nodeWhich("definitely-not-a-binary", dir)).toBeNull();
		expect(nodeWhich("gh", "")).toBeNull();
		expect(nodeWhich("gh", "/nonexistent-dir")).toBeNull();
	});

	test("gh missing from PATH: the PR adapter reads nothing, so OpenCode draws no PR chip", async () => {
		const { PrAdapter } = await import("../../../src/infrastructure/pr.ts");
		const calls: string[][] = [];
		const exec = async (cmd: string[]) => (calls.push(cmd), cmd[0] === "git" ? "git@github.com:o/r.git" : "{}");
		expect(await new PrAdapter(exec, (bin) => nodeWhich(bin, "/nonexistent-dir")).read("/r")).toBeNull();
		expect(calls.map((c) => c[0])).toEqual(["git"]);
	});
});

describe("OpenCode ambient (TUI host)", () => {
	const env = (extra: Record<string, string> = {}) => ({ XDG_CONFIG_HOME: "/nonexistent-config", PATH: "/nonexistent-dir", ...extra });

	test("today's cost goes through the injected runner (child process), never the in-process collector", async () => {
		const { createAmbient } = await import("../../../src/harnesses/opencode/ambient.ts");
		const calls: string[][] = [];
		const ambient = createAmbient({ ...env(), HOME: "/nonexistent-home" }, async (cmd) => (calls.push(cmd), cmd.at(-1)?.endsWith("today-cost.ts") ? "7.5\n" : null));
		// The stats chip is off by default: nothing runs.
		ambient.poll(() => {});
		await new Promise((resolve) => setTimeout(resolve, 10));
		expect(calls).toEqual([]);
		const on = new (await import("../../../src/infrastructure/ambient.ts")).Ambient({ ...ambient.options, config: { ...ambient.options.config, stats: { chip: true } }, todayCost: ambient.options.todayCost, tmux: null });
		// bun is not on the fake PATH, and the test runs under bun itself: findBun falls back to execPath.
		on.poll(() => {});
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(calls.some((c) => c.at(-1)?.endsWith("src/cli/today-cost.ts"))).toBe(true);
		expect(on.read().todayCostUsd).toBe(7.5);
	});

	test("kubectl missing with k8s on writes nothing to stderr", async () => {
		const { createAmbient } = await import("../../../src/harnesses/opencode/ambient.ts");
		const { Ambient } = await import("../../../src/infrastructure/ambient.ts");
		const base = createAmbient(env(), async () => null);
		const ambient = new Ambient({ ...base.options, config: { ...base.options.config, chips: { ...base.options.config.chips, k8s: true } } });
		const writes: unknown[] = [];
		const original = process.stderr.write;
		process.stderr.write = ((chunk: unknown) => (writes.push(chunk), true)) as typeof process.stderr.write;
		try {
			ambient.poll(() => {});
			await new Promise((resolve) => setTimeout(resolve, 10));
		} finally {
			process.stderr.write = original;
		}
		expect(writes).toEqual([]);
		expect(ambient.read().env.k8s).toBeNull();
	});
});
