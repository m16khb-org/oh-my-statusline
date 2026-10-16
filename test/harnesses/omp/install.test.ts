// Ported from omp-statusline test/install.test.ts (install.sh / uninstall.sh), against install.ts.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { install, ompInstallDir, uninstall } from "../../../src/harnesses/omp/install.ts";
import { draw, fakeOmp } from "./fake-omp.ts";

const ROOT = path.join(import.meta.dir, "..", "..", "..");
let tmp: string;
let home: string;
let lines: string[];

beforeEach(() => {
	tmp = mkdtempSync(path.join(tmpdir(), "omp-install-test-"));
	home = path.join(tmp, "home");
	lines = [];
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

const opts = (over: { agentDir?: string; env?: Record<string, string>; plain?: boolean } = {}) => ({
	home,
	env: over.env ?? {},
	sourceRoot: ROOT,
	plain: over.plain ?? false,
	agentDir: over.agentDir,
	log: (line: string) => void lines.push(line),
});
const fresh = (name: string) => path.join(tmp, name, "agent dir");
const extDir = (agent: string) => path.join(agent, "extensions", "oh-my-statusline");

describe("install", () => {
	test("copies the runtime into <agent dir>/extensions/oh-my-statusline with an entry shim", () => {
		const agent = fresh("basic");
		install(opts({ agentDir: agent }));
		const dir = extDir(agent);
		expect(readFileSync(path.join(dir, "index.ts"), "utf8")).toBe('export { default } from "./src/harnesses/omp/main.ts";\n');
		for (const f of ["main.ts", "install.ts", "host.ts", "usage.ts", "cache.ts", "omp-host.d.ts"]) {
			expect(readFileSync(path.join(dir, "src", "harnesses", "omp", f), "utf8")).toBe(readFileSync(path.join(ROOT, "src", "harnesses", "omp", f), "utf8"));
		}
		expect(JSON.parse(readFileSync(path.join(dir, "config.json"), "utf8"))).toEqual({ glyphs: "powerline" });
		expect(existsSync(path.join(dir, ".oh-my-statusline"))).toBe(true);
		expect(lines[0]).toContain(`Installed oh-my-statusline to ${dir} (powerline glyphs)`);
	});

	test("the default agent directory is PI_CODING_AGENT_DIR, else ~/.omp/agent", () => {
		install(opts());
		expect(existsSync(path.join(home, ".omp", "agent", "extensions", "oh-my-statusline", "index.ts"))).toBe(true);
		const agent = fresh("env");
		install(opts({ env: { PI_CODING_AGENT_DIR: agent } }));
		expect(existsSync(path.join(agent, "extensions", "oh-my-statusline", "index.ts"))).toBe(true);
		expect(ompInstallDir({ home, env: { PI_CODING_AGENT_DIR: agent }, agentDir: "/x" })).toBe("/x/extensions/oh-my-statusline");
	});

	test("plain is saved for the extension, and a reinstall switches it back", () => {
		const agent = fresh("plain");
		const config = path.join(extDir(agent), "config.json");
		install(opts({ agentDir: agent, plain: true }));
		expect(JSON.parse(readFileSync(config, "utf8")).glyphs).toBe("plain");
		install(opts({ agentDir: agent }));
		expect(JSON.parse(readFileSync(config, "utf8")).glyphs).toBe("powerline");
	});

	test("omp finds exactly one entry: the root index.ts, never the copied sources", () => {
		const agent = fresh("layout");
		install(opts({ agentDir: agent }));
		// omp scans extensions/*/index.{ts,js} and extensions/*/package.json "omp"/"pi" manifests,
		// one level deep (see the install.ts header).
		const entries = readdirSync(path.join(agent, "extensions"), { withFileTypes: true }).flatMap((d) =>
			d.isDirectory() ? readdirSync(path.join(agent, "extensions", d.name)).filter((f) => /^index\.(ts|js)$/.test(f)).map((f) => `${d.name}/${f}`) : [],
		);
		expect(entries).toEqual(["oh-my-statusline/index.ts"]);
		const pkg = JSON.parse(readFileSync(path.join(extDir(agent), "package.json"), "utf8"));
		expect(pkg.omp).toBeUndefined();
		expect(pkg.pi).toBeUndefined();
	});

	test("a directory it did not create is never overwritten", () => {
		const agent = fresh("foreign");
		const dir = extDir(agent);
		mkdirSync(dir, { recursive: true });
		writeFileSync(path.join(dir, "index.ts"), "// someone else's\n");
		expect(() => install(opts({ agentDir: agent }))).toThrow(/not installed by oh-my-statusline/);
		expect(readFileSync(path.join(dir, "index.ts"), "utf8")).toBe("// someone else's\n");
		expect(readdirSync(dir)).toEqual(["index.ts"]);
		expect(readdirSync(path.dirname(dir))).toEqual(["oh-my-statusline"]);
	});
});

describe("installed tree", () => {
	let saved: Record<string, string | undefined>;
	const keys = ["XDG_CONFIG_HOME", "STATUSLINE_GLYPHS", "STATUSLINE_COLORS", "STATUSLINE_THEME", "NO_COLOR", "OMP_STATUSLINE_NATIVE"];
	beforeEach(() => {
		saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
		for (const k of keys) delete process.env[k];
		process.env.XDG_CONFIG_HOME = path.join(tmp, "config");
		process.env.STATUSLINE_COLORS = "truecolor";
	});
	afterEach(() => {
		for (const [k, v] of Object.entries(saved)) {
			if (v === undefined) delete process.env[k];
			else process.env[k] = v;
		}
	});

	async function load(plain: boolean) {
		const agent = fresh(plain ? "shim-plain" : "shim");
		install(opts({ agentDir: agent, plain }));
		const cwd = path.join(tmp, "work");
		mkdirSync(cwd, { recursive: true });
		// The way omp loads an extension directory: import its index.ts, call the default export.
		const mod = (await import(path.join(extDir(agent), "index.ts"))) as { default: (pi: unknown, host?: unknown) => Promise<void> };
		const h = fakeOmp(cwd, {});
		await mod.default(h.pi, h.host);
		await h.emit("session_start", {}, h.ctx());
		return draw(h.widgets[0]?.content);
	}

	test("the entry shim loads the installed copy and draws two rows with powerline glyphs", async () => {
		const rows = await load(false);
		expect(rows).toHaveLength(2);
		expect(rows[0]).toStartWith(" Opus 5.5 \ue0b0 ");
	});

	test("config.json written by a plain install selects plain glyphs; the environment still wins", async () => {
		const rows = await load(true);
		expect(rows).toHaveLength(2);
		expect(rows[0]).toStartWith(" Opus 5.5 ");
		expect(rows[0]).not.toContain("\ue0b0");
		process.env.STATUSLINE_GLYPHS = "powerline";
		expect((await load(true))[0]).toContain("\ue0b0");
	});

	test("the installed runtime prints the omp demo on its own", () => {
		const agent = fresh("demo");
		install(opts({ agentDir: agent }));
		const proc = Bun.spawnSync(["bun", path.join(extDir(agent), "src", "harnesses", "omp", "main.ts"), "--demo"], {
			stdout: "pipe",
			env: { ...process.env, XDG_CONFIG_HOME: path.join(tmp, "config"), NO_COLOR: "1", COLUMNS: "160" },
		});
		expect(proc.exitCode).toBe(0);
		const out = proc.stdout.toString().trimEnd().split("\n");
		expect(out).toHaveLength(2);
		expect(out[0]).toContain("GPT-5.5");
	});
});

describe("uninstall", () => {
	test("removes what install added, and says so when nothing is installed", () => {
		const agent = fresh("remove");
		install(opts({ agentDir: agent }));
		lines = [];
		uninstall(opts({ agentDir: agent }));
		expect(existsSync(extDir(agent))).toBe(false);
		expect(existsSync(path.join(agent, "extensions"))).toBe(true);
		expect(lines[0]).toContain("Removed");
		lines = [];
		uninstall(opts({ agentDir: agent }));
		expect(lines[0]).toContain("not installed");
	});

	test("a directory it did not create is left alone", () => {
		const agent = fresh("foreign-remove");
		const dir = extDir(agent);
		mkdirSync(dir, { recursive: true });
		writeFileSync(path.join(dir, "index.ts"), "// someone else's\n");
		expect(() => uninstall(opts({ agentDir: agent }))).toThrow(/not installed by oh-my-statusline/);
		expect(readFileSync(path.join(dir, "index.ts"), "utf8")).toBe("// someone else's\n");
	});

	test("other extensions next to ours are untouched", () => {
		const agent = fresh("neighbors");
		mkdirSync(path.join(agent, "extensions"), { recursive: true });
		writeFileSync(path.join(agent, "extensions", "other.ts"), "export default () => {};\n");
		install(opts({ agentDir: agent }));
		uninstall(opts({ agentDir: agent }));
		expect(readdirSync(path.join(agent, "extensions"))).toEqual(["other.ts"]);
	});
});
