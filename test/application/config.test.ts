import { describe, expect, test } from "bun:test";
import { colorDepth, DEFAULT_CONFIG, resolveConfig } from "../../src/application/config.ts";

const FILE = {
	raw: {
		theme: "light",
		glyphs: "plain",
		chips: { k8s: true },
		harness: { omp: { theme: "dark", subagents: false, stats: { chip: true } } },
	},
};

describe("resolveConfig", () => {
	test("defaults when nothing is given", () => {
		const { config, warnings } = resolveConfig({ harness: "omp", file: null, env: {}, flags: {} });
		expect(config).toEqual({
			theme: "auto",
			glyphs: "powerline",
			colors: "auto",
			chips: { ssh: true, tmux: true, venv: true, k8s: false },
			stats: { chip: false },
			pr: { enabled: true },
			subagents: true,
		});
		expect(warnings).toEqual([]);
	});

	test("install choices sit between the defaults and the config file", () => {
		const installed = { glyphs: "plain" as const, colors: "truecolor" as const };
		expect(resolveConfig({ harness: "codex", installed, file: null, env: {}, flags: {} }).config).toMatchObject(installed);
		const file = { raw: { glyphs: "ascii" } };
		expect(resolveConfig({ harness: "codex", installed, file, env: {}, flags: {} }).config.glyphs).toBe("ascii");
		expect(resolveConfig({ harness: "codex", installed, file, env: { STATUSLINE_COLORS: "256" }, flags: {} }).config.colors).toBe("256");
		// A corrupt config file keeps the install choices.
		expect(resolveConfig({ harness: "codex", installed, file: { error: "bad" }, env: {}, flags: {} }).config.glyphs).toBe("plain");
	});

	test("precedence: default < file < harness table < env < flags, invalid values ignored", () => {
		const resolve = (harness: "omp" | "claude", env: Record<string, string>, flags = {}) =>
			resolveConfig({ harness, file: FILE, env, flags });

		// file top level over defaults
		const file = resolve("claude", {});
		expect(file.config).toMatchObject({ theme: "light", glyphs: "plain", chips: { ssh: true, k8s: true }, subagents: true });
		expect(file.warnings).toEqual([]);

		// the harness table over the file top level, for that harness only
		const own = resolve("omp", {});
		expect(own.config).toMatchObject({ theme: "dark", glyphs: "plain", subagents: false, stats: { chip: true } });
		expect(resolve("claude", {}).config.subagents).toBe(true);

		// env over file
		const env = resolve("omp", { STATUSLINE_THEME: "auto", STATUSLINE_GLYPHS: "powerline", STATUSLINE_COLORS: "24bit" });
		expect(env.config).toMatchObject({ theme: "auto", glyphs: "powerline", colors: "truecolor" });

		// flags over env
		const flag = resolve("omp", { STATUSLINE_THEME: "light" }, { theme: "dark", chips: { ssh: false } });
		expect(flag.config).toMatchObject({ theme: "dark", chips: { ssh: false, tmux: true, k8s: true } });

		// invalid env value ignored with a warning naming key and source; the file value survives
		const bad = resolve("claude", { STATUSLINE_THEME: "neon" });
		expect(bad.config.theme).toBe("light");
		expect(bad.warnings).toEqual(['invalid STATUSLINE_THEME in environment: "neon"']);
	});

	test("pr.enabled: on by default; file, harness table and flags switch it, invalid values are skipped", () => {
		const resolve = (raw: unknown, flags = {}) => resolveConfig({ harness: "codex", file: { raw }, env: {}, flags });
		expect(resolve({}).config.pr).toEqual({ enabled: true });
		expect(resolve({ pr: { enabled: false } }).config.pr.enabled).toBe(false);
		expect(resolve({ pr: { enabled: false }, harness: { codex: { pr: { enabled: true } } } }).config.pr.enabled).toBe(true);
		expect(resolve({ pr: { enabled: false } }, { pr: { enabled: true } }).config.pr.enabled).toBe(true);
		const bad = resolve({ pr: { enabled: "no" } });
		expect(bad.config.pr.enabled).toBe(true);
		expect(bad.warnings).toEqual(['invalid pr.enabled in config file: "no"']);
	});

	test("invalid file values are skipped one by one", () => {
		const { config, warnings } = resolveConfig({
			harness: "codex",
			file: {
				raw: { theme: 3, glyphs: "plain", chips: { ssh: "yes", tmux: false }, stats: 1, harness: { codex: { colors: "rgb" } } },
			},
			env: {},
			flags: {},
		});
		expect(config).toMatchObject({ theme: "auto", glyphs: "plain", colors: "auto", chips: { ssh: true, tmux: false } });
		expect(warnings).toEqual([
			"invalid theme in config file: 3",
			'invalid chips.ssh in config file: "yes"',
			"invalid stats in config file: 1",
			'invalid colors in config file [harness.codex]: "rgb"',
		]);
	});

	test("a corrupt config file gives defaults and one warning", () => {
		const { config, warnings } = resolveConfig({
			harness: "omp",
			file: { error: "unexpected token at line 3" },
			env: {},
			flags: {},
		});
		expect(config).toEqual(DEFAULT_CONFIG);
		expect(warnings).toEqual(["config file ignored: unexpected token at line 3"]);
	});

	test("a file that is not a table is ignored with a warning", () => {
		const { config, warnings } = resolveConfig({ harness: "omp", file: { raw: [1] }, env: {}, flags: {} });
		expect(config).toEqual(DEFAULT_CONFIG);
		expect(warnings).toHaveLength(1);
	});

	test("never mutates the defaults", () => {
		resolveConfig({ harness: "omp", file: { raw: { chips: { ssh: false } } }, env: {}, flags: {} });
		expect(DEFAULT_CONFIG.chips.ssh).toBe(true);
	});
});

describe("colorDepth", () => {
	const auto = DEFAULT_CONFIG;
	test("explicit choices win over COLORTERM", () => {
		expect(colorDepth({ ...auto, colors: "truecolor" }, {})).toBe(24);
		expect(colorDepth({ ...auto, colors: "256" }, { COLORTERM: "truecolor" })).toBe(256);
	});
	test("auto follows COLORTERM", () => {
		expect(colorDepth(auto, { COLORTERM: "truecolor" })).toBe(24);
		expect(colorDepth(auto, { COLORTERM: "24bit" })).toBe(24);
		expect(colorDepth(auto, { COLORTERM: "yes" })).toBe(256);
		expect(colorDepth(auto, {})).toBe(256);
	});
	test("colors = none draws no color", () => {
		expect(colorDepth({ ...auto, colors: "none" }, { COLORTERM: "truecolor" })).toBe(0);
		expect(resolveConfig({ harness: "omp", file: null, env: { STATUSLINE_COLORS: "none" }, flags: {} }).config.colors).toBe("none");
	});
	test("a non-empty NO_COLOR wins over every color setting", () => {
		expect(colorDepth(auto, { NO_COLOR: "1", COLORTERM: "truecolor" })).toBe(0);
		expect(colorDepth({ ...auto, colors: "truecolor" }, { NO_COLOR: "1" })).toBe(0);
		expect(colorDepth({ ...auto, colors: "256" }, { NO_COLOR: "yes" })).toBe(0);
	});
	test("an empty NO_COLOR is ignored", () => {
		expect(colorDepth({ ...auto, colors: "truecolor" }, { NO_COLOR: "" })).toBe(24);
	});
	test("glyphs = ascii is accepted from every layer", () => {
		expect(resolveConfig({ harness: "omp", file: null, env: { STATUSLINE_GLYPHS: "ascii" }, flags: {} }).config.glyphs).toBe("ascii");
		expect(resolveConfig({ harness: "omp", file: { raw: { glyphs: "ascii" } }, env: {}, flags: {} }).config.glyphs).toBe("ascii");
	});
});
