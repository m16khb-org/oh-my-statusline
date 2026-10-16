// Codex session rollout files (`~/.codex/sessions/…/rollout-*.jsonl`): one JSON record per line.
// The reader consumes only complete lines, so a record Codex is still writing is read once it
// is finished, and never twice.

import { closeSync, fstatSync, openSync, readSync } from "node:fs";

/** What the records told us so far; fields keep the rollout's raw values. */
export type RolloutState = Record<string, unknown>;

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);

function copyKeys(state: RolloutState, from: Json, keys: readonly string[], skipNull = false): void {
	for (const key of keys) if (key in from && !(skipNull && from[key] == null)) state[key] = from[key];
}

/** Fold one rollout record into `state`. */
export function consume(state: RolloutState, record: unknown): void {
	if (!isObject(record)) return;
	const payload = isObject(record.payload) ? record.payload : {};
	const kind = record.type;
	if (kind === "session_meta") copyKeys(state, payload, ["cwd", "timestamp"]);
	else if (kind === "turn_context") copyKeys(state, payload, ["cwd", "model", "effort"]);
	else if (kind === "event_msg" && payload.type === "thread_settings_applied") {
		const settings = isObject(payload.thread_settings) ? payload.thread_settings : {};
		copyKeys(state, settings, ["model", "cwd"], true);
		if ("reasoning_effort" in settings) state.effort = settings.reasoning_effort;
	} else if (kind === "event_msg" && payload.type === "token_count") {
		// A rate-limit refresh arrives with `info: null`; it must not erase the token usage.
		if (payload.info) state.info = payload.info;
		const limits = payload.rate_limits;
		if (isObject(limits) && (limits.limit_id == null || limits.limit_id === "codex")) state.rate_limits = limits;
	}
}

export class RolloutReader {
	private offset = 0;
	private state: RolloutState = {};

	constructor(private readonly path: string) {}

	/** Read what was appended since the last call; throws when the file cannot be read. */
	read(): RolloutState {
		const fd = openSync(this.path, "r");
		try {
			const size = fstatSync(fd).size;
			if (size < this.offset) {
				this.offset = 0;
				this.state = {};
			}
			const buffer = Buffer.alloc(size - this.offset);
			const chunk = buffer.subarray(0, readSync(fd, buffer, 0, buffer.length, this.offset));
			let start = 0;
			for (let end = chunk.indexOf(10); end !== -1; end = chunk.indexOf(10, start)) {
				const line = chunk.toString("utf8", start, end);
				start = end + 1;
				try {
					consume(this.state, JSON.parse(line));
				} catch {}
			}
			this.offset += start;
		} finally {
			closeSync(fd);
		}
		return this.state;
	}
}
