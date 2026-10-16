// Ported from opencode-statusline test/render.test.ts › options.
import { describe, expect, test } from "bun:test";
import { readOptions } from "../../../src/harnesses/opencode/options.ts";

describe("options", () => {
	test("defaults match the document, and cli.json can override them", () => {
		expect(readOptions()).toEqual({
			theme: "dark",
			glyphs: "powerline",
			colors: 24,
			model: true,
			effort: true,
			dir: true,
			git: true,
			lines: true,
			counts: true,
			subagents: true,
			cost: true,
			elapsed: true,
			context: true,
			home: true,
			minimumWidth: 44,
			reserve: 16,
			interval: 4000,
			demo: false,
		});
		expect(readOptions({ glyphs: "plain", minimumWidth: 60, interval: 1000, context: false })).toMatchObject({
			glyphs: "plain",
			minimumWidth: 60,
			interval: 1000,
			context: false,
		});
		expect(readOptions({ glyphs: "fancy", minimumWidth: "wide" })).toMatchObject({ glyphs: "powerline", minimumWidth: 44 });
		expect(readOptions({}, "light").theme).toBe("light");
	});

	test("every switch takes a boolean only, and every number a finite number", () => {
		const off = readOptions({ model: false, effort: false, dir: false, git: false, lines: false, counts: false, cost: false, elapsed: false, context: false, home: false, demo: true });
		expect(off).toMatchObject({ model: false, effort: false, dir: false, git: false, lines: false, counts: false, cost: false, elapsed: false, context: false, home: false, demo: true });
		expect(readOptions({ model: "no", git: 0, demo: "yes", reserve: Number.NaN, interval: Number.POSITIVE_INFINITY })).toMatchObject({
			model: true,
			git: true,
			demo: false,
			reserve: 16,
			interval: 4000,
		});
	});

	test("the theme is not a cli.json option", () => {
		expect(readOptions({ theme: "light" }).theme).toBe("dark");
	});

	test("the shared config (config.toml, STATUSLINE_*, NO_COLOR) wins over cli.json's installed glyphs", () => {
		expect(readOptions({ glyphs: "plain" }, "dark", { glyphs: "ascii", colors: 0, subagents: false })).toMatchObject({
			glyphs: "ascii",
			colors: 0,
			subagents: false,
		});
		expect(readOptions({ glyphs: "ascii" }).glyphs).toBe("ascii");
	});
});
