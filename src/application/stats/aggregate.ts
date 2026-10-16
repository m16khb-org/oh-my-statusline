// Pure aggregation: events -> per-session/model/day buckets -> filtered per-harness summaries.
// Day boundaries are local calendar days of an injected IANA timezone.

import type {
	Bucket,
	BucketMap,
	HarnessSummary,
	ModelSummary,
	StatsAggregate,
	StatsHarness,
	StatsSummary,
	TokenTotals,
	UsageEvent,
	UsageSummary,
} from "./model.ts";
import { STATS_HARNESSES } from "./model.ts";

const DAY_MS = 86_400_000;
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
	let f = formatters.get(tz);
	if (!f) {
		f = new Intl.DateTimeFormat("en-US", {
			timeZone: tz,
			hourCycle: "h23",
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
		});
		formatters.set(tz, f);
	}
	return f;
}

function parts(ms: number, tz: string): Record<string, string> {
	const out: Record<string, string> = {};
	for (const p of formatter(tz).formatToParts(ms)) out[p.type] = p.value;
	return out;
}

/** `YYYY-MM-DD` of the local calendar day containing `ms` in `tz`. */
export function dayKey(ms: number, tz: string): string {
	const p = parts(ms, tz);
	return `${p.year}-${p.month}-${p.day}`;
}

/** `YYYY-MM-DD HH:mm` local wall-clock time. */
export function localMinute(ms: number, tz: string): string {
	const p = parts(ms, tz);
	return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

function shiftDay(day: string, days: number): string {
	return new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/**
 * First local day included by a `--since` spec: `all` (null), `today`, or `Nd` = the last N local
 * calendar days including today.
 */
export function sinceDay(spec: string, nowMs: number, tz: string): string | null {
	if (spec === "all") return null;
	const today = dayKey(nowMs, tz);
	if (spec === "today") return today;
	const m = /^(\d+)d$/.exec(spec);
	if (m && Number(m[1]) >= 1) return shiftDay(today, -(Number(m[1]) - 1));
	throw new Error(`invalid --since ${spec}; use today, all or Nd (e.g. 7d)`);
}

function count(n: number): number {
	return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Fold one event into `buckets`. Events with no tokens and no cost are not usage and are dropped. */
export function addEvent(buckets: BucketMap, harness: StatsHarness, e: UsageEvent, tz: string): void {
	const input = count(e.input);
	const output = count(e.output);
	const cacheRead = count(e.cacheRead);
	const cacheWrite = count(e.cacheWrite);
	const unsplit = count(e.unsplit);
	const cost = e.costUsd !== null && Number.isFinite(e.costUsd) && e.costUsd >= 0 ? e.costUsd : null;
	if (!Number.isFinite(e.tsMs) || (input + output + cacheRead + cacheWrite + unsplit === 0 && cost === null)) return;
	const day = dayKey(e.tsMs, tz);
	const key = `${harness}\u0000${e.sessionId}\u0000${e.model}\u0000${day}`;
	const b = buckets[key];
	if (!b) {
		buckets[key] = { harness, sessionId: e.sessionId, model: e.model, day, input, output, cacheRead, cacheWrite, unsplit, cost, firstMs: e.tsMs, lastMs: e.tsMs };
		return;
	}
	b.input += input;
	b.output += output;
	b.cacheRead += cacheRead;
	b.cacheWrite += cacheWrite;
	b.unsplit += unsplit;
	if (cost !== null) b.cost = (b.cost ?? 0) + cost;
	if (e.tsMs < b.firstMs) b.firstMs = e.tsMs;
	if (e.tsMs > b.lastMs) b.lastMs = e.tsMs;
}

function summarizeBuckets(buckets: readonly Bucket[]): UsageSummary {
	const sessions = new Set<string>();
	const priced = new Set<string>();
	const tokens: TokenTotals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, unsplit: 0, total: 0 };
	let cost: number | null = null;
	let first = Infinity;
	let last = -Infinity;
	for (const b of buckets) {
		const id = `${b.harness}\u0000${b.sessionId}`;
		sessions.add(id);
		if (b.cost !== null) {
			priced.add(id);
			cost = (cost ?? 0) + b.cost;
		}
		tokens.input += b.input;
		tokens.output += b.output;
		tokens.cacheRead += b.cacheRead;
		tokens.cacheWrite += b.cacheWrite;
		tokens.unsplit += b.unsplit;
		if (b.firstMs < first) first = b.firstMs;
		if (b.lastMs > last) last = b.lastMs;
	}
	tokens.total = tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite + tokens.unsplit;
	return {
		sessions: sessions.size,
		costSessions: priced.size,
		costUsd: cost === null ? null : Math.round(cost * 1e6) / 1e6,
		tokens,
		firstActivity: first === Infinity ? null : new Date(first).toISOString(),
		lastActivity: last === -Infinity ? null : new Date(last).toISOString(),
	};
}

export interface SummaryQuery {
	harnesses: readonly StatsHarness[];
	/** `today`, `all` or `Nd`. */
	since: string;
	nowMs: number;
	tz: string;
}

/** The stable `--json` document for `aggregate` restricted by `query`. */
export function summarize(aggregate: StatsAggregate, query: SummaryQuery): StatsSummary {
	const from = sinceDay(query.since, query.nowMs, query.tz);
	const wanted = STATS_HARNESSES.filter((h) => query.harnesses.includes(h));
	const inWindow = aggregate.buckets.filter((b) => wanted.includes(b.harness) && (from === null || b.day >= from));
	const harnesses: HarnessSummary[] = wanted.map((harness) => {
		const mine = inWindow.filter((b) => b.harness === harness);
		const byModel = new Map<string, Bucket[]>();
		for (const b of mine) byModel.set(b.model, [...(byModel.get(b.model) ?? []), b]);
		const models: ModelSummary[] = [...byModel].map(([model, list]) => ({ model, ...summarizeBuckets(list) }));
		models.sort((a, b) => b.tokens.total - a.tokens.total || a.model.localeCompare(b.model));
		return { harness, ...summarizeBuckets(mine), models };
	});
	return {
		schema: 1,
		generatedAt: new Date(query.nowMs).toISOString(),
		timezone: query.tz,
		since: { spec: query.since, day: from },
		harnesses,
		total: summarizeBuckets(inWindow),
	};
}

/**
 * Stored cost of the local day containing `nowMs`, optionally for one harness. null when no
 * bucket of that day carries a stored cost (the status-line chip shows `–`).
 */
export function todayCost(aggregate: StatsAggregate, nowMs: number, tz: string, harness?: StatsHarness): number | null {
	const today = dayKey(nowMs, tz);
	let cost: number | null = null;
	for (const b of aggregate.buckets) {
		if (b.day !== today || b.cost === null || (harness !== undefined && b.harness !== harness)) continue;
		cost = (cost ?? 0) + b.cost;
	}
	return cost === null ? null : Math.round(cost * 1e6) / 1e6;
}
