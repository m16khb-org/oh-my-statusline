// Install into / remove from Claude Code: copy the runtime into `<config>/oh-my-statusline` and
// point the `statusLine` and `subagentStatusLine` entries of settings.json at it. The entries it
// replaces are saved next to the runtime (once, and never an entry that is already ours), and
// uninstall puts them back unless the user has changed them since.
//
// A standalone claude-code-statusline install (`<config>/claude-code-statusline/`, settings.json
// commands that run its statusline.sh) is taken over: its saved entries are the user's real previous
// settings, so they become ours, and its directory goes once settings.json points at us.

import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
	backup,
	canOwn,
	holdsOnly,
	installTree,
	type JsonObject,
	readJsonObject,
	removeTree,
	runSteps,
	type Step,
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
	/** Print every step, write nothing. */
	dryRun?: boolean;
}

export type ClaudeUninstallOptions = Pick<ClaudeInstallOptions, "home" | "env" | "log" | "dryRun">;

/** What settings.json entries of ours always contain. */
const OUR_COMMAND = "oh-my-statusline/src/harnesses/claude/main.ts";
const REFRESH_INTERVAL_SECONDS = 30;

/** What the standalone claude-code-statusline writes: its directory name, command, and saved files. */
const LEGACY_DIR = "claude-code-statusline";
const LEGACY_COMMAND = `${LEGACY_DIR}/statusline.sh`;
const LEGACY_FILES = ["statusline.sh", "previous-statusline.json", "previous-subagent-statusline.json"];

/** Entry key in settings.json and the file that keeps what it replaced. */
const ENTRIES = [
	{ key: "statusLine", previous: "previous-statusline.json" },
	{ key: "subagentStatusLine", previous: "previous-subagent-statusline.json" },
] as const;

/** `<config dir>/oh-my-statusline`; the config dir is `$CLAUDE_CONFIG_DIR`, else `<home>/.claude`. */
export function claudeInstallDir(opts: Pick<ClaudeInstallOptions, "home" | "env">): string {
	return paths(opts).dir;
}

function paths(opts: Pick<ClaudeInstallOptions, "home" | "env">) {
	const config = opts.env.CLAUDE_CONFIG_DIR || path.join(opts.home, ".claude");
	return {
		config,
		dir: path.join(config, "oh-my-statusline"),
		legacy: path.join(config, LEGACY_DIR),
		settings: path.join(config, "settings.json"),
	};
}

const commandOf = (entry: unknown): string => {
	const command = (entry as { command?: unknown } | null)?.command;
	return typeof command === "string" ? command : "";
};
const isOurs = (entry: unknown) => commandOf(entry).includes(OUR_COMMAND);
const isLegacy = (entry: unknown) => commandOf(entry).includes(LEGACY_COMMAND);

/** A double-quoted shell word. */
const quote = (word: string) => `"${word.replace(/[\\"$`]/g, "\\$&")}"`;

/** The entry the old install saved: the user's true previous one; null when none or when it was an old/new entry itself. */
function legacySaved(file: string): unknown {
	if (!existsSync(file)) return null;
	let value: unknown;
	try {
		value = JSON.parse(readFileSync(file, "utf8"));
	} catch {
		throw new Error(`${file} is not valid JSON; fix or delete it, then install again.`);
	}
	return isLegacy(value) || isOurs(value) ? null : value;
}

export function install(opts: ClaudeInstallOptions): void {
	const { dir, legacy, settings: settingsFile } = paths(opts);
	// Everything that can refuse runs before anything is written.
	const settings = readJsonObject(settingsFile);
	if (!canOwn(dir)) throw new Error(`${dir} exists and was not installed by oh-my-statusline; move it away first.`);

	const steps: Step[] = [{ say: `copy the runtime into ${dir}`, run: () => void installTree(opts.sourceRoot, dir, "claude") }];

	// Keep each entry being replaced, unless it is already ours (a reinstall or an upgrade). An entry
	// of the old install is replaced by what the old install saved: the settings from before it.
	let plain = opts.plain;
	for (const { key, previous } of ENTRIES) {
		const file = path.join(dir, previous);
		const current = settings[key] ?? null;
		if (isLegacy(current) && commandOf(current).includes("STATUSLINE_GLYPHS=plain")) plain = true;
		if (existsSync(file)) continue;
		const migrated = isLegacy(current);
		const value = migrated ? legacySaved(path.join(legacy, previous)) : isOurs(current) ? null : current;
		steps.push({
			say: migrated
				? `keep what the old install saved (${value === null ? "no entry" : "an entry"}) as the previous ${key} in ${file}`
				: `save the previous ${key} to ${file}`,
			run: () => writeFileSync(file, `${JSON.stringify(value)}\n`),
			legacy: migrated,
		});
	}

	const main = path.join(dir, "src", "harnesses", "claude", "main.ts");
	const command = `${plain ? "STATUSLINE_GLYPHS=plain " : ""}${quote(process.execPath)} ${quote(main)}`;
	const switched = ENTRIES.filter(({ key }) => isLegacy(settings[key]));
	let saved: string | null = null;
	steps.push({
		say: `back up ${settingsFile}, then point statusLine and subagentStatusLine at ${main}`,
		run: () => {
			saved = backup(settingsFile);
			const next: JsonObject = {
				...settings,
				statusLine: { type: "command", command, refreshInterval: REFRESH_INTERVAL_SECONDS },
				subagentStatusLine: { type: "command", command: `${command} --subagents` },
			};
			writeJsonObject(settingsFile, next);
		},
	});
	if (switched.length > 0) {
		opts.log(`Found the standalone claude-code-statusline in ${settingsFile}: ${switched.map(({ key }) => key).join(", ")} will switch to oh-my-statusline.`);
	}

	// The old directory goes last, once settings.json points at us and nothing in it is foreign.
	if (existsSync(legacy)) {
		if (holdsOnly(legacy, LEGACY_FILES, ["statusline.sh"])) {
			steps.push({ say: `remove the old install ${legacy}`, run: () => rmSync(legacy, { recursive: true, force: true }), legacy: true });
		} else opts.log(`${legacy} holds files that are not part of claude-code-statusline; left it in place.`);
	}

	runSteps(steps, opts);
	if (opts.dryRun) return;
	opts.log(`Installed ${dir}`);
	opts.log(`Updated statusLine and subagentStatusLine in ${settingsFile}${saved ? ` (backup: ${saved})` : ""}`);
}

export function uninstall(opts: ClaudeUninstallOptions): void {
	const { dir, settings: settingsFile } = paths(opts);
	const settings = readJsonObject(settingsFile);

	const restored: string[] = [];
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
		if (before === null) delete settings[key];
		else settings[key] = before;
		restored.push(key);
	}

	const steps: Step[] = [];
	if (restored.length > 0) {
		steps.push({
			say: `back up ${settingsFile}, then restore the previous ${restored.join(" and ")}`,
			run: () => {
				const saved = backup(settingsFile);
				writeJsonObject(settingsFile, settings);
				for (const key of restored) opts.log(`Restored the previous ${key} in ${settingsFile}${saved ? ` (backup: ${saved})` : ""}`);
			},
		});
	}
	steps.push({
		say: `remove ${dir} (only when oh-my-statusline installed it)`,
		run: () => opts.log(removeTree(dir) ? `Removed ${dir}` : `${dir} is absent or was not installed by oh-my-statusline; left it in place.`),
	});
	runSteps(steps, opts);
}
