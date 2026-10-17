// The omp surface the extension reads, typed structurally so it loads across 18.x releases.
// These types stay in the harness: nothing outside src/harnesses/omp/ knows omp's API.

export interface OmpModel {
	id: string;
	name?: string;
	provider: string;
	api?: string;
	reasoning?: boolean;
	contextWindow?: number;
	/** Prompt-cache lifetime in seconds per retention tier. */
	promptCache?: { short?: number; long?: number };
}

export interface OmpUsage {
	input?: number;
	cacheRead?: number;
	cacheWrite?: number;
	/** Anthropic's cache-write split by TTL. */
	cttl?: { ephemeral5m?: number; ephemeral1h?: number };
}

export interface AssistantMessage {
	role: string;
	provider?: string;
	model?: string;
	usage?: OmpUsage;
	timestamp?: number;
	/** Features the provider dropped for this turn; "priority" when Anthropic refused fast mode. */
	disabledFeatures?: string[];
}

export interface UsageLimit {
	scope?: { modelId?: string; tier?: string; windowId?: string; accountId?: string };
	window?: { durationMs?: number; resetsAt?: number };
	amount?: { usedFraction?: number; used?: number; limit?: number; unit?: string; remainingFraction?: number };
}

export interface UsageReport {
	provider: string;
	limits?: UsageLimit[];
	metadata?: Record<string, unknown>;
}

export interface AccountIdentity {
	accountId?: string;
	email?: string;
	orgId?: string;
}

interface ModelRegistry {
	isUsingOAuth?(model: OmpModel): boolean;
	getProviderBaseUrl?(provider: string): string | undefined;
	authStorage?: {
		usage?: { reports?(options: { baseUrlResolver?: (provider: string) => string | undefined }): Promise<UsageReport[] | null> };
		oauth?: { identity?(provider: string, sessionId?: string): AccountIdentity | undefined };
	};
}

interface SessionEntry {
	type: string;
	message?: AssistantMessage;
}

/** omp's context-window occupancy; percent is null right after compaction. */
export interface ContextUsage {
	tokens: number;
	contextWindow: number;
	percent: number | null;
}

export interface OmpContext {
	cwd: string;
	mode?: string;
	hasUI?: boolean;
	agent?: { kind?: string };
	model?: OmpModel;
	modelRegistry?: ModelRegistry;
	sessionManager?: {
		getSessionId?(): string;
		getHeader?(): { timestamp?: string } | null;
		getBranch?(): readonly SessionEntry[];
		getUsageStatistics?(): { cost?: number };
	};
	getContextUsage?(): ContextUsage | undefined;
	ui: { setWidget(key: string, content: unknown, options?: { placement?: string }): void };
	setInterval?(fn: () => void, ms: number): unknown;
}

export interface OmpTui {
	requestRender(): void;
}

/** What omp's native-terminal backend (Tern Surface Protocol) passes to `describe`; only the width is read. */
export interface DescribeContext {
	readonly cols: number;
}

/**
 * The Tern Surface Protocol nodes the widget describes itself with: its rows as one `ansi` block, or a
 * hidden column when there is nothing to draw. A widget that does not describe itself is sent as a
 * `rows` node, which Tern marks with a `fallback` badge.
 */
export type NativeNode = { k: "ansi"; p: { text: string; cols: number } } | { k: "col"; p: { hidden: true } };

export interface SettingHandle {
	override(scope: unknown, value: unknown): void;
}

export interface OmpApi {
	on<E = unknown>(event: string, handler: (event: E, ctx: OmpContext) => unknown): void;
	getThinkingLevel?(): string | undefined;
	getServiceTiers?(): Readonly<Record<string, string | undefined>>;
	/** The host package's exports: `theme` (live binding) and `settings`. */
	pi?: { theme?: { isLight?: boolean }; settings?: unknown };
}

/** Host modules loaded at runtime; tests pass fakes. */
export interface HostModules {
	lookupSetting?(id: string): SettingHandle | undefined;
	serviceTierFamily?(model: OmpModel): string | undefined;
	/** Agents of omp's process-global registry that are subagents and running: the ids its own badge counts. */
	runningSubagents?(): number;
}
