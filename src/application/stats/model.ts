// Usage-statistics model: normalized usage events, the per-session/model/day buckets they fold
// into, and the line-parser contract every JSONL harness implements. All pure data.

export const STATS_HARNESSES = ["claude", "codex", "omp", "opencode"] as const;
export type StatsHarness = (typeof STATS_HARNESSES)[number];

/** One billable model response (or one cost delta) read from a harness's own storage. */
export interface UsageEvent {
	sessionId: string;
	model: string;
	/** Epoch milliseconds of the response. */
	tsMs: number;
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	/** Tokens whose input/output split the source does not record (Codex thread rows). */
	unsplit: number;
	/** Cost USD the source itself stored; null when it stores none. Never computed here. */
	costUsd: number | null;
}

/** Everything one session spent on one model during one local calendar day. */
export interface Bucket {
	harness: StatsHarness;
	sessionId: string;
	model: string;
	/** Local calendar day, `YYYY-MM-DD`, in the timezone the cache was built for. */
	day: string;
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	unsplit: number;
	/** Sum of stored costs; null when no event of this bucket carried one. */
	cost: number | null;
	firstMs: number;
	lastMs: number;
}

export type BucketMap = Record<string, Bucket>;

/**
 * Incremental parser for one JSONL harness. `C` is the JSON-serializable carry state that survives
 * between runs (it is cached next to the byte offset the parser has consumed up to).
 */
export interface LineParser<C> {
	initial(fileHint: string): C;
	/** Feed one complete line. Lines the parser does not care about must return cheaply. */
	line(carry: C, text: string, emit: (event: UsageEvent) => void): void;
	/** Events the parser is still holding back (a streamed message that may be re-emitted). */
	pending(carry: C): UsageEvent[];
}

export interface TokenTotals {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	unsplit: number;
	total: number;
}

export interface UsageSummary {
	sessions: number;
	/** Sessions that carried a stored cost; fewer than `sessions` means the cost is partial. */
	costSessions: number;
	/** Sum of stored costs; null when the harness stores none. */
	costUsd: number | null;
	tokens: TokenTotals;
	firstActivity: string | null;
	lastActivity: string | null;
}

export interface ModelSummary extends UsageSummary {
	model: string;
}

export interface HarnessSummary extends UsageSummary {
	harness: StatsHarness;
	models: ModelSummary[];
}

/** The stable `--json` document. */
export interface StatsSummary {
	schema: 1;
	generatedAt: string;
	timezone: string;
	since: { spec: string; day: string | null };
	harnesses: HarnessSummary[];
	total: UsageSummary;
}

/** Every bucket collected; what `todayCost` and `summarize` read. */
export interface StatsAggregate {
	buckets: readonly Bucket[];
}
