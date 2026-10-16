// Install into / remove from Claude Code: copy the runtime into `<config>/oh-my-statusline` and
// point the `statusLine` and `subagentStatusLine` entries of settings.json at it. The entries it
// replaces are saved next to the runtime (once, and never an entry that is already ours), and
// uninstall puts them back unless the user has changed them since.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
	backup,
	canOwn,
	installTree,
	type JsonObject,
	readJsonObject,
	removeTree,
	writeJsonObject,
} from "../../infrastructure/install-kit.ts";

export interface ClaudeInstallOptions {
	home: string;
	env: Record<string, string | undefined>;
	/** The repository root that holds `src/`. */
	sourceRoot: string;
	/** Use plain glyphs instead of the private-use powerline ones. */
	plain: boolean;
	log: (line: string) => void;
}

/** What settings.json entries of ours always contain. */
const OUR_COMMAND = "oh-my-statusline/src/harnesses/claude/main.ts";
const REFRESH_INTERVAL_SECONDS = 30;

/** Entry key in settings.json and the file that keeps what it replaced. */
const ENTRIES = [
	{ key: "statusLine", previous: "previous-statusline.json" },
	{ key: "subagentStatusLine", previous: "previous-subagent-statusline.json" },
] as const;

function paths(opts: Pick<ClaudeInstallOptions, "home" | "env">) {
	const config = opts.env.CLAUDE_CONFIG_DIR || path.join(opts.home, ".claude");
	return { config, dir: path.join(config, "oh-my-statusline"), settings: path.join(config, "settings.json") };
}

const isOurs = (entry: unknown) => {
	const command = (entry as { command?: unknown } | null)?.command;
	return typeof command === "string" && command.includes(OUR_COMMAND);
};

/** A double-quoted shell word. */
const quote = (word: string) => `"${word.replace(/[\\"$`]/g, "\\$&")}"`;

export function install(opts: ClaudeInstallOptions): void {
	const { dir, settings: settingsFile } = paths(opts);
	// Everything that can refuse runs before anything is written.
	const settings = readJsonObject(settingsFile);
	if (!canOwn(dir)) throw new Error(`${dir} exists and was not installed by oh-my-statusline; move it away first.`);

	installTree(opts.sourceRoot, dir, "claude");

	// Keep each entry being replaced, unless it is already ours (a reinstall or an upgrade).
	for (const { key, previous } of ENTRIES) {
		const file = path.join(dir, previous);
		if (existsSync(file)) continue;
		const current = settings[key] ?? null;
		writeFileSync(file, `${JSON.stringify(isOurs(current) ? null : current)}\n`);
	}

	const main = path.join(dir, "src", "harnesses", "claude", "main.ts");
	const command = `${opts.plain ? "STATUSLINE_GLYPHS=plain " : ""}${quote(process.execPath)} ${quote(main)}`;
	const saved = backup(settingsFile);
	const next: JsonObject = {
		...settings,
		statusLine: { type: "command", command, refreshInterval: REFRESH_INTERVAL_SECONDS },
		subagentStatusLine: { type: "command", command: `${command} --subagents` },
	};
	writeJsonObject(settingsFile, next);

	opts.log(`Installed ${dir}`);
	opts.log(`Updated statusLine and subagentStatusLine in ${settingsFile}${saved ? ` (backup: ${saved})` : ""}`);
}

export function uninstall(opts: Pick<ClaudeInstallOptions, "home" | "env" | "log">): void {
	const { dir, settings: settingsFile } = paths(opts);
	const settings = readJsonObject(settingsFile);

	let saved: string | null | undefined;
	let changed = false;
	for (const { key, previous } of ENTRIES) {
		if (!isOurs(settings[key])) {
			opts.log(`The ${key} in ${settingsFile} does not point at oh-my-statusline; left it unchanged.`);
			continue;
		}
		const file = path.join(dir, previous);
		let before: unknown = null;
		if (existsSync(file)) {
			try {
				before = JSON.parse(readFileSync(file, "utf8"));
			} catch {
				throw new Error(`${file} is not valid JSON; fix or delete it, then run uninstall again.`);
			}
		}
		saved ??= backup(settingsFile);
		if (before === null) delete settings[key];
		else settings[key] = before;
		changed = true;
		opts.log(`Restored the previous ${key} in ${settingsFile}${saved ? ` (backup: ${saved})` : ""}`);
	}
	if (changed) writeJsonObject(settingsFile, settings);

	opts.log(removeTree(dir) ? `Removed ${dir}` : `${dir} is absent or was not installed by oh-my-statusline; left it in place.`);
}
