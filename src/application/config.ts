// Configuration: the model, and the pure resolution of its layers. Reading the TOML file and
// the environment is infrastructure's job; this module only merges what it is handed.
// Precedence, lowest to highest: defaults < install choices < file top level < file
// [harness.<id>] < env < flags.

import type { HarnessId } from "../domain/model/snapshot.ts";
import type { ColorMode, GlyphMode } from "../domain/render/cells.ts";

export interface Config {
	theme: "auto" | "dark" | "light";
	glyphs: GlyphMode;
	colors: "auto" | "truecolor" | "256" | "none";
	chips: { ssh: boolean; tmux: boolean; venv: boolean; k8s: boolean };
	stats: { chip: boolean };
	pr: { enabled: boolean };
	subagents: boolean;
}

/** A partial config, as flags provide it. */
export interface ConfigOverrides {
	theme?: Config["theme"];
	glyphs?: Config["glyphs"];
	colors?: Config["colors"];
	chips?: Partial<Config["chips"]>;
	stats?: Partial<Config["stats"]>;
	pr?: Partial<Config["pr"]>;
	subagents?: boolean;
}

export type ConfigFile = { raw: unknown } | { error: string };

export interface ResolveInput {
	harness: HarnessId;
	/** Choices the installer recorded (e.g. `--plain`); the config file and above override them. */
	installed?: ConfigOverrides;
	/** null when there is no config file. */
	file: ConfigFile | null;
	env: Record<string, string | undefined>;
	flags: ConfigOverrides;
}

export const DEFAULT_CONFIG: Config = {
	theme: "auto",
	glyphs: "powerline",
	colors: "auto",
	chips: { ssh: true, tmux: true, venv: true, k8s: false },
	stats: { chip: false },
	pr: { enabled: true },
	subagents: true,
};

const CHOICES: Record<"theme" | "glyphs" | "colors", readonly string[]> = {
	theme: ["auto", "dark", "light"],
	glyphs: ["powerline", "plain", "ascii"],
	colors: ["auto", "truecolor", "24bit", "256", "none"],
};

const ENV_NAMES: Record<string, string> = {
	theme: "STATUSLINE_THEME",
	glyphs: "STATUSLINE_GLYPHS",
	colors: "STATUSLINE_COLORS",
};

type Section = "chips" | "stats" | "pr";
const SECTIONS: Record<Section, readonly string[]> = {
	chips: ["ssh", "tmux", "venv", "k8s"],
	stats: ["chip"],
	pr: ["enabled"],
};

const isTable = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Merge one layer into `config`. Each invalid entry is skipped and reported as
 * `invalid <where(key)>: <value>`; the rest of the layer still applies.
 */
function applyLayer(
	config: Config,
	layer: Record<string, unknown>,
	where: (key: string) => string,
	warnings: string[],
): void {
	const reject = (key: string, value: unknown): void => {
		warnings.push(`invalid ${where(key)}: ${JSON.stringify(value) ?? String(value)}`);
	};
	for (const key of ["theme", "glyphs", "colors"] as const) {
		const value = layer[key];
		if (value === undefined) continue;
		if (typeof value !== "string" || !CHOICES[key].includes(value)) reject(key, value);
		else (config as unknown as Record<string, string>)[key] = value === "24bit" ? "truecolor" : value;
	}
	if (layer.subagents !== undefined) {
		if (typeof layer.subagents === "boolean") config.subagents = layer.subagents;
		else reject("subagents", layer.subagents);
	}
	for (const section of Object.keys(SECTIONS) as Section[]) {
		const table = layer[section];
		if (table === undefined) continue;
		if (!isTable(table)) {
			reject(section, table);
			continue;
		}
		for (const key of SECTIONS[section]) {
			const value = table[key];
			if (value === undefined) continue;
			if (typeof value === "boolean") (config[section] as Record<string, boolean>)[key] = value;
			else reject(`${section}.${key}`, value);
		}
	}
}

function fileLayers(
	file: ConfigFile | null,
	harness: HarnessId,
	warnings: string[],
): { top: Record<string, unknown>; harness: Record<string, unknown> } {
	const none = { top: {}, harness: {} };
	if (file === null) return none;
	if ("error" in file) {
		warnings.push(`config file ignored: ${file.error}`);
		return none;
	}
	if (!isTable(file.raw)) {
		warnings.push("config file ignored: the top level is not a table");
		return none;
	}
	const raw = file.raw;
	let own: Record<string, unknown> = {};
	if (raw.harness !== undefined) {
		if (!isTable(raw.harness)) warnings.push("invalid harness in config file: expected a table of [harness.<id>] tables");
		else {
			const table = raw.harness[harness];
			if (isTable(table)) own = table;
			else if (table !== undefined) warnings.push(`invalid harness.${harness} in config file: expected a table`);
		}
	}
	return { top: raw, harness: own };
}

export function resolveConfig(input: ResolveInput): { config: Config; warnings: string[] } {
	const warnings: string[] = [];
	const config = structuredClone(DEFAULT_CONFIG);
	applyLayer(config, { ...input.installed }, (key) => `${key} in install choices`, warnings);
	const file = fileLayers(input.file, input.harness, warnings);
	applyLayer(config, file.top, (key) => `${key} in config file`, warnings);
	applyLayer(config, file.harness, (key) => `${key} in config file [harness.${input.harness}]`, warnings);
	const env: Record<string, unknown> = {};
	for (const [key, name] of Object.entries(ENV_NAMES)) if (input.env[name]) env[key] = input.env[name];
	applyLayer(config, env, (key) => `${ENV_NAMES[key] ?? key} in environment`, warnings);
	applyLayer(config, { ...input.flags }, (key) => `${key} in flags`, warnings);
	return { config, warnings };
}

/**
 * The ANSI depth to draw with: 0 (no SGR at all) when NO_COLOR is set and non-empty, which wins
 * over everything (https://no-color.org) or when colors = "none"; else an explicit choice, else
 * what COLORTERM advertises.
 */
export function colorDepth(config: Config, env: Record<string, string | undefined>): ColorMode {
	if (env.NO_COLOR || config.colors === "none") return 0;
	if (config.colors === "truecolor") return 24;
	if (config.colors === "256") return 256;
	return env.COLORTERM === "truecolor" || env.COLORTERM === "24bit" ? 24 : 256;
}
