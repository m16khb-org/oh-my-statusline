// The prompt cache, tracked from assistant responses: omp reports usage per response, not the
// cache's remaining lifetime.

import type { CacheState } from "../../domain/model/snapshot.ts";
import type { AssistantMessage, OmpModel, OmpUsage } from "./host.ts";

export interface PromptCache {
	/** Epoch ms of the last response that read or wrote the prompt cache. */
	at: number;
	usage: OmpUsage;
	modelId: string;
	tier: "short" | "long";
}

/**
 * Track the prompt cache from one assistant response. The tier comes from the response's TTL
 * split when the provider reports it, else the previous tier, else omp's default: 1h for Claude
 * subscription logins (PI_CACHE_RETENTION overrides), 5m otherwise.
 */
export function nextPromptCache(
	prev: PromptCache | undefined,
	message: AssistantMessage,
	model: OmpModel | undefined,
	isOAuth: boolean,
	env: Record<string, string | undefined>,
	nowMs: number,
): PromptCache | undefined {
	const usage = message.usage;
	// A failed or aborted response reports no prompt tokens and says nothing about the cache.
	if (!usage || (usage.input ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0) === 0) return prev;
	const modelId = message.model ?? model?.id ?? "";
	const observed = (usage.cttl?.ephemeral1h ?? 0) > 0 ? "long" : (usage.cttl?.ephemeral5m ?? 0) > 0 ? "short" : undefined;
	const retention = env.PI_CACHE_RETENTION;
	const fallback =
		retention === "long" || retention === "short"
			? retention
			: isOAuth && model?.api === "anthropic-messages" && model.promptCache?.long
				? "long"
				: "short";
	const tier = observed ?? (prev?.modelId === modelId ? prev.tier : undefined) ?? fallback;
	return { at: message.timestamp ?? nowMs, usage, modelId, tier };
}

/** Time left on the prompt cache when the model has a known lifetime, else the last hit rate. */
export function promptCacheState(state: PromptCache | undefined, model: OmpModel | undefined, nowMs: number): CacheState | null {
	if (!state) return null;
	const { input = 0, cacheRead = 0, cacheWrite = 0 } = state.usage;
	const ttl = model?.promptCache?.[state.tier] ?? model?.promptCache?.short;
	if (ttl && cacheRead + cacheWrite > 0) {
		const leftS = Math.floor((state.at + ttl * 1000 - nowMs) / 1000);
		return leftS > 0 ? { hitPct: null, ttlRemainingMs: leftS * 1000 } : null;
	}
	const total = input + cacheRead + cacheWrite;
	return !ttl && total > 0 ? { hitPct: Math.round((cacheRead / total) * 100), ttlRemainingMs: null } : null;
}
