// Install oh-my-statusline into OpenCode: copy the runtime into <config>/oh-my-statusline and
// register it in cli.json, where the TUI loads plugins at startup.
//
// OpenCode resolves a `{ "package": "./oh-my-statusline" }` entry as a directory plugin: it loads
// <dir>/tui (any of tui.ts, tui.tsx, tui.js, ...), so the install root carries a one-line tui.tsx
// that re-exports the real plugin under src/. The entry also switches off the built-in usage row
// (`-opencode.prompt.footer`), which repeats this line's cost and context numbers. The plugins
// list from before the install is saved next to the plugin, so uninstall can put it back.

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { type JsonObject, canOwn, installTree, readJsonObject, readMarker, removeTree, writeJsonObject } from "../../infrastructure/install-kit.ts";

export interface InstallOptions {
	home: string;
	env: Record<string, string | undefined>;
	/** The checkout or package root that holds `src/`. */
	sourceRoot: string;
	/** Plain glyphs instead of powerline ones. */
	plain: boolean;
	log: (line: string) => void;
	/** OpenCode config directory; default `$OPENCODE_CONFIG_DIR`, else `<home>/.config/opencode`. */
	configDir?: string;
}

export type UninstallOptions = Omit<InstallOptions, "sourceRoot" | "plain">;

const NAME = "oh-my-statusline";
const PACKAGE = `./${NAME}`;
const FOOTER = "-opencode.prompt.footer";
const ENTRY = 'export { default } from "./src/harnesses/opencode/tui.tsx";\n';

type Plugins = unknown[];

function paths(opts: UninstallOptions) {
	const config = opts.configDir || opts.env.OPENCODE_CONFIG_DIR || path.join(opts.home, ".config", "opencode");
	const dir = path.join(config, NAME);
	return { config, dir, cli: path.join(config, "cli.json"), previous: path.join(dir, "previous-plugins.json") };
}

/** This project's own plugin entry, as a bare string or an object with a `package`. */
function isOurs(plugin: unknown): boolean {
	if (typeof plugin === "string") return plugin === PACKAGE;
	return typeof plugin === "object" && plugin !== null && "package" in plugin && plugin.package === PACKAGE;
}

/** `cli.json`'s plugins as a list; absent or null is an empty list. Throws when it is anything else. */
function pluginsOf(cli: JsonObject, file: string): Plugins {
	const value = cli.plugins ?? [];
	if (!Array.isArray(value)) throw new Error(`${file} has a plugins entry that is not an array; fix it, or add the entry by hand.`);
	return value;
}

/** An executable named `name` in one of the PATH directories. */
function onPath(name: string, searchPath: string | undefined): boolean {
	return (searchPath ?? "").split(path.delimiter).some((entry) => entry !== "" && existsSync(path.join(entry, name)));
}

export function install(opts: InstallOptions): void {
	const { config, dir, cli: cliFile, previous } = paths(opts);
	const glyphs = opts.plain ? "plain" : "powerline";

	// Validate everything before touching anything: a refusal leaves the files as they were.
	if (!canOwn(dir)) throw new Error(`${dir} exists and was not installed by ${NAME}; move it away first.`);
	const cli = readJsonObject(cliFile);
	const plugins = pluginsOf(cli, cliFile);
	const first = !existsSync(previous);

	mkdirSync(config, { recursive: true });
	installTree(opts.sourceRoot, dir, "opencode", { "tui.tsx": ENTRY });
	if (first) {
		// First install here: remember what cli.json looked like before we touched it.
		if (existsSync(cliFile)) copyFileSync(cliFile, path.join(dir, "cli.json.bak"));
		writeFileSync(previous, `${JSON.stringify({ had: "plugins" in cli, plugins })}\n`);
	}

	// Drop our own plugin from any earlier install, keep the rest in order, and make sure the
	// built-in usage row is off. The plugin entry goes last.
	const kept = plugins.filter((plugin) => !isOurs(plugin));
	cli.plugins = [...kept, ...(kept.includes(FOOTER) ? [] : [FOOTER]), { package: PACKAGE, options: { glyphs } }];
	writeJsonObject(cliFile, cli);

	opts.log(`Installed ${NAME} to ${dir} (${glyphs} glyphs) and registered it in ${cliFile}.`);
	opts.log(`The previous plugins list is saved in ${previous}, and the file as it was in ${path.join(dir, "cli.json.bak")}.`);
	if (!onPath("opencode", opts.env.PATH)) opts.log("opencode is not on PATH; install it first: https://opencode.ai");
	opts.log("Restart opencode to load it.");
}

/** The record install saved: the plugins list from before, and whether the key existed at all. */
function readPrevious(file: string): { had: boolean; plugins: Plugins } | null {
	if (!existsSync(file)) return null;
	try {
		const record: unknown = JSON.parse(readFileSync(file, "utf8"));
		if (typeof record !== "object" || record === null || !("plugins" in record) || !Array.isArray(record.plugins)) return null;
		return { had: "had" in record ? record.had === true : record.plugins.length > 0, plugins: record.plugins };
	} catch {
		return null;
	}
}

export function uninstall(opts: UninstallOptions): void {
	const { config, dir, cli: cliFile, previous } = paths(opts);
	if (!existsSync(dir)) {
		opts.log(`${NAME} is not installed in ${config}.`);
		return;
	}
	if (readMarker(dir) === null) throw new Error(`${dir} was not installed by ${NAME}; leaving it alone.`);

	if (existsSync(cliFile)) {
		const cli = readJsonObject(cliFile);
		const current = pluginsOf(cli, cliFile);
		const saved = readPrevious(previous);
		let plugins: Plugins;
		if (saved) {
			// Take our plugin out, then put the saved list back without losing entries added since then.
			// The built-in usage row is only taken out again if we were the ones who turned it off.
			const restored = saved.plugins.filter((plugin) => !isOurs(plugin));
			const savedFooter = restored.includes(FOOTER);
			const kept = current.filter((plugin) => !isOurs(plugin)).filter((plugin) => plugin !== FOOTER || savedFooter);
			plugins = [...restored, ...kept.filter((plugin) => !restored.some((old) => isDeepStrictEqual(old, plugin)))];
			if (plugins.length === 0 && !saved.had) delete cli.plugins;
			else cli.plugins = plugins;
		} else {
			// No saved list (the marker survived, the record did not): just take our entries out.
			plugins = current.filter((plugin) => !isOurs(plugin) && plugin !== FOOTER);
			if (plugins.length === 0) delete cli.plugins;
			else cli.plugins = plugins;
		}
		writeJsonObject(cliFile, cli);
	}

	removeTree(dir);
	opts.log(`Removed ${dir} and its cli.json entries. Restart opencode to apply the change.`);
}
