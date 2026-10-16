// Ported from opencode-statusline test/render.test.ts › text metrics (the plugin's own cell width,
// used when the host is not Bun), plus the node:child_process command runner.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { cellWidth, nodeRunner, textWidth } from "../../../src/harnesses/opencode/runtime.ts";

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
