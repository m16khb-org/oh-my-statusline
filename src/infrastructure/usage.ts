import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import * as path from "node:path";
import type { ClockPort, UsagePort } from "../application/ports.ts";
import type { LimitWindow } from "../domain/model/snapshot.ts";
import { type CommandRunner, run } from "./process.ts";

const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const WEEK_MS = 604_800_000;
const FETCH_TIMEOUT_MS = 5000;

function record(v: unknown): Record<string, unknown> | null {
	return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null;
}

/** Model-scoped weekly windows of the usage response; windows already past their reset are dropped. */
export function parseUsageResponse(body: unknown, nowMs: number): LimitWindow[] {
	const limits = record(body)?.limits;
	if (!Array.isArray(limits)) return [];
	const out: LimitWindow[] = [];
	for (const item of limits) {
		const limit = record(item);
		if (!limit || limit.kind !== "weekly_scoped") continue;
		const name = record(record(limit.scope)?.model)?.display_name;
		const label = typeof name === "string" ? name.replace(/\s+/g, "") : "";
		if (!label) continue;
		const parsed = typeof limit.resets_at === "string" ? Date.parse(limit.resets_at) : Number.NaN;
		const resetsAtMs = Number.isNaN(parsed) ? null : parsed;
		if (resetsAtMs !== null && resetsAtMs <= nowMs) continue;
		const usedPct = typeof limit.percent === "number" && Number.isFinite(limit.percent) ? limit.percent : null;
		out.push({ label, usedPct, resetsAtMs, windowMs: WEEK_MS, scopedModel: label });
	}
	return out;
}

export interface UsageDeps {
	clock: ClockPort;
	/** Value of CLAUDE_CONFIG_DIR, if set. */
	configDir?: string;
	fetch?: (url: string, init: RequestInit) => Promise<Response>;
	readFile?: (file: string) => string | null;
	exec?: CommandRunner;
}

function readFileOrNull(file: string): string | null {
	try {
		return readFileSync(file, "utf8");
	} catch {
		return null;
	}
}

function tokenOf(json: string | null): string | null {
	if (!json) return null;
	try {
		const token = record(record(JSON.parse(json))?.claudeAiOauth)?.accessToken;
		return typeof token === "string" && token ? token : null;
	} catch {
		return null;
	}
}

export class ClaudeUsageAdapter implements UsagePort {
	private readonly fetchFn: NonNullable<UsageDeps["fetch"]>;
	private readonly readFile: NonNullable<UsageDeps["readFile"]>;
	private readonly exec: CommandRunner;

	constructor(private readonly deps: UsageDeps) {
		this.fetchFn = deps.fetch ?? fetch;
		this.readFile = deps.readFile ?? readFileOrNull;
		this.exec = deps.exec ?? run;
	}

	private async token(): Promise<string | null> {
		const dir = this.deps.configDir || path.join(homedir(), ".claude");
		return (
			tokenOf(this.readFile(path.join(dir, ".credentials.json"))) ??
			tokenOf(await this.exec(["security", "find-generic-password", "-s", "Claude Code-credentials", "-w"]))
		);
	}

	async read(): Promise<LimitWindow[] | null> {
		const token = await this.token();
		if (!token) return null;
		try {
			const res = await this.fetchFn(USAGE_URL, {
				headers: { Authorization: `Bearer ${token}`, "anthropic-beta": "oauth-2025-04-20" },
				signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
			});
			if (!res.ok) return null;
			return parseUsageResponse(await res.json(), this.deps.clock.now());
		} catch {
			return null;
		}
	}
}
