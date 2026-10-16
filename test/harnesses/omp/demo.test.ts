import { expect, test } from "bun:test";
import path from "node:path";
import { demoRows } from "../../../src/harnesses/omp/main.ts";

const MAIN = path.join(import.meta.dir, "..", "..", "..", "src", "harnesses", "omp", "main.ts");

test("--demo prints the omp demo case as two rows, without omp", () => {
	const proc = Bun.spawnSync(["bun", MAIN, "--demo"], { stdout: "pipe", env: { ...process.env, NO_COLOR: "1", COLUMNS: "160", STATUSLINE_GLYPHS: "plain" } });
	expect(proc.exitCode).toBe(0);
	const rows = proc.stdout.toString().trimEnd().split("\n");
	expect(rows).toHaveLength(2);
	expect(rows[0]).toContain("GPT-5.5");
	expect(rows[1]).toStartWith("ctx ");
});

test("the demo rows follow the configuration of the environment", () => {
	const rows = demoRows({ STATUSLINE_GLYPHS: "powerline", STATUSLINE_COLORS: "truecolor", XDG_CONFIG_HOME: "/nonexistent" }, 160);
	expect(rows).toHaveLength(2);
	expect(rows[0]).toContain("\ue0b0");
	expect(rows.every((r) => r.endsWith("\x1b[0m"))).toBe(true);
});
