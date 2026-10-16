// Ported from omp-statusline test/statusline.test.ts: model labels, usage windows, prompt cache.

import { describe, expect, test } from "bun:test";
import { nextPromptCache, promptCacheState } from "../../../src/harnesses/omp/cache.ts";
import type { UsageReport } from "../../../src/harnesses/omp/host.ts";
import { modelLabel } from "../../../src/harnesses/omp/main.ts";
import { usageWindows } from "../../../src/harnesses/omp/usage.ts";
import { GPT, OPUS } from "./fake-omp.ts";

const NOW_S = 1_800_000_000;

test("model labels drop the Claude prefix and a trailing parenthesis", () => {
	expect(modelLabel(OPUS)).toBe("Opus 5.5");
	expect(modelLabel({ id: "x", name: "Claude 3.7 Sonnet (thinking)", provider: "p" })).toBe("3.7 Sonnet");
	expect(modelLabel({ id: "glm-5.3", provider: "zai" })).toBe("glm-5.3");
});

describe("usage windows", () => {
	const reset5h = (NOW_S + 4320) * 1000;
	const reset7d = (NOW_S + 280_000) * 1000;
	const anthropic: UsageReport = {
		provider: "anthropic",
		metadata: { email: "me@example.com" },
		limits: [
			{ scope: { tier: "fable", windowId: "7d" }, amount: { usedFraction: 0.31 }, window: { resetsAt: reset7d } },
			{ scope: { windowId: "7d" }, amount: { usedFraction: 0.73 }, window: { resetsAt: reset7d } },
			{ scope: { windowId: "5h" }, amount: { used: 11, limit: 100, unit: "percent" }, window: { resetsAt: reset5h } },
			{ scope: { modelId: "claude-sonnet-5-5", windowId: "7d" }, amount: { usedFraction: 0.9 } },
		],
	};

	test("the active provider's 5h, 7d and tier windows come in that order", () => {
		expect(usageWindows([{ provider: "openai-codex", limits: [] }, anthropic], OPUS, undefined)).toEqual([
			{ label: "5h", usedPct: 11, resetsAtMs: reset5h, windowMs: 18_000_000, scopedModel: null },
			{ label: "7d", usedPct: 73, resetsAtMs: reset7d, windowMs: 604_800_000, scopedModel: null },
			{ label: "Fable", usedPct: 31, resetsAtMs: reset7d, windowMs: 604_800_000, scopedModel: "Fable" },
		]);
	});

	test("a tier's 5-hour window is labelled Tier·5h", () => {
		const report: UsageReport = {
			provider: "anthropic",
			limits: [{ scope: { tier: "Fable Pro", windowId: "5h" }, amount: { usedFraction: 0.5 } }],
		};
		expect(usageWindows([report], OPUS, undefined)).toEqual([
			{ label: "FablePro·5h", usedPct: 50, resetsAtMs: null, windowMs: 18_000_000, scopedModel: "FablePro" },
		]);
	});

	test("other providers and other models' windows are ignored", () => {
		expect(usageWindows([anthropic], GPT, undefined)).toEqual([]);
		const sonnet = usageWindows([anthropic], { ...OPUS, id: "claude-sonnet-5-5" }, undefined);
		expect(sonnet.find((w) => w.label === "7d")?.usedPct).toBe(90);
		expect(usageWindows(null, OPUS, undefined)).toEqual([]);
		expect(usageWindows([anthropic], undefined, undefined)).toEqual([]);
	});

	test("a window known only by its duration (within a minute) is classified by it", () => {
		const report = (durationMs: number): UsageReport => ({
			provider: "openai-codex",
			limits: [{ scope: {}, amount: { remainingFraction: 0.56 }, window: { durationMs, resetsAt: reset7d } }],
		});
		expect(usageWindows([report(604_800_000)], GPT, undefined)).toEqual([
			{ label: "7d", usedPct: 44, resetsAtMs: reset7d, windowMs: 604_800_000, scopedModel: null },
		]);
		expect(usageWindows([report(604_800_000 + 59_000)], GPT, undefined)[0]?.label).toBe("7d");
		expect(usageWindows([report(18_000_000 - 59_000)], GPT, undefined)[0]?.label).toBe("5h");
		expect(usageWindows([report(3_600_000)], GPT, undefined)).toEqual([]);
	});

	test("with several accounts the session's own account wins", () => {
		const other: UsageReport = { ...anthropic, metadata: { email: "other@example.com" }, limits: [{ scope: { windowId: "5h" }, amount: { usedFraction: 0.99 } }] };
		expect(usageWindows([other, anthropic], OPUS, { email: "ME@example.com" })[0]).toMatchObject({ label: "5h", usedPct: 11 });
		expect(usageWindows([other, anthropic], OPUS, undefined)[0]).toMatchObject({ label: "5h", usedPct: 99 });
		const byAccount: UsageReport = { ...anthropic, metadata: { accountId: "acct-2" } };
		expect(usageWindows([other, byAccount], OPUS, { accountId: "acct-2" })[0]?.usedPct).toBe(11);
		// The same email in another organization is another account.
		const otherOrg: UsageReport = { ...other, metadata: { email: "me@example.com", orgId: "org-b" } };
		const myOrg: UsageReport = { ...anthropic, metadata: { email: "me@example.com", orgId: "org-a" } };
		expect(usageWindows([otherOrg, myOrg], OPUS, { email: "me@example.com", orgId: "org-a" })[0]?.usedPct).toBe(11);
	});
});

describe("prompt cache", () => {
	const at = NOW_S * 1000;
	const msg = (usage: object) => ({ role: "assistant", model: OPUS.id, timestamp: at, usage });
	const next = (prev: Parameters<typeof nextPromptCache>[0], usage: object, model = OPUS, oauth = true, env = {}) =>
		nextPromptCache(prev, msg(usage), model, oauth, env, at);

	test("a Claude subscription login keeps the cache for an hour", () => {
		const state = next(undefined, { input: 10, cacheRead: 20_000, cacheWrite: 50 });
		expect(promptCacheState(state, OPUS, at + 60_000)).toEqual({ hitPct: null, ttlRemainingMs: 3_540_000 });
	});

	test("an API key, or PI_CACHE_RETENTION=short, keeps it for five minutes", () => {
		const usage = { input: 10, cacheRead: 20_000 };
		expect(promptCacheState(next(undefined, usage, OPUS, false), OPUS, at)?.ttlRemainingMs).toBe(300_000);
		expect(promptCacheState(next(undefined, usage, OPUS, true, { PI_CACHE_RETENTION: "short" }), OPUS, at)?.ttlRemainingMs).toBe(300_000);
		expect(promptCacheState(next(undefined, usage, OPUS, false, { PI_CACHE_RETENTION: "long" }), OPUS, at)?.ttlRemainingMs).toBe(3_600_000);
	});

	test("the TTL the response reports wins over the default", () => {
		const state = next(undefined, { cacheWrite: 900, cttl: { ephemeral5m: 900 } });
		expect(state?.tier).toBe("short");
		// A later cache read keeps that tier.
		expect(next(state, { cacheRead: 900 })?.tier).toBe("short");
		expect(next(state, { cacheWrite: 900, cttl: { ephemeral1h: 900 } })?.tier).toBe("long");
	});

	test("an expired or unused cache shows nothing", () => {
		expect(promptCacheState(next(undefined, { input: 500 }), OPUS, at)).toBeNull();
		const warm = next(undefined, { cacheRead: 500 }, OPUS, false);
		expect(promptCacheState(warm, OPUS, at + 301_000)).toBeNull();
		expect(promptCacheState(undefined, OPUS, at)).toBeNull();
	});

	test("a response without prompt tokens leaves the state alone", () => {
		const state = next(undefined, { cacheRead: 500 });
		expect(next(state, { input: 0, output: 0 })).toBe(state);
	});

	test("models without a known lifetime show the last request's hit rate", () => {
		const state = nextPromptCache(undefined, { role: "assistant", model: GPT.id, usage: { input: 1000, cacheRead: 9000 } }, GPT, true, {}, at);
		expect(promptCacheState(state, GPT, at)).toEqual({ hitPct: 90, ttlRemainingMs: null });
	});
});
