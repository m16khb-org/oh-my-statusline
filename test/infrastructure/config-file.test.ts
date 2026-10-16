import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { defaultConfigPath, readConfigFile } from "../../src/infrastructure/config-file.ts";

let tmp: string;
beforeEach(() => {
	tmp = mkdtempSync(path.join(tmpdir(), "oms-cfg-"));
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

test("defaultConfigPath", () => {
	expect(defaultConfigPath({ XDG_CONFIG_HOME: "/x" })).toBe("/x/oh-my-statusline/config.toml");
	expect(defaultConfigPath({ HOME: "/h" })).toBe("/h/.config/oh-my-statusline/config.toml");
});
test("missing, valid and corrupt", () => {
	const f = path.join(tmp, "config.toml");
	expect(readConfigFile(f)).toBeNull();
	writeFileSync(f, 'theme = "dark"\n[a]\nb = 1\n');
	expect(readConfigFile(f)).toEqual({ raw: { theme: "dark", a: { b: 1 } } });
	writeFileSync(f, "theme = = =\n");
	const r = readConfigFile(f);
	expect(r && "error" in r && r.error.length > 0).toBe(true);
});
