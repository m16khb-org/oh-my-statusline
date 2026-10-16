// Ported from codex-statusline/test/test_lifecycle.py (2 tests): real tmux with an inert fake
// Codex, no Codex account. The run directory lives under a TMPDIR whose name has a space, `#`,
// quote and `$`, which also proves every path in the tmux config is quoted.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const LAUNCHER = path.resolve(import.meta.dir, "../../../src/harnesses/codex/launcher.ts");
const hasTmux = Boolean(Bun.which("tmux"));

let temp: string;
beforeEach(() => {
	temp = mkdtempSync("/tmp/oms lc #'$");
});
afterEach(() => rmSync(temp, { recursive: true, force: true }));

const runDirs = () => readdirSync(temp).filter((name) => name.startsWith("codex-statusline-"));

async function until(condition: () => boolean, ms = 10_000): Promise<boolean> {
	for (let waited = 0; waited < ms; waited += 50) {
		if (condition()) return true;
		await Bun.sleep(50);
	}
	return condition();
}

function start(body: string) {
	const fake = path.join(temp, "codex");
	// Records what the launcher gave Codex, so the test can check its arguments and environment.
	writeFileSync(fake, `#!/bin/sh\n{ printf '%s\\n' "$CODEX_STATUSLINE_ACTIVE" "$@"; } > "$(dirname "$0")/args"\n${body}`);
	chmodSync(fake, 0o755);
	let output = "";
	const proc = Bun.spawn([process.execPath, LAUNCHER, "--model", "gpt-6-astra"], {
		cwd: temp,
		env: { ...process.env, TERM: "xterm-256color", CODEX_STATUSLINE_CODEX: fake, CODEX_HOME: temp, TMPDIR: temp, CODEX_STATUSLINE_ACTIVE: undefined, CODEX_STATUSLINE_DISABLE: undefined, TMUX: undefined },
		terminal: { cols: 120, rows: 30, data: (_terminal, chunk) => void (output += Buffer.from(chunk).toString()) },
	});
	return { proc, output: () => output };
}

describe.skipIf(!hasTmux)("with real tmux", () => {
	// test_terminal_termination_cleans_private_session
	test("terminating the launcher stops the session and removes the socket and runtime directory", async () => {
		const { proc, output } = start("while :; do sleep 1; done\n");
		expect(await until(() => runDirs().length === 1 && existsSync(path.join(temp, runDirs()[0] ?? "", "tmux.sock")))).toBe(true);
		const run = path.join(temp, runDirs()[0] ?? "");
		// The collector draws both rows into the status area (its text reaches the attached terminal).
		expect(await until(() => output().includes("ctx") && output().includes("7d"))).toBe(true);
		expect(readFileSync(path.join(run, "row1"), "utf8")).toContain("ctx");
		expect(await until(() => existsSync(path.join(temp, "args")))).toBe(true);
		expect(readFileSync(path.join(temp, "args"), "utf8").split("\n")).toEqual([
			"1", "-c", 'tui.terminal_title=["thread-id"]', "-c", "tui.status_line=[]", "--model", "gpt-6-astra", "",
		]);
		const socket = path.join(run, "tmux.sock");
		proc.kill("SIGTERM");
		expect(await proc.exited).toBe(130);
		expect(existsSync(run)).toBe(false);
		expect(Bun.spawnSync(["tmux", "-S", socket, "has-session"], { stdout: "ignore", stderr: "ignore" }).exitCode).not.toBe(0);
	}, 30_000);

	// test_normal_exit_preserves_cli_status_and_cleans_private_session
	test("a normal exit keeps Codex's exit code and cleans the private session", async () => {
		const { proc } = start("sleep 2\nexit 17\n");
		expect(await until(() => runDirs().length === 1)).toBe(true);
		const socket = path.join(temp, runDirs()[0] ?? "", "tmux.sock");
		expect(await proc.exited).toBe(17);
		expect(runDirs()).toEqual([]);
		expect(Bun.spawnSync(["tmux", "-S", socket, "has-session"], { stdout: "ignore", stderr: "ignore" }).exitCode).not.toBe(0);
	}, 30_000);
});
