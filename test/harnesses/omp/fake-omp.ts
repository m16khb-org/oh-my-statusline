// A fake omp host for the extension tests: records handlers, widgets, settings overrides.

import type { HostModules, OmpApi, OmpContext, OmpModel } from "../../../src/harnesses/omp/host.ts";

export const OPUS: OmpModel = {
	id: "claude-opus-5-5",
	name: "Claude Opus 5.5",
	provider: "anthropic",
	api: "anthropic-messages",
	reasoning: true,
	contextWindow: 1_000_000,
	promptCache: { short: 300, long: 3600 },
};
export const GPT: OmpModel = { id: "gpt-5.5", name: "GPT-5.5", provider: "openai-codex", api: "openai-codex-responses" };

type Handler = (event: unknown, ctx: OmpContext) => unknown;

export const plain = (s: string): string => s.replace(/\x1b\][^\x07]*\x07/g, "").replace(/\x1b\[[0-9;]*m/g, "");

export function fakeOmp(cwd: string, settings: object = {}) {
	const handlers = new Map<string, Handler[]>();
	const overrides: [string, unknown][] = [];
	const state = {
		tiers: { anthropic: "priority" } as Record<string, string>,
		contextReads: 0,
		context: { tokens: 283_000, contextWindow: 1_000_000, percent: 28.3 as number | null },
		ticks: [] as (() => void)[],
		isLight: false,
	};
	const pi: OmpApi = {
		on: <E>(event: string, handler: (event: E, ctx: OmpContext) => unknown) => {
			handlers.set(event, [...(handlers.get(event) ?? []), handler as Handler]);
		},
		getThinkingLevel: () => "high",
		getServiceTiers: () => ({ ...state.tiers }),
		pi: {
			get theme() {
				return { isLight: state.isLight };
			},
			settings,
		},
	};
	const host: HostModules = {
		lookupSetting: (id) => ({ override: (_scope, value) => void overrides.push([id, value]) }),
		serviceTierFamily: (model) => (model.api === "anthropic-messages" ? "anthropic" : undefined),
	};
	const widgets: { key: string; content: unknown; placement?: string }[] = [];
	const ctx = (over: Partial<OmpContext> = {}): OmpContext => ({
		cwd,
		mode: "tui",
		hasUI: true,
		agent: { kind: "main" },
		model: OPUS,
		modelRegistry: { isUsingOAuth: () => true },
		sessionManager: {
			getHeader: () => ({ timestamp: new Date(Date.now() - 1_380_000).toISOString() }),
			getUsageStatistics: () => ({ cost: 4.21 }),
			getBranch: () => [],
		},
		getContextUsage: () => {
			state.contextReads++;
			return { ...state.context };
		},
		ui: { setWidget: (key, content, options) => void widgets.push({ key, content, placement: options?.placement }) },
		setInterval: (fn) => void state.ticks.push(fn),
		...over,
	});
	const emit = async (event: string, payload: unknown, c: OmpContext) => {
		for (const h of handlers.get(event) ?? []) await h(payload, c);
	};
	return { pi, host, overrides, widgets, ctx, emit, state };
}

type Widget = { render(width: number): readonly string[] };

/** Instantiate the widget the way omp does and draw it once. */
export function mount(content: unknown): { widget: Widget; renders: number } {
	let renders = 0;
	const factory = content as (tui: { requestRender(): void }) => Widget;
	return { widget: factory({ requestRender: () => void renders++ }), get renders() { return renders; } };
}

export const draw = (content: unknown, width = 160): string[] => mount(content).widget.render(width).map(plain);
