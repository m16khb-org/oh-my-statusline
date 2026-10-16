// Ported from codex-statusline/test/test_install.py (5 tests), plus the checks the new installer adds:
// manifest contents, foreign install directory, missing tmux or Codex.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { install, uninstall } from "../../../src/harnesses/codex/install.ts";
import { sha256 } from "../../../src/infrastructure/install-kit.ts";

const SOURCE_ROOT = path.resolve(import.meta.dir, "../../..");

let temp: string;
let home: string;
let bin: string;
let data: string;
let real: string;
let env: Record<string, string | undefined>;
let logs: string[];

function script(file: string, body: string): void {
	writeFileSync(file, `#!/bin/sh\n${body}`);
	chmodSync(file, 0o755);
}

beforeEach(() => {
	temp = mkdtempSync(path.join(tmpdir(), "statusline test "));
	home = temp;
	bin = path.join(temp, "bin with spaces");
	data = path.join(temp, "share with spaces");
	real = path.join(temp, "original codex");
	script(real, 'printf "%s\\n" "$@"\n');
	// A stub tmux keeps these tests independent of the machine: the installer only checks it exists.
	const stubs = path.join(temp, "stubs");
	mkdirSync(stubs);
	script(path.join(stubs, "tmux"), "exit 0\n");
	logs = [];
	env = { ...process.env, HOME: home, XDG_DATA_HOME: data, PATH: `${stubs}:${process.env.PATH}`, CODEX_STATUSLINE_CODEX: undefined };
});
afterEach(() => rmSync(temp, { recursive: true, force: true }));

const opts = (over: Record<string, unknown> = {}) => ({
	home,
	env,
	sourceRoot: SOURCE_ROOT,
	plain: false,
	log: (line: string) => logs.push(line),
	binDir: bin,
	codex: real,
	...over,
});

const manifestFile = () => path.join(data, "oh-my-statusline", "codex", "install.json");

function runCommand(command: string, args: string[], extra: Record<string, string | undefined> = {}) {
	const proc = Bun.spawnSync([command, ...args], { env: { ...env, CODEX_STATUSLINE_DISABLE: "1", ...extra }, stdout: "pipe", stderr: "pipe" });
	return { code: proc.exitCode, stdout: proc.stdout.toString(), stderr: proc.stderr.toString() };
}

describe("install", () => {
	// test_installs_and_forwards_quoted_arguments_without_changing_original
	test("installs the wrapper, forwards quoted arguments, and leaves the original and its config alone", () => {
		const before = readFileSync(real);
		install(opts({ wrapCodex: true }));
		const run = runCommand(path.join(bin, "codex"), ["exec", "a b", "literal $HOME; 'quoted'"]);
		expect(run.code).toBe(0);
		expect(run.stdout.split("\n").filter(Boolean)).toEqual(["exec", "a b", "literal $HOME; 'quoted'"]);
		expect(readFileSync(real)).toEqual(before);
		expect(existsSync(path.join(home, ".codex", "config.toml"))).toBe(false);
		expect(runCommand(path.join(bin, "codex-plain"), ["x y"]).stdout).toBe("x y\n");
	});

	// test_herdr_pane_names_codex_agent_on_launcher
	test("a herdr pane names the codex agent on the launcher", () => {
		install(opts({ wrapCodex: true }));
		script(real, 'printf "%s\\n" "${HERDR_AGENT-unset}"\n');
		const base = { HERDR_PANE_ID: undefined, HERDR_AGENT: undefined };
		for (const [extra, expected] of [
			[{}, "unset"],
			[{ HERDR_PANE_ID: "w1:p1" }, "codex"],
			[{ HERDR_PANE_ID: "w1:p1", HERDR_AGENT: "custom" }, "custom"],
		] as const) {
			const run = runCommand(path.join(bin, "codex"), ["exec"], { ...base, ...extra });
			expect(run.code).toBe(0);
			expect(run.stdout.trim()).toBe(expected);
		}
	});

	// test_default_does_not_shadow_codex
	test("by default no codex wrapper is installed", () => {
		install(opts());
		expect(existsSync(path.join(bin, "codex-statusline"))).toBe(true);
		expect(existsSync(path.join(bin, "codex-plain"))).toBe(true);
		expect(existsSync(path.join(bin, "codex"))).toBe(false);
	});

	test("the manifest records the original, the glyph choice and the launcher checksums, and is private", () => {
		install(opts({ plain: true, wrapCodex: true }));
		const manifest = JSON.parse(readFileSync(manifestFile(), "utf8"));
		expect(manifest.codex).toBe(real);
		expect(manifest.glyphs).toBe("plain");
		expect(Object.keys(manifest.launchers).sort()).toEqual(["codex", "codex-plain", "codex-statusline"].map((name) => path.join(bin, name)));
		for (const [file, checksum] of Object.entries(manifest.launchers)) expect(sha256(file)).toBe(checksum as string);
		expect(statSync(manifestFile()).mode & 0o777).toBe(0o600);
		expect(statSync(path.join(bin, "codex-statusline")).mode & 0o777).toBe(0o755);
		expect(logs[0]).toBe(`Installed: ${path.join(bin, "codex-statusline")}`);
	});

	// test_existing_command_is_rejected_before_installation
	test("an existing command that is not ours is rejected before anything is installed", () => {
		mkdirSync(bin);
		const existing = path.join(bin, "codex");
		writeFileSync(existing, "user-owned");
		expect(() => install(opts({ wrapCodex: true }))).toThrow(`Refusing to replace existing command: ${existing}`);
		expect(readFileSync(existing, "utf8")).toBe("user-owned");
		expect(existsSync(manifestFile())).toBe(false);
		expect(existsSync(path.join(bin, "codex-statusline"))).toBe(false);
	});

	test("a directory that is not ours is not replaced, and no launcher is written", () => {
		const dest = path.join(data, "oh-my-statusline", "codex");
		mkdirSync(dest, { recursive: true });
		writeFileSync(path.join(dest, "keep.txt"), "mine");
		expect(() => install(opts())).toThrow(/not installed by oh-my-statusline/);
		expect(readFileSync(path.join(dest, "keep.txt"), "utf8")).toBe("mine");
		expect(existsSync(bin)).toBe(false);
	});

	test("tmux and Codex are required", () => {
		expect(() => install(opts({ env: { ...env, PATH: "/nonexistent" } }))).toThrow("tmux is required; install it with your package manager");
		expect(() => install(opts({ codex: path.join(temp, "missing") }))).toThrow(/Codex CLI not found/);
		expect(existsSync(bin)).toBe(false);
	});

	test("without --codex the first codex on PATH is used, skipping our own launchers", () => {
		const first = path.join(temp, "first");
		const second = path.join(temp, "second");
		mkdirSync(first);
		mkdirSync(second);
		script(path.join(first, "codex"), "# codex-statusline launcher\nexit 9\n");
		script(path.join(second, "codex"), "exit 0\n");
		install(opts({ codex: undefined, env: { ...env, PATH: `${first}:${second}:${env.PATH}` } }));
		expect(JSON.parse(readFileSync(manifestFile(), "utf8")).codex).toBe(path.join(second, "codex"));
	});
});

describe("reinstall and uninstall", () => {
	// test_reinstall_and_uninstall_preserve_user_replacement
	test("reinstall works; uninstall removes our launchers and keeps a command the user replaced", () => {
		install(opts({ wrapCodex: true }));
		install(opts({ wrapCodex: true }));
		const user = path.join(bin, "codex");
		writeFileSync(user, "#!/bin/sh\necho user replacement\n");
		logs.length = 0;
		uninstall(opts());
		expect(readFileSync(user, "utf8")).toContain("user replacement");
		expect(existsSync(path.join(bin, "codex-statusline"))).toBe(false);
		expect(existsSync(path.join(bin, "codex-plain"))).toBe(false);
		expect(logs).toContain(`Preserved modified launcher ${user}`);
		expect(logs).toContain(`Removed ${path.join(bin, "codex-plain")}`);
		expect(existsSync(path.join(data, "oh-my-statusline", "codex"))).toBe(false);
	});

	test("uninstall without an installation changes nothing", () => {
		mkdirSync(bin);
		writeFileSync(path.join(bin, "codex-plain"), "user");
		uninstall(opts());
		expect(readFileSync(path.join(bin, "codex-plain"), "utf8")).toBe("user");
	});
});
