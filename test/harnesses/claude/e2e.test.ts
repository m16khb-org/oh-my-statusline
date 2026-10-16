// `bun src/harnesses/claude/main.ts` as Claude Code runs it: a real process, a temp HOME and cache
// directory, and a PATH with only git (see isolatedEnv), so nothing reads real credentials.

import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import path from "node:path";
import { FileCache } from "../../../src/infrastructure/cache.ts";
import { cleanTemps, gitReading, isolatedEnv, makeRepo, seedUsage, session, spawnText, strip } from "./support.ts";

afterEach(cleanTemps);

const MAIN = path.resolve(import.meta.dir, "../../../src/harnesses/claude/main.ts");
const run = (args: string[], stdin: string, env: Record<string, string>) => spawnText([process.execPath, MAIN, ...args], stdin, env);

describe("main.ts as a process", () => {
	test("prints two rows for a full session and exits 0", async () => {
		const repo = makeRepo();
		const nowS = Math.floor(Date.now() / 1000);
		const data = session(repo, { "prompt_cache.expires_at": nowS + 2550, "rate_limits.five_hour": { used_percentage: 41, resets_at: nowS + 4350 } });
		const env = isolatedEnv();
		seedUsage(env);
		const { code, out, err } = await run([], JSON.stringify(data), env);
		expect(err).toBe("");
		expect(code).toBe(0);
		const rows = out.split("\n");
		expect(rows).toHaveLength(2);
		expect(strip(rows[0]!)).toContain("Opus 5.5");
		expect(strip(rows[0]!)).toContain("main");
		expect(strip(rows[1]!)).toContain("ctx");
		expect(strip(out)).not.toContain("null");
	});

	test("empty stdin exits 0 with one hint line", async () => {
		const { code, out } = await run([], "", isolatedEnv());
		expect(code).toBe(0);
		expect(out).toContain("oh-my-statusline:");
		expect(out.trim().split("\n")).toHaveLength(1);
	});

	test("--subagents prints one JSON row per model task", async () => {
		const tasks = [
			{ id: "a1", status: "running", description: "Review", model: "claude-haiku-4-5-20251001", contextWindowSize: 200_000, tokenCount: 24_000 },
			{ id: "b1", type: "local_bash", status: "running", description: "npm test" },
		];
		const { code, out } = await run(["--subagents"], JSON.stringify({ columns: 100, tasks }), isolatedEnv({ STATUSLINE_GLYPHS: "plain" }));
		expect(code).toBe(0);
		const rows = out.trim().split("\n").map((line) => JSON.parse(line));
		expect(rows).toHaveLength(1);
		expect(rows[0].id).toBe("a1");
		expect(strip(rows[0].content)).toContain("Haiku 4.5");
	});

	test("--subagents with bad stdin exits 0 and prints nothing", async () => {
		const { code, out } = await run(["--subagents"], "", isolatedEnv());
		expect([code, out]).toEqual([0, ""]);
	});

	test("a stale git cache renders at once and a detached process, started by the render, refreshes it after the render has exited", async () => {
		const repo = makeRepo();
		const env = isolatedEnv();
		seedUsage(env);
		const cacheDir = path.join(env.XDG_CACHE_HOME!, "oh-my-statusline");
		const key = `claude-git:${repo}`;
		new FileCache(cacheDir, { now: () => Date.now() - 600_000 }).write(key, gitReading("# branch.oid ca8cb99\n# branch.head cached-branch\n"));

		const { code, out } = await run([], JSON.stringify(session(repo)), env);
		expect(code).toBe(0);
		expect(strip(out.split("\n")[0]!)).toContain("cached-branch");

		const cache = new FileCache(cacheDir, { now: () => Date.now() });
		const lock = path.join(cacheDir, "claude-git_" + repo.replace(/[^A-Za-z0-9._-]/g, "_") + ".lock");
		// A real wait is unavoidable: the helper is a detached process that signals nothing the test could
		// await, so poll its only effect (the cache entry and the released lock) with a deadline.
		const deadline = Date.now() + 15_000;
		let branch = "cached-branch";
		while (Date.now() < deadline && (branch !== "main" || existsSync(lock))) {
			await Bun.sleep(50);
			branch = cache.read<{ state: { branch: string } }>(key)?.value.state.branch ?? branch;
		}
		expect(branch).toBe("main");
		expect(existsSync(lock)).toBe(false);
	});

	test("--refresh usage without credentials exits 0 and caches 'no windows', so renders stop asking", async () => {
		const env = isolatedEnv();
		const { code, out } = await run(["--refresh", "usage"], "", env);
		expect([code, out]).toEqual([0, ""]);
		expect(new FileCache(path.join(env.XDG_CACHE_HOME!, "oh-my-statusline"), { now: Date.now }).read("claude-usage")?.value).toEqual([]);
	});
});
