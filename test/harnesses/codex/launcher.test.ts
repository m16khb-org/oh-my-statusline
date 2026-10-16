// The launcher as a process: pass-through to the real Codex, and the errors that stop a launch.

import { afterEach, beforeEach, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const LAUNCHER = path.resolve(import.meta.dir, "../../../src/harnesses/codex/launcher.ts");

let temp: string;
let fake: string;
beforeEach(() => {
	temp = mkdtempSync(path.join(tmpdir(), "oms-launcher-"));
	fake = path.join(temp, "codex real");
	writeFileSync(fake, '#!/bin/sh\nprintf "%s\\n" "$@"\n[ -z "$FAKE_EXIT" ] || exit "$FAKE_EXIT"\n');
	chmodSync(fake, 0o755);
});
afterEach(() => rmSync(temp, { recursive: true, force: true }));

function launcher(args: string[], env: Record<string, string | undefined> = {}) {
	const proc = Bun.spawnSync([process.execPath, LAUNCHER, ...args], {
		env: { ...process.env, CODEX_STATUSLINE_CODEX: fake, CODEX_STATUSLINE_ACTIVE: undefined, CODEX_STATUSLINE_DISABLE: undefined, ...env },
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
	});
	return { code: proc.exitCode, stdout: proc.stdout.toString(), stderr: proc.stderr.toString() };
}

test("--help, subcommands and non-terminal runs reach the real Codex untouched, with its exit code", () => {
	const help = launcher(["--help"]);
	expect(help).toMatchObject({ code: 0, stdout: "--help\n" });
	const exec = launcher(["exec", "a b", "literal $HOME; 'q'"], { FAKE_EXIT: "5" });
	expect(exec.code).toBe(5);
	expect(exec.stdout).toBe("exec\na b\nliteral $HOME; 'q'\n");
	// No terminal on stdin: even a bare invocation is passed through.
	expect(launcher([]).code).toBe(0);
	expect(readdirSync(temp)).toEqual(["codex real"]);
});

test("DISABLE and ACTIVE pass through", () => {
	expect(launcher(["hello"], { CODEX_STATUSLINE_DISABLE: "1" }).stdout).toBe("hello\n");
	expect(launcher(["hello"], { CODEX_STATUSLINE_ACTIVE: "1" }).stdout).toBe("hello\n");
});

test("a missing Codex is one clear error line and a non-zero exit", () => {
	const run = launcher(["--help"], { CODEX_STATUSLINE_CODEX: path.join(temp, "nope") });
	expect(run.code).toBe(1);
	expect(run.stderr.trim().split("\n")).toEqual(["Codex CLI not found. Install it first or set CODEX_STATUSLINE_CODEX to its executable."]);
});

test("a launch without tmux is one clear error line, exits non-zero, and leaves no runtime directory", async () => {
	let output = "";
	const proc = Bun.spawn([process.execPath, LAUNCHER], {
		env: { ...process.env, PATH: "/nonexistent", CODEX_STATUSLINE_CODEX: fake, CODEX_STATUSLINE_ACTIVE: undefined, CODEX_STATUSLINE_DISABLE: undefined, TMPDIR: temp },
		terminal: { cols: 100, rows: 30, data: (_terminal, chunk) => void (output += Buffer.from(chunk).toString()) },
	});
	expect(await proc.exited).toBe(1);
	expect(output.trim().split(/\r?\n/)).toHaveLength(1);
	expect(output).toContain("tmux not found");
	expect(readdirSync(temp)).toEqual(["codex real"]);
});
