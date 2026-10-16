// Today's cost computed out of process, for the TUI harnesses: the collector reads session files
// synchronously (seconds on a cold cache), which would freeze the host's event loop. A child
// `bun src/cli/today-cost.ts` does the reading; the host only awaits its stdout. This module
// must stay free of bun:sqlite imports so it loads under the Node loader (OpenCode).

import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CommandRunner } from "../process.ts";

const SCRIPT = fileURLToPath(new URL("../../cli/today-cost.ts", import.meta.url));
/** A cold first collection took ~5 s on a large history; give it room. */
const TIMEOUT_MS = 120_000;

/** `bun` on PATH, else the running executable when it is bun itself; null when neither. */
export function findBun(which: (bin: string) => string | null, execPath: string): string | null {
	return which("bun") ?? (path.basename(execPath).startsWith("bun") ? execPath : null);
}

/** Today's cost from the child process; null when bun is missing, the child fails, or no cost is stored. */
export async function todayCostViaProcess(exec: CommandRunner, bun: string | null): Promise<number | null> {
	if (!bun) return null;
	const out = (await exec([bun, SCRIPT], { timeoutMs: TIMEOUT_MS }))?.trim();
	const value = out ? Number(out) : Number.NaN;
	return Number.isFinite(value) ? value : null;
}
