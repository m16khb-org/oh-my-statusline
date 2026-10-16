// ./install.sh and ./uninstall.sh against a temp HOME: all four harnesses, migration from the four
// standalone projects, refusals, and --dry-run. Every run spawns the real CLI with a minimal
// environment (a temp HOME and a PATH of stubs), so the real home directories are never read or written.

import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { type Context, parseSelection, runCli as runCliInProcess, UsageError } from "../../src/cli/install-targets.ts";
import {
	changes,
	cleanWorlds,
	damaged,
	FOOTER,
	json,
	legacyAll,
	legacyClaude,
	legacyCodex,
	legacyOmp,
	legacyOpencode,
	makeWorld,
	readJson,
	ROOT,
	runCli,
	script,
	seedUser,
	snapshot,
	USER_STATUS,
	type World,
	write,
} from "./helpers.ts";

afterEach(cleanWorlds);

type Entry = { type?: string; command?: string; refreshInterval?: number };
type Settings = { statusLine?: Entry; subagentStatusLine?: Entry } & Record<string, unknown>;
type Cli = { plugins?: unknown[] } & Record<string, unknown>;

const PACKAGE = "./oh-my-statusline";
const OURS = "oh-my-statusline/src/harnesses/claude/main.ts";
const settingsFile = (w: World) => path.join(w.claude, "settings.json");
const cliFile = (w: World) => path.join(w.opencode, "cli.json");
const ext = (w: World) => path.join(w.agent, "extensions", "oh-my-statusline");
const codexDir = (w: World) => path.join(w.data, "oh-my-statusline", "codex");
const text = (file: string) => readFileSync(file, "utf8");
const ALL = (w: World) => ["all", "--codex", w.codex];
const backups = (dir: string, name: string) => readdirSync(dir).filter((entry) => entry.startsWith(`${name}.bak-`));

/** Everything the four installs leave behind that carries our name. */
const ours = (snap: Record<string, string>) => Object.keys(snap).filter((file) => file.includes("oh-my-statusline"));

describe("usage", () => {
	test("--help prints every target and option and exits 0, from both scripts", () => {
		const env = { PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin` };
		for (const name of ["install", "uninstall"]) {
			const proc = Bun.spawnSync(["/bin/sh", path.join(ROOT, `${name}.sh`), "--help"], { env, stdout: "pipe", stderr: "pipe" });
			const out = proc.stdout.toString();
			expect(proc.exitCode).toBe(0);
			expect(out).toContain(`./${name}.sh [claude] [codex] [omp] [opencode] [all] [options]`);
			for (const word of ["claude", "codex", "omp", "opencode", "all", "--plain", "--dry-run", "--agent-dir", "--config-dir", "--claude-dir", "--bin-dir", "--codex", "--wrap-codex", "--help"]) {
				expect(out).toContain(word);
			}
		}
		const install = Bun.spawnSync(["/bin/sh", path.join(ROOT, "install.sh"), "--help"], { env, stdout: "pipe" }).stdout.toString();
		for (const word of ["claude-code-statusline", "codex-statusline", "omp-statusline", "opencode-statusline", "plugins list", "--dry-run", "backed up"]) {
			expect(install.toLowerCase()).toContain(word.toLowerCase());
		}
	});

	test("an unknown option, an unknown target and a missing value exit 2 and write nothing", () => {
		const w = makeWorld();
		for (const args of [["--bogus"], ["claude", "--bogus"], ["nope"], ["omp", "--agent-dir"], ["omp", "--agent-dir", "--plain"], ["--plain=yes"]]) {
			const run = runCli(w, "install", args);
			expect([args, run.code]).toEqual([args, 2]);
			expect(run.err).toContain("--help");
		}
		expect(runCli(w, "uninstall", ["--bogus"]).code).toBe(2);
		expect(readdirSync(w.home)).toEqual([]);
	});

	test("no target and no terminal is a usage error", () => {
		const w = makeWorld();
		for (const mode of ["install", "uninstall"] as const) {
			const run = runCli(w, mode, ["--plain"]);
			expect(run.code).toBe(2);
			expect(run.err).toContain("No target given");
			expect(run.err).toContain("Usage:");
		}
		expect(readdirSync(w.home)).toEqual([]);
	});

	test("install.sh without bun on PATH prints how to install it and exits 1", () => {
		const w = makeWorld();
		// A PATH with `cat` and nothing else: no bun, whatever the machine has installed.
		const only = path.join(w.root, "only-cat");
		mkdirSync(only);
		symlinkSync(Bun.which("cat") ?? "/bin/cat", path.join(only, "cat"));
		for (const name of ["install", "uninstall"]) {
			const proc = Bun.spawnSync(["/bin/sh", path.join(ROOT, `${name}.sh`), "all"], { env: { PATH: only, HOME: w.home }, stdout: "pipe", stderr: "pipe" });
			expect(proc.exitCode).toBe(1);
			expect(proc.stderr.toString()).toContain("curl -fsSL https://bun.sh/install | bash");
			expect(proc.stderr.toString()).toContain("brew install oven-sh/bun/bun");
			expect(proc.stdout.toString()).toBe("");
		}
		expect(readdirSync(w.home)).toEqual([]);
	});

	test("the scripts hand over to bun and pass every argument along", () => {
		const w = makeWorld();
		const env = { ...w.env, PATH: `${path.dirname(process.execPath)}:${w.env.PATH}` };
		const proc = Bun.spawnSync(["/bin/sh", path.join(ROOT, "install.sh"), "--wrap-codex", "--bogus"], { env, stdout: "pipe", stderr: "pipe" });
		expect(proc.exitCode).toBe(2);
		expect(proc.stderr.toString()).toContain("unknown option: --bogus");
	});
});

describe("the checklist", () => {
	function context(w: World, answer: string | null): { ctx: Context; out: string[]; asked: string[] } {
		const out: string[] = [];
		const asked: string[] = [];
		const ctx: Context = {
			env: w.env,
			home: w.home,
			isTTY: true,
			sourceRoot: ROOT,
			out: (line) => out.push(line),
			err: (line) => out.push(line),
			ask: async (prompt) => {
				asked.push(prompt);
				return answer;
			},
		};
		return { ctx, out, asked };
	}

	test("Enter takes the harnesses found on this machine", async () => {
		const w = makeWorld();
		mkdirSync(w.agent, { recursive: true });
		const { ctx, out } = context(w, "");
		expect(await runCliInProcess("install", [], ctx)).toBe(0);
		expect(out).toContain("  3) [x] omp");
		expect(out).toContain("  1) [ ] claude");
		expect(existsSync(ext(w))).toBe(true);
		expect(existsSync(w.claude)).toBe(false);
		expect(existsSync(w.opencode)).toBe(false);
	});

	test("numbers and names pick harnesses, and q quits", async () => {
		const w = makeWorld();
		expect(await runCliInProcess("install", [], context(w, "q").ctx)).toBe(0);
		expect(readdirSync(w.home)).toEqual([]);
		expect(await runCliInProcess("install", ["--dry-run"], context(w, "1, opencode").ctx)).toBe(0);
		expect(readdirSync(w.home)).toEqual([]);
		expect(await runCliInProcess("install", [], context(w, "4 1").ctx)).toBe(0);
		expect(existsSync(path.join(w.claude, "oh-my-statusline"))).toBe(true);
		expect(existsSync(path.join(w.opencode, "oh-my-statusline"))).toBe(true);
		expect(existsSync(ext(w))).toBe(false);
	});

	test("uninstall marks what is installed here", async () => {
		const w = makeWorld();
		expect(runCli(w, "install", ["omp", "claude"]).code).toBe(0);
		const { ctx, out } = context(w, "");
		expect(await runCliInProcess("uninstall", [], ctx)).toBe(0);
		expect(out).toContain("  1) [x] claude");
		expect(out).toContain("  2) [ ] codex");
		expect(existsSync(ext(w))).toBe(false);
		expect(existsSync(path.join(w.claude, "oh-my-statusline"))).toBe(false);
	});

	test("selections parse: numbers, names, unique prefixes, all; nonsense is a usage error", () => {
		expect(parseSelection("", ["omp"])).toEqual(["omp"]);
		expect(parseSelection("4 2", [])).toEqual(["codex", "opencode"]);
		expect(parseSelection("cl, om", [])).toEqual(["claude", "omp"]);
		expect(parseSelection("a", [])).toEqual(["claude", "codex", "omp", "opencode"]);
		expect(parseSelection("CODEX", [])).toEqual(["codex"]);
		expect(() => parseSelection("c", [])).toThrow(UsageError);
		expect(() => parseSelection("9", [])).toThrow(UsageError);
	});
});

describe("all four harnesses", () => {
	test("install wires each one and uninstall puts every pre-existing file back byte for byte", () => {
		const w = makeWorld();
		seedUser(w);
		const before = snapshot(w.home);

		const run = runCli(w, "install", ALL(w));
		expect([run.code, run.err]).toEqual([0, ""]);
		for (const target of ["claude", "codex", "omp", "opencode"]) expect(run.out).toContain(`[${target}] `);
		expect(run.out).toContain("Installed: claude, codex, omp, opencode");

		const settings = readJson<Settings>(settingsFile(w));
		expect(settings.statusLine?.command).toContain(OURS);
		expect(settings.subagentStatusLine?.command).toContain(`${OURS}" --subagents`);
		expect(settings.model).toBe("opus");
		expect(readJson<Cli>(cliFile(w)).plugins).toEqual(["./herdr", { package: "other", options: { a: 1 } }, FOOTER, { package: PACKAGE, options: { glyphs: "powerline" } }]);
		expect(text(path.join(ext(w), "index.ts"))).toContain("harnesses/omp/main.ts");
		for (const dir of [path.join(w.claude, "oh-my-statusline"), codexDir(w), ext(w), path.join(w.opencode, "oh-my-statusline")]) {
			expect(existsSync(path.join(dir, ".oh-my-statusline"))).toBe(true);
		}
		for (const name of ["codex-statusline", "codex-plain"]) expect(text(path.join(w.bin, name))).toContain("# codex-statusline launcher");
		expect(existsSync(path.join(w.bin, "codex"))).toBe(false);
		expect(readJson<{ codex: string }>(path.join(codexDir(w), "install.json")).codex).toBe(w.codex);
		// the plugin entry a host loads, and the user's tool next to our launchers
		expect(text(path.join(w.bin, "my-tool"))).toContain("mine");

		const removed = runCli(w, "uninstall", ["all"]);
		expect([removed.code, removed.err]).toEqual([0, ""]);
		const after = snapshot(w.home);
		expect(damaged(before, after)).toEqual([]);
		expect(ours(after)).toEqual([]);
		expect(readdirSync(w.bin)).toEqual(["my-tool"]);
		expect(readdirSync(path.join(w.agent, "extensions"))).toEqual(["other.ts"]);
		// each edit left a backup of the file it replaced
		expect(backups(w.claude, "settings.json").length).toBeGreaterThanOrEqual(2);
		expect(backups(w.opencode, "cli.json").length).toBeGreaterThanOrEqual(2);
	});

	test("a reinstall is idempotent: no duplicate entries, the original settings stay saved", () => {
		const w = makeWorld();
		seedUser(w);
		const before = snapshot(w.home);
		expect(runCli(w, "install", ALL(w)).code).toBe(0);
		const once = { settings: readJson<Settings>(settingsFile(w)), cli: readJson<Cli>(cliFile(w)) };
		expect(runCli(w, "install", ALL(w)).code).toBe(0);
		expect(readJson<Settings>(settingsFile(w))).toEqual(once.settings);
		const plugins = readJson<Cli>(cliFile(w)).plugins ?? [];
		expect(plugins).toEqual(once.cli.plugins ?? []);
		expect(plugins.filter((plugin) => plugin === FOOTER)).toHaveLength(1);
		expect(plugins.filter((plugin) => JSON.stringify(plugin).includes("oh-my-statusline"))).toHaveLength(1);
		expect(readJson<unknown>(path.join(w.claude, "oh-my-statusline", "previous-statusline.json"))).toEqual(USER_STATUS);
		expect(readdirSync(path.join(w.agent, "extensions")).sort()).toEqual(["oh-my-statusline", "other.ts"]);

		expect(runCli(w, "uninstall", ["all"]).code).toBe(0);
		expect(damaged(before, snapshot(w.home))).toEqual([]);
	});

	test("--plain sets the plain glyph mode in all four", () => {
		const w = makeWorld();
		expect(runCli(w, "install", [...ALL(w), "--plain"]).code).toBe(0);
		expect(readJson<Settings>(settingsFile(w)).statusLine?.command?.startsWith("STATUSLINE_GLYPHS=plain ")).toBe(true);
		expect(readJson<{ glyphs: string }>(path.join(codexDir(w), "install.json")).glyphs).toBe("plain");
		expect(readJson<{ glyphs: string }>(path.join(ext(w), "config.json")).glyphs).toBe("plain");
		expect(readJson<Cli>(cliFile(w)).plugins?.at(-1)).toEqual({ package: PACKAGE, options: { glyphs: "plain" } });
	});

	test("the directory options move each harness and leave the default home alone", () => {
		const w = makeWorld();
		const alt = path.join(w.root, "elsewhere");
		const args = ["all", "--claude-dir", `${alt}/claude`, "--agent-dir", `${alt}/agent`, `--config-dir=${alt}/oc`, "--bin-dir", `${alt}/bin`, "--codex", w.codex, "--wrap-codex"];
		const run = runCli(w, "install", args);
		expect([run.code, run.err]).toEqual([0, ""]);
		expect(readJson<Settings>(path.join(alt, "claude", "settings.json")).statusLine?.command).toContain(OURS);
		expect(existsSync(path.join(alt, "agent", "extensions", "oh-my-statusline", "index.ts"))).toBe(true);
		expect(readJson<Cli>(path.join(alt, "oc", "cli.json")).plugins?.at(-1)).toMatchObject({ package: PACKAGE });
		for (const name of ["codex", "codex-statusline", "codex-plain"]) expect(existsSync(path.join(alt, "bin", name))).toBe(true);
		for (const dir of [".claude", ".omp", ".config", ".local/bin"]) expect(existsSync(path.join(w.home, dir))).toBe(false);

		expect(runCli(w, "uninstall", ["all", "--claude-dir", `${alt}/claude`, "--agent-dir", `${alt}/agent`, "--config-dir", `${alt}/oc`]).code).toBe(0);
		expect(ours(snapshot(alt))).toEqual([]);
		expect(readdirSync(path.join(alt, "bin"))).toEqual([]);
	});

	test("CLAUDE_CONFIG_DIR, PI_CODING_AGENT_DIR and OPENCODE_CONFIG_DIR are honoured", () => {
		const w = makeWorld();
		const alt = path.join(w.root, "env");
		w.env.CLAUDE_CONFIG_DIR = `${alt}/c`;
		w.env.PI_CODING_AGENT_DIR = `${alt}/a`;
		w.env.OPENCODE_CONFIG_DIR = `${alt}/o`;
		expect(runCli(w, "install", ["claude", "omp", "opencode"]).code).toBe(0);
		expect(existsSync(path.join(alt, "c", "settings.json"))).toBe(true);
		expect(existsSync(path.join(alt, "a", "extensions", "oh-my-statusline"))).toBe(true);
		expect(existsSync(path.join(alt, "o", "cli.json"))).toBe(true);
		expect(readdirSync(w.home)).toEqual([]);
	});
});

describe("refusals", () => {
	test("a settings.json that is not valid JSON stops that harness untouched; the others go on", () => {
		const w = makeWorld();
		write(settingsFile(w), "{ not json");
		const before = snapshot(w.home);
		const run = runCli(w, "install", ["claude", "omp"]);
		expect(run.code).toBe(1);
		expect(run.err).toContain("[claude] install failed");
		expect(run.err).toContain("not valid JSON");
		expect(run.err).toContain("Failed: claude");
		expect(run.out).toContain("Installed: omp");
		expect(text(settingsFile(w))).toBe("{ not json");
		expect(existsSync(path.join(w.claude, "oh-my-statusline"))).toBe(false);
		expect(changes(before, snapshot(w.home)).every((file) => file.startsWith(path.join(".omp", "agent")))).toBe(true);
		expect(existsSync(ext(w))).toBe(true);
	});

	test("a cli.json that is not valid JSON, or whose plugins is not a list, stops opencode untouched", () => {
		for (const body of ["[1, 2]\n", "{ nope", '{"plugins": {"keep": true}}\n']) {
			const w = makeWorld();
			write(cliFile(w), body);
			const run = runCli(w, "install", ["opencode", "omp"]);
			expect([body, run.code]).toEqual([body, 1]);
			expect(run.err).toContain("[opencode] install failed");
			expect(text(cliFile(w))).toBe(body);
			expect(existsSync(path.join(w.opencode, "oh-my-statusline"))).toBe(false);
			expect(existsSync(ext(w))).toBe(true);
		}
	});

	test("a directory of ours name without our marker is refused in all four, and nothing changes", () => {
		const w = makeWorld();
		seedUser(w);
		for (const dir of [path.join(w.claude, "oh-my-statusline"), ext(w), path.join(w.opencode, "oh-my-statusline"), codexDir(w)]) write(path.join(dir, "mine.txt"), "keep me\n");
		const before = snapshot(w.home);
		const run = runCli(w, "install", ALL(w));
		expect(run.code).toBe(1);
		expect(run.err).toContain("Failed: claude, codex, omp, opencode");
		expect(snapshot(w.home)).toEqual(before);
		// and uninstall leaves those directories alone as well
		const removed = runCli(w, "uninstall", ALL(w));
		expect(removed.code).toBe(1);
		expect(damaged(before, snapshot(w.home))).toEqual([]);
	});

	test("a command in the launcher directory that is not ours is never replaced", () => {
		const w = makeWorld();
		write(path.join(w.bin, "codex-plain"), "user-owned\n");
		const run = runCli(w, "install", ["codex", "--codex", w.codex]);
		expect(run.code).toBe(1);
		expect(run.err).toContain("Refusing to replace existing command");
		expect(text(path.join(w.bin, "codex-plain"))).toBe("user-owned\n");
		expect(existsSync(codexDir(w))).toBe(false);
	});

	test("codex needs tmux and a Codex executable", () => {
		const w = makeWorld();
		const run = runCli(w, "install", ["codex", "--codex", path.join(w.root, "missing")]);
		expect(run.code).toBe(1);
		expect(run.err).toContain("Codex CLI not found");
		w.env.PATH = "/usr/bin:/bin";
		const noTmux = runCli(w, "install", ["codex", "--codex", w.codex]);
		expect(noTmux.code).toBe(1);
		expect(noTmux.err).toContain("tmux is required");
	});
});

describe("migration from claude-code-statusline", () => {
	test("our saved entries are the old install's saved ones; uninstall restores the pre-statusline settings", () => {
		const w = makeWorld();
		seedUser(w);
		const original = text(settingsFile(w));
		legacyClaude(w, "plain");
		const migrating = text(settingsFile(w));
		const legacyDir = path.join(w.claude, "claude-code-statusline");
		expect(migrating).toContain("claude-code-statusline/statusline.sh");

		const run = runCli(w, "install", ["claude"]);
		expect([run.code, run.err]).toEqual([0, ""]);
		expect(run.out).toContain("Migrating:");
		const settings = readJson<Settings>(settingsFile(w));
		expect(settings.statusLine?.command).toContain(OURS);
		expect(settings.statusLine?.command?.startsWith("STATUSLINE_GLYPHS=plain ")).toBe(true);
		expect(settings.subagentStatusLine?.command).toContain("--subagents");
		expect(text(settingsFile(w))).not.toContain("claude-code-statusline");
		expect(existsSync(legacyDir)).toBe(false);
		const dir = path.join(w.claude, "oh-my-statusline");
		expect(readJson<unknown>(path.join(dir, "previous-statusline.json"))).toEqual(USER_STATUS);
		expect(readJson<unknown>(path.join(dir, "previous-subagent-statusline.json"))).toBeNull();
		// the settings as the old install left them are kept in a backup
		expect(backups(w.claude, "settings.json").map((name) => text(path.join(w.claude, name)))).toContain(migrating);

		expect(runCli(w, "uninstall", ["claude"]).code).toBe(0);
		expect(text(settingsFile(w))).toBe(original);
		expect(existsSync(dir)).toBe(false);
	});

	test("when the user had no status line, uninstall leaves none", () => {
		const w = makeWorld();
		write(settingsFile(w), json({ model: "opus" }));
		const original = text(settingsFile(w));
		legacyClaude(w);
		expect(runCli(w, "install", ["claude"]).code).toBe(0);
		expect(readJson<Settings>(settingsFile(w)).statusLine?.command?.startsWith("STATUSLINE_GLYPHS")).toBe(false);
		expect(existsSync(path.join(w.claude, "claude-code-statusline"))).toBe(false);
		expect(runCli(w, "uninstall", ["claude"]).code).toBe(0);
		expect(text(settingsFile(w))).toBe(original);
	});

	test("a status line the user set after the old install is the one we save", () => {
		const w = makeWorld();
		seedUser(w);
		legacyClaude(w);
		const settings = readJson<Settings>(settingsFile(w));
		settings.statusLine = { type: "command", command: "later.sh" };
		write(settingsFile(w), json(settings));
		expect(runCli(w, "install", ["claude"]).code).toBe(0);
		expect(readJson<unknown>(path.join(w.claude, "oh-my-statusline", "previous-statusline.json"))).toEqual({ type: "command", command: "later.sh" });
		expect(readJson<unknown>(path.join(w.claude, "oh-my-statusline", "previous-subagent-statusline.json"))).toBeNull();
	});

	test("a directory with files the old install did not write is kept, and settings.json still switches", () => {
		const w = makeWorld();
		seedUser(w);
		legacyClaude(w);
		const legacyDir = path.join(w.claude, "claude-code-statusline");
		write(path.join(legacyDir, "notes.txt"), "mine\n");
		const run = runCli(w, "install", ["claude"]);
		expect(run.code).toBe(0);
		expect(run.out).toContain("left it in place");
		expect(text(path.join(legacyDir, "notes.txt"))).toBe("mine\n");
		expect(readJson<Settings>(settingsFile(w)).statusLine?.command).toContain(OURS);
	});

	test("a broken settings.json aborts the migration with every file untouched", () => {
		const w = makeWorld();
		seedUser(w);
		legacyClaude(w);
		write(settingsFile(w), "{ not json");
		const before = snapshot(w.home);
		const run = runCli(w, "install", ["claude"]);
		expect(run.code).toBe(1);
		expect(snapshot(w.home)).toEqual(before);
	});

	test("a saved entry that is not valid JSON aborts the migration with every file untouched", () => {
		const w = makeWorld();
		seedUser(w);
		legacyClaude(w);
		write(path.join(w.claude, "claude-code-statusline", "previous-statusline.json"), "{ nope");
		const before = snapshot(w.home);
		const run = runCli(w, "install", ["claude"]);
		expect(run.code).toBe(1);
		expect(run.err).toContain("previous-statusline.json is not valid JSON");
		expect(snapshot(w.home)).toEqual(before);
	});
});

describe("migration from codex-statusline", () => {
	test("old launchers are replaced, the Codex path, glyphs and wrapper carry over, the old directory goes", () => {
		const w = makeWorld();
		seedUser(w);
		const before = snapshot(w.home);
		const old = legacyCodex(w, { wrap: true, glyphs: "plain" });
		expect(text(path.join(w.bin, "codex"))).toContain("statusline.py");

		// No --codex: the old install remembered it.
		const run = runCli(w, "install", ["codex"]);
		expect([run.code, run.err]).toEqual([0, ""]);
		expect(run.out).toContain("Migrating: remove the old launcher");
		expect(run.out).toContain("Migrating: remove the old install directory");
		const manifest = readJson<{ codex: string; glyphs: string; launchers: Record<string, string> }>(path.join(codexDir(w), "install.json"));
		expect(manifest.codex).toBe(w.codex);
		expect(manifest.glyphs).toBe("plain");
		expect(Object.keys(manifest.launchers).sort()).toEqual(old.launchers.sort());
		for (const file of old.launchers) {
			expect(text(file)).toContain(path.basename(file) === "codex-plain" ? w.codex : "oh-my-statusline");
			expect(text(file)).not.toContain("statusline.py");
		}
		expect(existsSync(old.dir)).toBe(false);
		expect(text(path.join(w.bin, "my-tool"))).toContain("mine");

		expect(runCli(w, "uninstall", ["codex"]).code).toBe(0);
		expect(damaged(before, snapshot(w.home))).toEqual([]);
		expect(readdirSync(w.bin)).toEqual(["my-tool"]);
	});

	test("a launcher the user modified is kept and reported, and not replaced by a wrapper", () => {
		const w = makeWorld();
		const old = legacyCodex(w, { wrap: true });
		const wrapper = path.join(w.bin, "codex");
		writeFileSync(wrapper, "#!/bin/sh\necho my own wrapper\n");
		const run = runCli(w, "install", ["codex"]);
		expect([run.code, run.err]).toEqual([0, ""]);
		expect(run.out).toContain(`Keeping ${wrapper}`);
		expect(text(wrapper)).toContain("my own wrapper");
		expect(Object.keys(readJson<{ launchers: Record<string, string> }>(path.join(codexDir(w), "install.json")).launchers)).not.toContain(wrapper);
		expect(existsSync(old.dir)).toBe(false);
		expect(runCli(w, "uninstall", ["codex"]).code).toBe(0);
		expect(text(wrapper)).toContain("my own wrapper");
	});

	test("a modified launcher at a path ours needs is refused, with the old install untouched", () => {
		const w = makeWorld();
		const old = legacyCodex(w);
		writeFileSync(path.join(w.bin, "codex-plain"), "#!/bin/sh\necho edited\n");
		const before = snapshot(w.home);
		const run = runCli(w, "install", ["codex"]);
		expect(run.code).toBe(1);
		expect(run.err).toContain("Refusing to replace existing command");
		expect(snapshot(w.home)).toEqual(before);
		expect(existsSync(old.dir)).toBe(true);
	});

	test("--wrap-codex adds the wrapper on a fresh install too", () => {
		const w = makeWorld();
		expect(runCli(w, "install", ["codex", "--codex", w.codex, "--wrap-codex"]).code).toBe(0);
		expect(existsSync(path.join(w.bin, "codex"))).toBe(true);
	});
});

describe("migration from omp-statusline", () => {
	test("the old extension directory is removed, so omp loads one widget; its glyph mode carries over", () => {
		const w = makeWorld();
		seedUser(w);
		const before = snapshot(w.home);
		const old = legacyOmp(w, { glyphs: "plain" });
		const run = runCli(w, "install", ["omp"]);
		expect([run.code, run.err]).toEqual([0, ""]);
		expect(run.out).toContain("Migrating:");
		expect(existsSync(old)).toBe(false);
		expect(readdirSync(path.join(w.agent, "extensions")).sort()).toEqual(["oh-my-statusline", "other.ts"]);
		expect(readJson<{ glyphs: string }>(path.join(ext(w), "config.json")).glyphs).toBe("plain");

		expect(runCli(w, "uninstall", ["omp"]).code).toBe(0);
		expect(damaged(before, snapshot(w.home))).toEqual([]);
		expect(readdirSync(path.join(w.agent, "extensions"))).toEqual(["other.ts"]);
	});

	test("a hand copy without the marker counts when both sources carry the project's header", () => {
		const w = makeWorld();
		const old = legacyOmp(w, { marker: false });
		expect(runCli(w, "install", ["omp"]).code).toBe(0);
		expect(existsSync(old)).toBe(false);
		expect(existsSync(ext(w))).toBe(true);
	});

	test("a directory of that name that is not the old project is left alone", () => {
		const w = makeWorld();
		const foreign = path.join(w.agent, "extensions", "omp-statusline");
		write(path.join(foreign, "index.ts"), "// something else\n");
		write(path.join(foreign, "render.ts"), "// something else\n");
		const run = runCli(w, "install", ["omp"]);
		expect(run.code).toBe(0);
		expect(text(path.join(foreign, "index.ts"))).toBe("// something else\n");
		expect(existsSync(ext(w))).toBe(true);
	});

	test("an old directory with files its installer did not write is refused untouched", () => {
		const w = makeWorld();
		const old = legacyOmp(w);
		write(path.join(old, "node_modules", "x.js"), "x\n");
		const before = snapshot(w.home);
		const run = runCli(w, "install", ["omp"]);
		expect(run.code).toBe(1);
		expect(run.err).toContain("two status lines");
		expect(snapshot(w.home)).toEqual(before);
	});
});

describe("migration from opencode-statusline", () => {
	test("the ./statusline entry becomes ours with its options, the saved list becomes ours, the old directory goes", () => {
		const w = makeWorld();
		seedUser(w);
		const original = text(cliFile(w));
		const before = snapshot(w.home);
		legacyOpencode(w, { glyphs: "plain", home: false });

		const run = runCli(w, "install", ["opencode"]);
		expect([run.code, run.err]).toEqual([0, ""]);
		expect(run.out).toContain("Migrating:");
		expect(readJson<Cli>(cliFile(w)).plugins).toEqual(["./herdr", { package: "other", options: { a: 1 } }, FOOTER, { package: PACKAGE, options: { glyphs: "plain", home: false } }]);
		expect(text(cliFile(w))).not.toContain('"./statusline"');
		expect(existsSync(path.join(w.opencode, "statusline"))).toBe(false);
		const dir = path.join(w.opencode, "oh-my-statusline");
		expect(readJson<unknown>(path.join(dir, "previous-plugins.json"))).toEqual({ had: true, plugins: ["./herdr", { package: "other", options: { a: 1 } }] });
		expect(text(path.join(dir, "cli.json.bak"))).toBe(original);
		expect(backups(w.opencode, "cli.json").length).toBeGreaterThanOrEqual(1);

		expect(runCli(w, "uninstall", ["opencode"]).code).toBe(0);
		expect(damaged(before, snapshot(w.home))).toEqual([]);
		expect(text(cliFile(w))).toBe(original);
		expect(existsSync(dir)).toBe(false);
	});

	test("no plugins key before: uninstall drops the key again", () => {
		const w = makeWorld();
		write(cliFile(w), json({ theme: "tokyonight" }));
		const original = text(cliFile(w));
		legacyOpencode(w);
		expect(runCli(w, "install", ["opencode"]).code).toBe(0);
		expect(readJson<Cli>(cliFile(w)).plugins).toEqual([FOOTER, { package: PACKAGE, options: { glyphs: "powerline" } }]);
		expect(runCli(w, "uninstall", ["opencode"]).code).toBe(0);
		expect(text(cliFile(w))).toBe(original);
	});

	test("the built-in usage row the user had already switched off stays off after uninstall", () => {
		const w = makeWorld();
		write(cliFile(w), json({ plugins: ["./herdr", FOOTER] }));
		const original = text(cliFile(w));
		legacyOpencode(w);
		expect(runCli(w, "install", ["opencode"]).code).toBe(0);
		expect((readJson<Cli>(cliFile(w)).plugins ?? []).filter((plugin) => plugin === FOOTER)).toHaveLength(1);
		expect(runCli(w, "uninstall", ["opencode"]).code).toBe(0);
		expect(text(cliFile(w))).toBe(original);
	});

	test("a bare ./statusline string entry is replaced too", () => {
		const w = makeWorld();
		write(cliFile(w), json({ plugins: ["./herdr"] }));
		legacyOpencode(w);
		const cli = readJson<Cli>(cliFile(w));
		cli.plugins = ["./herdr", FOOTER, "./statusline"];
		write(cliFile(w), json(cli));
		expect(runCli(w, "install", ["opencode", "--plain"]).code).toBe(0);
		expect(readJson<Cli>(cliFile(w)).plugins).toEqual(["./herdr", FOOTER, { package: PACKAGE, options: { glyphs: "plain" } }]);
	});

	test("a ./statusline directory without the old marker is someone else's and stays", () => {
		const w = makeWorld();
		write(cliFile(w), json({ plugins: ["./statusline"] }));
		write(path.join(w.opencode, "statusline", "tui.tsx"), "// mine\n");
		expect(runCli(w, "install", ["opencode"]).code).toBe(0);
		expect(text(path.join(w.opencode, "statusline", "tui.tsx"))).toBe("// mine\n");
		expect(readJson<Cli>(cliFile(w)).plugins).toContain("./statusline");
	});

	test("a broken cli.json aborts the migration with every file untouched", () => {
		const w = makeWorld();
		seedUser(w);
		legacyOpencode(w);
		write(cliFile(w), "{ nope");
		const before = snapshot(w.home);
		expect(runCli(w, "install", ["opencode"]).code).toBe(1);
		expect(snapshot(w.home)).toEqual(before);
	});
});

describe("all four legacy installs", () => {
	test("migrating everything, then uninstalling, restores the user's own files byte for byte", () => {
		const w = makeWorld();
		seedUser(w);
		const before = snapshot(w.home);
		legacyAll(w);

		const run = runCli(w, "install", ["all"]);
		expect([run.code, run.err]).toEqual([0, ""]);
		expect(run.out.match(/Migrating:/g)?.length).toBeGreaterThanOrEqual(8);
		const middle = snapshot(w.home);
		for (const gone of ["claude-code-statusline", "codex-statusline", "omp-statusline", path.join("opencode", "statusline")]) {
			expect(Object.keys(middle).filter((file) => file.includes(`${gone}${path.sep}`) || file.includes(`${gone}.`))).toEqual([]);
		}
		expect(readJson<Settings>(settingsFile(w)).statusLine?.command).toContain(OURS);

		expect(runCli(w, "uninstall", ["all"]).code).toBe(0);
		const after = snapshot(w.home);
		expect(damaged(before, after)).toEqual([]);
		expect(ours(after)).toEqual([]);
		expect(readdirSync(w.bin)).toEqual(["my-tool"]);
	});

	test("--dry-run prints the migration plan and writes nothing", () => {
		const w = makeWorld();
		seedUser(w);
		legacyAll(w);
		const before = snapshot(w.home);
		const run = runCli(w, "install", [...ALL(w), "--dry-run"]);
		expect([run.code, run.err]).toEqual([0, ""]);
		expect(snapshot(w.home)).toEqual(before);
		expect(run.out).toContain("Dry run");
		for (const step of [
			"[claude] [dry-run] copy the runtime into",
			"[claude] [dry-run] keep what the old install saved",
			"[claude] [dry-run] remove the old install",
			"[codex] [dry-run] remove the old launcher",
			"[codex] [dry-run] remove the old install directory",
			"[omp] [dry-run] remove the old omp-statusline",
			"[opencode] [dry-run] keep the plugins list from before the old install",
			"[opencode] [dry-run] replace the old ./statusline entry with ./oh-my-statusline",
			"[opencode] [dry-run] remove the old install",
		]) {
			expect(run.out).toContain(step);
		}
		expect(run.out).toContain("Planned: claude, codex, omp, opencode");
		// the legacy wiring is intact
		expect(text(settingsFile(w))).toContain("claude-code-statusline/statusline.sh");
		expect(text(cliFile(w))).toContain('"./statusline"');
	});

	test("--dry-run changes nothing on a clean machine or for uninstall either", () => {
		const w = makeWorld();
		seedUser(w);
		const clean = snapshot(w.home);
		expect(runCli(w, "install", [...ALL(w), "--dry-run"]).code).toBe(0);
		expect(snapshot(w.home)).toEqual(clean);
		expect(runCli(w, "install", ALL(w)).code).toBe(0);
		const installed = snapshot(w.home);
		const run = runCli(w, "uninstall", ["all", "--dry-run"]);
		expect([run.code, run.err]).toEqual([0, ""]);
		expect(snapshot(w.home)).toEqual(installed);
		expect(run.out).toContain("[dry-run] ");
	});
});

describe("uninstall", () => {
	test("with nothing installed it reports and changes nothing", () => {
		const w = makeWorld();
		seedUser(w);
		const before = snapshot(w.home);
		const run = runCli(w, "uninstall", ["all"]);
		expect(run.code).toBe(0);
		expect(snapshot(w.home)).toEqual(before);
	});

	test("a launcher the user edited is kept", () => {
		const w = makeWorld();
		expect(runCli(w, "install", ["codex", "--codex", w.codex, "--wrap-codex"]).code).toBe(0);
		script(path.join(w.bin, "codex"), "echo mine\n");
		const run = runCli(w, "uninstall", ["codex"]);
		expect(run.code).toBe(0);
		expect(run.out).toContain("Preserved modified launcher");
		expect(readdirSync(w.bin)).toEqual(["codex"]);
	});
});
