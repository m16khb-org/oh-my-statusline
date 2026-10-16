import { expect, test } from "bun:test";
import { ClaudeUsageAdapter, parseUsageResponse } from "../../src/infrastructure/usage.ts";

const NOW = Date.parse("2026-10-17T00:00:00Z");
const body = {
	limits: [
		{ kind: "weekly", percent: 10, resets_at: "2026-10-20T00:00:00Z" },
		{ kind: "weekly_scoped", percent: 42.5, resets_at: "2026-10-20T12:30:00.123456+00:00", scope: { model: { display_name: "Fable 5" } } },
		{ kind: "weekly_scoped", percent: 5, resets_at: "2026-10-10T00:00:00Z", scope: { model: { display_name: "Old" } } },
		{ kind: "weekly_scoped", percent: 5, resets_at: "2026-10-20T00:00:00Z", scope: { model: { display_name: "" } } },
	],
};

test("parser keeps scoped weekly windows, drops past and unnamed", () => {
	expect(parseUsageResponse(body, NOW)).toEqual([
		{ label: "Fable5", usedPct: 42.5, resetsAtMs: Date.parse("2026-10-20T12:30:00.123Z"), windowMs: 604_800_000, scopedModel: "Fable5" },
	]);
	expect(parseUsageResponse("junk", NOW)).toEqual([]);
});

const creds = JSON.stringify({ claudeAiOauth: { accessToken: "tok" } });
const ok = (b: unknown, status = 200) => async () => new Response(JSON.stringify(b), { status });

test("reads token from file and sends headers", async () => {
	let seen: { url: string; init: RequestInit } | undefined;
	const adapter = new ClaudeUsageAdapter({
		clock: { now: () => NOW },
		configDir: "/cfg",
		readFile: (f) => (f === "/cfg/.credentials.json" ? creds : null),
		exec: async () => null,
		fetch: async (url, init) => {
			seen = { url, init };
			return new Response(JSON.stringify(body));
		},
	});
	expect(await adapter.read()).toHaveLength(1);
	expect(seen?.url).toBe("https://api.anthropic.com/api/oauth/usage");
	expect(seen?.init.headers).toEqual({ Authorization: "Bearer tok", "anthropic-beta": "oauth-2025-04-20" });
});

test("falls back to the keychain command", async () => {
	const adapter = new ClaudeUsageAdapter({ clock: { now: () => NOW }, readFile: () => null, exec: async () => creds, fetch: ok(body) });
	expect(await adapter.read()).toHaveLength(1);
});

test("no token means no windows; HTTP error and bad JSON give null (keep what was cached)", async () => {
	const base = { clock: { now: () => NOW }, readFile: () => creds, exec: async () => null };
	expect(await new ClaudeUsageAdapter({ ...base, readFile: () => null, fetch: ok(body) }).read()).toEqual([]);
	expect(await new ClaudeUsageAdapter({ ...base, fetch: ok(body, 500) }).read()).toBeNull();
	expect(await new ClaudeUsageAdapter({ ...base, fetch: async () => new Response("not json") }).read()).toBeNull();
	expect(
		await new ClaudeUsageAdapter({
			...base,
			fetch: async () => {
				throw new Error("net");
			},
		}).read(),
	).toBeNull();
});
