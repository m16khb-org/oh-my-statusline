// Ported from opencode-statusline test/install.test.ts (install.sh / uninstall.sh), 11 tests: ten
// live here; "rejects an unknown option" is argument parsing, which belongs to the unified CLI.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { install, uninstall } from "../../../src/harnesses/opencode/install.ts";

const ROOT = path.join(import.meta.dir, "..", "..", "..");
const PACKAGE = "./oh-my-statusline";
const FOOTER = "-opencode.prompt.footer";

let tmp: string;
let counter = 0;
beforeEach(() => {
	tmp = mkdtempSync(path.join(tmpdir(), "oms-opencode-install-"));
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

/** A fresh config directory, with an optional cli.json to start from. */
function config(cli?: unknown): string {
	const dir = path.join(tmp, `config-${counter++}`);
	mkdirSync(dir, { recursive: true });
	if (cli !== undefined) writeFileSync(path.join(dir, "cli.json"), `${JSON.stringify(cli, null, 2)}\n`);
	return dir;
}

const read = (dir: string) => JSON.parse(readFileSync(path.join(dir, "cli.json"), "utf8"));

function run(action: typeof install | typeof uninstall, dir: string, plain = false) {
	const lines: string[] = [];
	const options = { home: path.join(tmp, "home"), env: { PATH: "" }, sourceRoot: ROOT, plain, log: (line: string) => lines.push(line), configDir: dir };
	try {
		action(options);
		return { ok: true, out: lines.join("\n") };
	} catch (error) {
		return { ok: false, out: `${lines.join("\n")}${(error as Error).message}` };
	}
}

describe("install", () => {
	test("copies the plugin and registers it with the built-in usage row off", () => {
		const dir = config();
		expect(run(install, dir).ok).toBe(true);

		const plugin = path.join(dir, "oh-my-statusline");
		for (const file of ["src/harnesses/opencode/tui.tsx", "src/harnesses/opencode/view.ts", "src/domain/render/statusline.ts"]) {
			expect(readFileSync(path.join(plugin, file), "utf8")).toBe(readFileSync(path.join(ROOT, file), "utf8"));
		}
		// OpenCode loads <dir>/tui.*: the entry re-exports the plugin.
		expect(readFileSync(path.join(plugin, "tui.tsx"), "utf8")).toBe('export { default } from "./src/harnesses/opencode/tui.tsx";\n');
		// The host resolves the entry with Bun.resolveSync(<dir>/tui, <dir>): that finds the file.
		expect(realpathSync(Bun.resolveSync(path.join(plugin, "tui"), plugin))).toBe(realpathSync(path.join(plugin, "tui.tsx")));
		expect(existsSync(path.join(plugin, ".oh-my-statusline"))).toBe(true);
		expect(read(dir).plugins).toEqual([FOOTER, { package: PACKAGE, options: { glyphs: "powerline" } }]);
	});

	test("plain writes plain glyphs", () => {
		const dir = config();
		expect(run(install, dir, true).ok).toBe(true);
		expect(read(dir).plugins.at(-1)).toEqual({ package: PACKAGE, options: { glyphs: "plain" } });
	});

	test("keeps the other plugins, and adds nothing twice on a re-install", () => {
		const dir = config({ theme: "tokyonight", plugins: ["./herdr", { package: "other", options: { a: 1 } }] });
		expect(run(install, dir).ok).toBe(true);
		expect(run(install, dir, true).ok).toBe(true);

		expect(read(dir)).toEqual({
			theme: "tokyonight",
			plugins: ["./herdr", { package: "other", options: { a: 1 } }, FOOTER, { package: PACKAGE, options: { glyphs: "plain" } }],
		});
	});

	test("saves the previous list and the file once, on the first install only", () => {
		const dir = config({ plugins: ["./herdr"] });
		expect(run(install, dir).ok).toBe(true);
		expect(run(install, dir, true).ok).toBe(true);

		const plugin = path.join(dir, "oh-my-statusline");
		expect(JSON.parse(readFileSync(path.join(plugin, "previous-plugins.json"), "utf8"))).toEqual({ had: true, plugins: ["./herdr"] });
		expect(JSON.parse(readFileSync(path.join(plugin, "cli.json.bak"), "utf8"))).toEqual({ plugins: ["./herdr"] });
	});

	test("leaves a directory it did not install alone", () => {
		const dir = config();
		mkdirSync(path.join(dir, "oh-my-statusline"), { recursive: true });
		writeFileSync(path.join(dir, "oh-my-statusline", "mine.txt"), "keep me\n");
		const result = run(install, dir);
		expect(result.ok).toBe(false);
		expect(result.out).toContain("was not installed by oh-my-statusline");
		expect(existsSync(path.join(dir, "oh-my-statusline", "mine.txt"))).toBe(true);
		expect(existsSync(path.join(dir, "cli.json"))).toBe(false);
	});

	test("refuses a cli.json whose plugins is not an array, and changes nothing", () => {
		const dir = config({ plugins: { keep: true } });
		const result = run(install, dir);
		expect(result.ok).toBe(false);
		expect(result.out).toContain("plugins entry that is not an array");
		expect(read(dir).plugins).toEqual({ keep: true });
		expect(existsSync(path.join(dir, "oh-my-statusline"))).toBe(false);
	});

	test("refuses a cli.json that is not a JSON object, and changes nothing", () => {
		const dir = config();
		writeFileSync(path.join(dir, "cli.json"), "[1, 2]\n");
		const result = run(install, dir);
		expect(result.ok).toBe(false);
		expect(result.out).toContain("is not a JSON object");
		expect(readFileSync(path.join(dir, "cli.json"), "utf8")).toBe("[1, 2]\n");
		expect(existsSync(path.join(dir, "oh-my-statusline"))).toBe(false);
	});

	test("the config directory comes from OPENCODE_CONFIG_DIR, else <home>/.config/opencode", () => {
		const fromEnv = config();
		const lines: string[] = [];
		install({ home: tmp, env: { OPENCODE_CONFIG_DIR: fromEnv }, sourceRoot: ROOT, plain: false, log: (line) => lines.push(line) });
		expect(existsSync(path.join(fromEnv, "oh-my-statusline", "tui.tsx"))).toBe(true);

		install({ home: tmp, env: {}, sourceRoot: ROOT, plain: false, log: (line) => lines.push(line) });
		expect(existsSync(path.join(tmp, ".config", "opencode", "oh-my-statusline", "tui.tsx"))).toBe(true);
	});
});

describe("uninstall", () => {
	test("puts the previous plugins list back and removes the directory", () => {
		const dir = config({ theme: "tokyonight", plugins: ["./herdr", FOOTER] });
		expect(run(install, dir).ok).toBe(true);
		expect(run(uninstall, dir).ok).toBe(true);

		expect(read(dir)).toEqual({ theme: "tokyonight", plugins: ["./herdr", FOOTER] });
		expect(existsSync(path.join(dir, "oh-my-statusline"))).toBe(false);
	});

	test("drops the plugins key entirely when there was none", () => {
		const dir = config({ theme: "tokyonight" });
		expect(run(install, dir).ok).toBe(true);
		expect(run(uninstall, dir).ok).toBe(true);
		expect(read(dir)).toEqual({ theme: "tokyonight" });
	});

	test("keeps an empty plugins list that was there before", () => {
		const dir = config({ plugins: [] });
		expect(run(install, dir).ok).toBe(true);
		expect(run(uninstall, dir).ok).toBe(true);
		expect(read(dir)).toEqual({ plugins: [] });
	});

	test("does not restore a status line entry that was there before", () => {
		// An earlier hand-made install: a copy that left a ./oh-my-statusline entry in cli.json.
		const dir = config({ plugins: ["./herdr", { package: PACKAGE, options: { glyphs: "plain" } }] });
		expect(run(install, dir).ok).toBe(true);
		expect(run(uninstall, dir).ok).toBe(true);
		expect(read(dir).plugins).toEqual(["./herdr"]);
	});

	test("a plugin added while the status line was installed survives uninstall", () => {
		const dir = config({ plugins: ["./herdr"] });
		expect(run(install, dir).ok).toBe(true);
		const during = read(dir);
		during.plugins.push("./added-later");
		writeFileSync(path.join(dir, "cli.json"), `${JSON.stringify(during, null, 2)}\n`);
		expect(run(uninstall, dir).ok).toBe(true);
		expect(read(dir).plugins).toEqual(["./herdr", "./added-later"]);
	});

	test("without the saved record it only takes its own entries out", () => {
		const dir = config({ plugins: ["./herdr"] });
		expect(run(install, dir).ok).toBe(true);
		rmSync(path.join(dir, "oh-my-statusline", "previous-plugins.json"));
		expect(run(uninstall, dir).ok).toBe(true);
		expect(read(dir).plugins).toEqual(["./herdr"]);
		expect(existsSync(path.join(dir, "oh-my-statusline"))).toBe(false);
	});

	test("says so when nothing is installed, and refuses a foreign directory", () => {
		const dir = config({});
		const nothing = run(uninstall, dir);
		expect(nothing.ok).toBe(true);
		expect(nothing.out).toContain("is not installed");

		mkdirSync(path.join(dir, "oh-my-statusline"), { recursive: true });
		const foreign = run(uninstall, dir);
		expect(foreign.ok).toBe(false);
		expect(foreign.out).toContain("leaving it alone");
		expect(existsSync(path.join(dir, "oh-my-statusline"))).toBe(true);
	});

	test("a cli.json that is not a JSON object stops the uninstall untouched", () => {
		const dir = config({});
		expect(run(install, dir).ok).toBe(true);
		writeFileSync(path.join(dir, "cli.json"), "[]\n");
		const result = run(uninstall, dir);
		expect(result.ok).toBe(false);
		expect(existsSync(path.join(dir, "oh-my-statusline"))).toBe(true);
		expect(readFileSync(path.join(dir, "cli.json"), "utf8")).toBe("[]\n");
	});
});
