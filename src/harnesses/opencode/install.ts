// Install oh-my-statusline into OpenCode: copy the runtime into <config>/oh-my-statusline and
// register it in cli.json, where the TUI loads plugins at startup.
//
// OpenCode resolves a `{ "package": "./oh-my-statusline" }` entry as a directory plugin: it loads
// <dir>/tui (any of tui.ts, tui.tsx, tui.js, ...), so the install root carries a one-line tui.tsx
// that re-exports the real plugin under src/. The entry also switches off the built-in usage row
// (`-opencode.prompt.footer`), which repeats this line's cost and context numbers. The plugins
// list from before the install is saved next to the plugin, so uninstall can put it back.
//
// A standalone opencode-statusline (`<config>/statusline/`, a `./statusline` plugin entry) is taken
// over: its entry is replaced by ours with its options kept, the plugins list it saved becomes ours,
// and its directory goes.

import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
	type JsonObject,
	backup,
	canOwn,
	holdsOnly,
	installTree,
	readJsonObject,
	readMarker,
	removeTree,
	runSteps,
	type Step,
	writeJsonObject,
} from "../../infrastructure/install-kit.ts";

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
	/** Print every step, write nothing. */
	dryRun?: boolean;
}

export type UninstallOptions = Omit<InstallOptions, "sourceRoot" | "plain">;

const NAME = "oh-my-statusline";
const PACKAGE = `./${NAME}`;
const FOOTER = "-opencode.prompt.footer";
const ENTRY = 'export { default } from "./src/harnesses/opencode/tui.tsx";\n';

/** What the standalone opencode-statusline installs: its directory, plugin entry, marker and files. */
const LEGACY_PACKAGE = "./statusline";
const LEGACY_MARKER = ".opencode-statusline";
const LEGACY_FILES = [LEGACY_MARKER, "tui.tsx", "render.ts", "previous-plugins.json", "cli.json.bak"];

type Plugins = unknown[];

/** `<config dir>/oh-my-statusline`; the config dir is `$OPENCODE_CONFIG_DIR`, else `<home>/.config/opencode`. */
export function opencodeInstallDir(opts: Pick<InstallOptions, "home" | "env" | "configDir">): string {
	return paths(opts).dir;
}

function paths(opts: Pick<InstallOptions, "home" | "env" | "configDir">) {
	const config = opts.configDir || opts.env.OPENCODE_CONFIG_DIR || path.join(opts.home, ".config", "opencode");
	const dir = path.join(config, NAME);
	return { config, dir, cli: path.join(config, "cli.json"), previous: path.join(dir, "previous-plugins.json"), legacy: path.join(config, "statusline") };
}

/** This project's own plugin entry, as a bare string or an object with a `package`. */
function isOurs(plugin: unknown): boolean {
	if (typeof plugin === "string") return plugin === PACKAGE;
	return typeof plugin === "object" && plugin !== null && "package" in plugin && plugin.package === PACKAGE;
}

/** The standalone project's plugin entry, as a bare string or an object with a `package`. */
function isLegacy(plugin: unknown): boolean {
	if (typeof plugin === "string") return plugin === LEGACY_PACKAGE;
	return typeof plugin === "object" && plugin !== null && "package" in plugin && plugin.package === LEGACY_PACKAGE;
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
	const { config, dir, cli: cliFile, previous, legacy } = paths(opts);

	// Validate everything before touching anything: a refusal leaves the files as they were.
	if (!canOwn(dir)) throw new Error(`${dir} exists and was not installed by ${NAME}; move it away first.`);
	const cli = readJsonObject(cliFile);
	const plugins = pluginsOf(cli, cliFile);
	const first = !existsSync(previous);
	const old = existsSync(path.join(legacy, LEGACY_MARKER));
	const oldEntries = old ? plugins.filter(isLegacy) : [];
	const oldOptions = oldEntries.map((entry) => (entry as { options?: unknown }).options).find((value) => typeof value === "object" && value !== null && !Array.isArray(value)) as JsonObject | undefined;
	// Glyphs the old install used stay, unless this run asks for plain ones.
	const glyphs = opts.plain || oldOptions?.glyphs === "plain" ? "plain" : "powerline";

	const steps: Step[] = [
		{ say: `copy the plugin into ${dir} (${glyphs} glyphs)`, run: () => {
			mkdirSync(config, { recursive: true });
			installTree(opts.sourceRoot, dir, "opencode", { "tui.tsx": ENTRY });
		} },
	];
	if (first) {
		if (old) {
			// The old install saved the list from before it: that is the user's real previous list.
			const saved = readPrevious(path.join(legacy, "previous-plugins.json"));
			const record = saved
				? { had: saved.had, plugins: saved.plugins.filter((plugin) => !isLegacy(plugin) && !isOurs(plugin)) }
				: { had: "plugins" in cli, plugins: plugins.filter((plugin) => !isLegacy(plugin) && !isOurs(plugin) && plugin !== FOOTER) };
			const oldBackup = path.join(legacy, "cli.json.bak");
			steps.push({
				say: `keep the plugins list from before the old install as ${previous}${existsSync(oldBackup) ? ` and its cli.json.bak as ${path.join(dir, "cli.json.bak")}` : ""}`,
				run: () => {
					if (existsSync(oldBackup)) copyFileSync(oldBackup, path.join(dir, "cli.json.bak"));
					else if (existsSync(cliFile)) copyFileSync(cliFile, path.join(dir, "cli.json.bak"));
					writeFileSync(previous, `${JSON.stringify(record)}\n`);
				},
				legacy: true,
			});
		} else {
			// First install here: remember what cli.json looked like before we touched it.
			steps.push({
				say: `save the plugins list and a copy of cli.json in ${dir}`,
				run: () => {
					if (existsSync(cliFile)) copyFileSync(cliFile, path.join(dir, "cli.json.bak"));
					writeFileSync(previous, `${JSON.stringify({ had: "plugins" in cli, plugins })}\n`);
				},
			});
		}
	}

	// Drop our own plugin from any earlier install (and the old install's), keep the rest in order, and
	// make sure the built-in usage row is off. The plugin entry goes last, with the old options kept.
	const kept = plugins.filter((plugin) => !isOurs(plugin) && !(old && isLegacy(plugin)));
	steps.push({
		say: `${oldEntries.length > 0 ? `replace the old ${LEGACY_PACKAGE} entry with ${PACKAGE}` : `register ${PACKAGE}`} in ${cliFile} (backed up first)`,
		run: () => {
			backup(cliFile);
			cli.plugins = [...kept, ...(kept.includes(FOOTER) ? [] : [FOOTER]), { package: PACKAGE, options: { ...oldOptions, glyphs } }];
			writeJsonObject(cliFile, cli);
		},
		legacy: oldEntries.length > 0,
	});
	if (old) {
		if (holdsOnly(legacy, LEGACY_FILES, [LEGACY_MARKER])) {
			steps.push({ say: `remove the old install ${legacy}`, run: () => rmSync(legacy, { recursive: true, force: true }), legacy: true });
		} else opts.log(`${legacy} holds files that are not part of opencode-statusline; left it in place.`);
	}

	runSteps(steps, opts);
	if (opts.dryRun) return;
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

	const steps: Step[] = [];
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
		steps.push({
			say: `take ${PACKAGE} out of ${cliFile} and put the saved plugins list back (backed up first)`,
			run: () => {
				backup(cliFile);
				writeJsonObject(cliFile, cli);
			},
		});
	}
	steps.push({ say: `remove ${dir}`, run: () => void removeTree(dir) });
	runSteps(steps, opts);
	if (!opts.dryRun) opts.log(`Removed ${dir} and its cli.json entries. Restart opencode to apply the change.`);
}
