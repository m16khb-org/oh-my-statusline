import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { backup, canOwn, installTree, MARKER, readJsonObject, readMarker, removeTree, sha256, writeJsonObject } from "../../src/infrastructure/install-kit.ts";

let root: string;
let source: string;

beforeEach(() => {
	root = mkdtempSync(path.join(tmpdir(), "oms-kit-"));
	source = path.join(root, "repo");
	mkdirSync(path.join(source, "src", "domain"), { recursive: true });
	writeFileSync(path.join(source, "src", "domain", "a.ts"), "export const a = 1;\n");
	writeFileSync(path.join(source, "src", "index.ts"), "export const v = 1;\n");
	writeFileSync(path.join(source, "package.json"), "{}\n");
	writeFileSync(path.join(source, "README.md"), "not installed\n");
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("installTree", () => {
	test("copies src, package.json and extra files, and records each checksum in the marker", () => {
		const dest = path.join(root, "home", "dest");
		const marker = installTree(source, dest, "claude", { "config.json": '{"glyphs":"plain"}\n' });
		expect(Object.keys(marker.files).sort()).toEqual(["config.json", "package.json", "src/domain/a.ts", "src/index.ts"]);
		expect(existsSync(path.join(dest, "README.md"))).toBe(false);
		expect(readMarker(dest)).toEqual(marker);
		expect(marker.files["src/index.ts"]).toBe(sha256(path.join(dest, "src", "index.ts")));
	});

	test("refuses a directory someone else owns, and leaves it untouched", () => {
		const dest = path.join(root, "theirs");
		mkdirSync(dest);
		writeFileSync(path.join(dest, "keep.txt"), "mine");
		expect(canOwn(dest)).toBe(false);
		expect(() => installTree(source, dest, "omp")).toThrow(/not installed by oh-my-statusline/);
		expect(readFileSync(path.join(dest, "keep.txt"), "utf8")).toBe("mine");
	});

	test("a reinstall replaces our files, drops files we no longer ship, and keeps files saved beside them", () => {
		const dest = path.join(root, "dest");
		installTree(source, dest, "claude");
		writeFileSync(path.join(dest, "previous-statusline.json"), "null\n");
		rmSync(path.join(source, "src", "domain", "a.ts"));
		writeFileSync(path.join(source, "src", "index.ts"), "export const v = 2;\n");
		installTree(source, dest, "claude");
		expect(existsSync(path.join(dest, "src", "domain", "a.ts"))).toBe(false);
		expect(readFileSync(path.join(dest, "src", "index.ts"), "utf8")).toContain("v = 2");
		expect(readFileSync(path.join(dest, "previous-statusline.json"), "utf8")).toBe("null\n");
	});
});

describe("removeTree", () => {
	test("removes only directories with our marker", () => {
		const ours = path.join(root, "ours");
		installTree(source, ours, "omp");
		const theirs = path.join(root, "theirs");
		mkdirSync(theirs);
		expect(removeTree(theirs)).toBe(false);
		expect(existsSync(theirs)).toBe(true);
		expect(removeTree(ours)).toBe(true);
		expect(existsSync(ours)).toBe(false);
		expect(removeTree(path.join(root, "absent"))).toBe(false);
	});

	test("a corrupt marker is not ours", () => {
		const dir = path.join(root, "corrupt");
		mkdirSync(dir);
		writeFileSync(path.join(dir, MARKER), "not json");
		expect(removeTree(dir)).toBe(false);
	});
});

describe("JSON settings files", () => {
	test("absent → {}, object → object, anything else → a clear error", () => {
		const file = path.join(root, "settings.json");
		expect(readJsonObject(file)).toEqual({});
		writeFileSync(file, '{"a":1}');
		expect(readJsonObject(file)).toEqual({ a: 1 });
		writeFileSync(file, "[1]");
		expect(() => readJsonObject(file)).toThrow(/not a JSON object/);
		writeFileSync(file, "{oops");
		expect(() => readJsonObject(file)).toThrow(/not valid JSON/);
	});

	test("writes keep the file mode and write through a symlink", () => {
		const real = path.join(root, "dotfiles", "settings.json");
		mkdirSync(path.dirname(real));
		writeFileSync(real, "{}", { mode: 0o600 });
		const link = path.join(root, "settings.json");
		symlinkSync(real, link);
		writeJsonObject(link, { statusLine: { type: "command" } });
		expect(readlinkSync(link)).toBe(real);
		expect(statSync(real).mode & 0o777).toBe(0o600);
		expect(JSON.parse(readFileSync(real, "utf8"))).toEqual({ statusLine: { type: "command" } });
	});

	test("backups are timestamped and never overwrite each other", () => {
		const file = path.join(root, "cli.json");
		expect(backup(file)).toBeNull();
		writeFileSync(file, "{}");
		const at = new Date(2026, 9, 17, 9, 5, 7);
		const first = backup(file, at);
		const second = backup(file, at);
		expect(first).toBe(`${file}.bak-20261017-090507`);
		expect(second).toBe(`${file}.bak-20261017-090507-1`);
	});
});
