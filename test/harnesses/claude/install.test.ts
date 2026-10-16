// install()/uninstall() against throwaway Claude config directories. Ported from
// claude-code-statusline/test/test_install.py (all 16 tests; `test_unknown_option_is_rejected`
// is argument parsing, which belongs to the unified CLI, so refusals of the install module itself
// stand in for it below).

import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { install, uninstall } from "../../../src/harnesses/claude/install.ts";
import { MARKER } from "../../../src/infrastructure/install-kit.ts";
import { cleanTemps, isolatedEnv, seedUsage, spawnText, strip, tmp } from "./support.ts";

afterEach(cleanTemps);

const SOURCE_ROOT = path.resolve(import.meta.dir, "../../..");
const OLD = { type: "command", command: "~/.claude/old-statusline.sh" };
const OLD_SUB = { type: "command", command: "~/.claude/old-subagent-statusline.sh" };

type Json = Record<string, any>;

/** A Claude config directory (default name `claude`) holding `settings` as JSON, or as given text. */
function configDir(settings?: Json | string, name = "claude") {
	const cfg = tmp(name);
	mkdirSync(cfg, { recursive: true });
	if (settings !== undefined) writeFileSync(path.join(cfg, "settings.json"), typeof settings === "string" ? settings : JSON.stringify(settings, null, 2));
	return { cfg, installDir: path.join(cfg, "oh-my-statusline"), settingsFile: path.join(cfg, "settings.json") };
}

const logs: string[] = [];
const options = (cfg: string, plain = false) => ({
	home: path.join(path.dirname(cfg), "home"),
	env: { CLAUDE_CONFIG_DIR: cfg },
	sourceRoot: SOURCE_ROOT,
	plain,
	log: (line: string) => logs.push(line),
});
const doInstall = (cfg: string, plain = false) => install(options(cfg, plain));
const doUninstall = (cfg: string) => uninstall(options(cfg));

const settings = (cfg: string): Json => JSON.parse(readFileSync(path.join(cfg, "settings.json"), "utf8"));
const writeSettings = (cfg: string, data: Json) => writeFileSync(path.join(cfg, "settings.json"), JSON.stringify(data));
const savedPrevious = (installDir: string, file = "previous-statusline.json"): unknown => JSON.parse(readFileSync(path.join(installDir, file), "utf8"));
const MAIN = ["src", "harnesses", "claude", "main.ts"];

describe("install", () => {
	test("into an empty config directory creates settings.json and copies the runtime", () => {
		const { cfg, installDir } = configDir();
		doInstall(cfg);
		const status = settings(cfg).statusLine;
		const target = path.join(installDir, ...MAIN);
		expect(status.type).toBe("command");
		expect(status.command).toContain(target);
		expect(status.refreshInterval).toBe(30);
		expect(readFileSync(target, "utf8")).toBe(readFileSync(path.join(SOURCE_ROOT, ...MAIN), "utf8"));
		expect(existsSync(path.join(installDir, MARKER))).toBe(true);
		expect(existsSync(path.join(installDir, "package.json"))).toBe(true);
	});

	test("the config directory defaults to ~/.claude under the given home", () => {
		const home = path.join(path.dirname(tmp("h")), "home");
		install({ home, env: {}, sourceRoot: SOURCE_ROOT, plain: false, log: () => {} });
		expect(existsSync(path.join(home, ".claude", "oh-my-statusline", ...MAIN))).toBe(true);
		expect(existsSync(path.join(home, ".claude", "settings.json"))).toBe(true);
	});

	test("the command is the absolute bun and the absolute main.ts, quoted, and renders even with spaces in the path", async () => {
		const { cfg, installDir } = configDir(undefined, "claude config");
		doInstall(cfg);
		const command = settings(cfg).statusLine.command as string;
		expect(command).toBe(`"${process.execPath}" "${path.join(installDir, ...MAIN)}"`);
		const stdin = JSON.stringify({ model: { display_name: "Opus" }, workspace: { current_dir: "/tmp" } });
		const env = isolatedEnv();
		seedUsage(env);
		const { code, out, err } = await spawnText(["/bin/sh", "-c", command], stdin, env);
		expect([code, err]).toEqual([0, ""]);
		expect(strip(out)).toContain("Opus");
	});

	test("keeps other settings, saves the previous statusLine, and backs settings.json up", () => {
		const { cfg, installDir } = configDir({ model: "opus", permissions: { allow: ["Bash(ls)"] }, statusLine: OLD });
		doInstall(cfg);
		const s = settings(cfg);
		expect(s.model).toBe("opus");
		expect(s.permissions).toEqual({ allow: ["Bash(ls)"] });
		expect(s.statusLine.command).toContain("oh-my-statusline");
		expect(savedPrevious(installDir)).toEqual(OLD);
		expect(readdirSync(cfg).filter((name) => name.startsWith("settings.json.bak-"))).toHaveLength(1);
	});

	test("a reinstall keeps the original previous statusLine", () => {
		const { cfg, installDir } = configDir({ statusLine: OLD });
		doInstall(cfg);
		doInstall(cfg);
		expect(savedPrevious(installDir)).toEqual(OLD);
	});

	test("plain sets the glyph mode in both commands", () => {
		const { cfg } = configDir();
		doInstall(cfg, true);
		expect(settings(cfg).statusLine.command.startsWith("STATUSLINE_GLYPHS=plain ")).toBe(true);
		expect(settings(cfg).subagentStatusLine.command.startsWith("STATUSLINE_GLYPHS=plain ")).toBe(true);
	});

	test("invalid settings.json aborts without changes", () => {
		const { cfg, installDir, settingsFile } = configDir("{ not json");
		expect(() => doInstall(cfg)).toThrow(/not valid JSON/);
		expect(readFileSync(settingsFile, "utf8")).toBe("{ not json");
		expect(existsSync(installDir)).toBe(false);
	});

	test("a settings.json that is not an object aborts without changes", () => {
		const { cfg, installDir, settingsFile } = configDir("[1, 2]");
		expect(() => doInstall(cfg)).toThrow(/not a JSON object/);
		expect(readFileSync(settingsFile, "utf8")).toBe("[1, 2]");
		expect(existsSync(installDir)).toBe(false);
	});

	test("a directory someone else owns is refused and left untouched, settings.json too", () => {
		const { cfg, installDir, settingsFile } = configDir({ statusLine: OLD });
		mkdirSync(installDir);
		writeFileSync(path.join(installDir, "theirs.txt"), "mine");
		expect(() => doInstall(cfg)).toThrow(/not installed by oh-my-statusline/);
		expect(readFileSync(path.join(installDir, "theirs.txt"), "utf8")).toBe("mine");
		expect(settings(cfg)).toEqual({ statusLine: OLD });
		expect(readdirSync(cfg).sort()).toEqual(["oh-my-statusline", "settings.json"]);
		expect(existsSync(settingsFile)).toBe(true);
	});

	test("sets the subagent statusLine to the same command plus --subagents", () => {
		const { cfg } = configDir();
		doInstall(cfg);
		const s = settings(cfg);
		expect(s.subagentStatusLine).toEqual({ type: "command", command: `${s.statusLine.command} --subagents` });
	});

	test("the installed subagent command prints rows", async () => {
		const { cfg } = configDir(undefined, "claude config");
		doInstall(cfg, true);
		const command = settings(cfg).subagentStatusLine.command as string;
		expect(command.startsWith("STATUSLINE_GLYPHS=plain ")).toBe(true);
		const task = { id: "a1", status: "running", description: "Review", model: "claude-haiku-4-5-20251001", contextWindowSize: 200_000, tokenCount: 24_000 };
		const { code, out, err } = await spawnText(["/bin/sh", "-c", command], JSON.stringify({ columns: 100, tasks: [task] }), isolatedEnv());
		const rows = out.trim().split("\n").map((line) => JSON.parse(line));
		expect([code, err, rows.length]).toEqual([0, "", 1]);
		expect(rows[0].content).toContain("Haiku 4.5");
	});

	test("an upgrade saves the subagent statusLine it replaces", () => {
		// an install from before subagent rows saved only previous-statusline.json
		const { cfg, installDir } = configDir({ statusLine: OLD });
		doInstall(cfg);
		rmSync(path.join(installDir, "previous-subagent-statusline.json"));
		writeSettings(cfg, { ...settings(cfg), subagentStatusLine: OLD_SUB });
		doInstall(cfg);
		doUninstall(cfg);
		expect(settings(cfg)).toEqual({ statusLine: OLD, subagentStatusLine: OLD_SUB });
	});

	test("saves null when nothing was set, and never saves an entry that is already ours", () => {
		const { cfg, installDir } = configDir();
		doInstall(cfg);
		expect(savedPrevious(installDir)).toBeNull();
		expect(savedPrevious(installDir, "previous-subagent-statusline.json")).toBeNull();
	});

	test("settings.json keeps its symlink", () => {
		const { cfg, settingsFile } = configDir();
		const real = path.join(path.dirname(cfg), "dotfiles-settings.json");
		writeFileSync(real, '{"model":"opus"}');
		symlinkSync(real, settingsFile);
		doInstall(cfg);
		expect(JSON.parse(readFileSync(real, "utf8")).statusLine.command).toContain("oh-my-statusline");
		expect(JSON.parse(readFileSync(real, "utf8")).model).toBe("opus");
		expect(existsSync(settingsFile)).toBe(true);
	});
});

describe("uninstall", () => {
	test("restores the previous statusLine and removes the install directory", () => {
		const { cfg, installDir } = configDir({ statusLine: OLD, model: "opus" });
		doInstall(cfg);
		doUninstall(cfg);
		const s = settings(cfg);
		expect(s.statusLine).toEqual(OLD);
		expect(s.model).toBe("opus");
		expect(s.subagentStatusLine).toBeUndefined();
		expect(existsSync(installDir)).toBe(false);
	});

	test("removes a statusLine it added", () => {
		const { cfg } = configDir({ model: "opus" });
		doInstall(cfg);
		doUninstall(cfg);
		expect(settings(cfg)).toEqual({ model: "opus" });
	});

	test("leaves a statusLine changed after install", () => {
		const { cfg } = configDir();
		doInstall(cfg);
		writeSettings(cfg, { ...settings(cfg), statusLine: { type: "command", command: "mine.sh" } });
		logs.length = 0;
		doUninstall(cfg);
		expect(settings(cfg).statusLine.command).toBe("mine.sh");
		expect(logs.some((line) => line.includes("statusLine") && line.includes("left it unchanged"))).toBe(true);
	});

	test("restores both previous entries", () => {
		const { cfg, installDir } = configDir({ statusLine: OLD, subagentStatusLine: OLD_SUB });
		doInstall(cfg);
		expect(savedPrevious(installDir)).toEqual(OLD);
		doUninstall(cfg);
		expect(settings(cfg)).toEqual({ statusLine: OLD, subagentStatusLine: OLD_SUB });
	});

	test("removes a subagent statusLine it added", () => {
		const { cfg } = configDir({ statusLine: OLD });
		doInstall(cfg);
		doUninstall(cfg);
		expect(settings(cfg)).toEqual({ statusLine: OLD });
	});

	test("leaves a subagent statusLine changed after install", () => {
		const { cfg } = configDir();
		doInstall(cfg);
		writeSettings(cfg, { ...settings(cfg), subagentStatusLine: { type: "command", command: "mine.sh" } });
		doUninstall(cfg);
		const s = settings(cfg);
		expect(s.subagentStatusLine.command).toBe("mine.sh");
		expect(s.statusLine).toBeUndefined();
	});

	test("backs settings.json up before restoring, once for both entries", () => {
		const { cfg } = configDir({ statusLine: OLD, subagentStatusLine: OLD_SUB });
		doInstall(cfg);
		const before = readdirSync(cfg).filter((name) => name.startsWith("settings.json.bak-")).length;
		doUninstall(cfg);
		expect(readdirSync(cfg).filter((name) => name.startsWith("settings.json.bak-")).length).toBe(before + 1);
	});

	test("keeps a directory it does not own, and refuses a settings.json that is not JSON", () => {
		const foreign = configDir({ statusLine: OLD });
		mkdirSync(foreign.installDir);
		writeFileSync(path.join(foreign.installDir, "theirs.txt"), "mine");
		doUninstall(foreign.cfg);
		expect(existsSync(path.join(foreign.installDir, "theirs.txt"))).toBe(true);
		expect(settings(foreign.cfg)).toEqual({ statusLine: OLD });

		const broken = configDir();
		doInstall(broken.cfg);
		writeFileSync(broken.settingsFile, "{ not json");
		expect(() => doUninstall(broken.cfg)).toThrow(/not valid JSON/);
		expect(existsSync(broken.installDir)).toBe(true);
		expect(readFileSync(broken.settingsFile, "utf8")).toBe("{ not json");
	});

	test("with nothing installed it only reports", () => {
		const { cfg } = configDir({ model: "opus" });
		logs.length = 0;
		doUninstall(cfg);
		expect(settings(cfg)).toEqual({ model: "opus" });
		expect(logs.length).toBeGreaterThan(0);
	});
});
