// What the plugin needs from its host runtime. OpenCode's TUI runs plugins under Bun in the
// compiled binary (2.0.30 exposes `Bun` with `spawn` and `stringWidth` there), but the plugin
// package also ships a Node loader (`@opencode/util` maps `#runtime-import` to a Node variant), so
// nothing here may assume the `Bun` global: commands go through node:child_process, and text is
// measured with Bun.stringWidth only when it exists.

import { execFile } from "node:child_process";
import { accessSync, constants } from "node:fs";
import path from "node:path";
import type { CommandRunner } from "../../infrastructure/process.ts";

const DEFAULT_TIMEOUT_MS = 5000;
const MAX_BUFFER = 8 * 1024 * 1024;

/** stdout when the command exits 0; null on any failure (non-zero exit, missing binary, timeout). */
export const nodeRunner: CommandRunner = (cmd, opts = {}) => {
	const { promise, resolve } = Promise.withResolvers<string | null>();
	const [file, ...args] = cmd;
	if (file === undefined) {
		resolve(null);
		return promise;
	}
	try {
		const child = execFile(
			file,
			args,
			{ cwd: opts.cwd, timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS, maxBuffer: MAX_BUFFER, killSignal: "SIGKILL", windowsHide: true },
			(error, stdout) => resolve(error ? null : String(stdout)),
		);
		child.stdin?.on("error", () => {});
		child.stdin?.end(opts.stdin);
	} catch {
		resolve(null);
	}
	return promise;
};

/** The first executable `bin` on PATH, or null; Bun.which is not available under the Node loader. */
export function nodeWhich(bin: string, pathEnv: string | undefined = process.env.PATH): string | null {
	for (const dir of (pathEnv ?? "").split(path.delimiter)) {
		if (!dir) continue;
		const candidate = path.join(dir, bin);
		try {
			accessSync(candidate, constants.X_OK);
			return candidate;
		} catch {}
	}
	return null;
}

function isWide(code: number): boolean {
	return (
		(code >= 0x1100 && code <= 0x115f) ||
		(code >= 0x2e80 && code <= 0xa4cf) ||
		(code >= 0xac00 && code <= 0xd7a3) ||
		(code >= 0xf900 && code <= 0xfaff) ||
		(code >= 0xfe30 && code <= 0xfe4f) ||
		(code >= 0xff00 && code <= 0xff60) ||
		(code >= 0xffe0 && code <= 0xffe6) ||
		(code >= 0x1f300 && code <= 0x1faff) ||
		(code >= 0x20000 && code <= 0x3fffd)
	);
}

/** Terminal cell width without Bun: CJK and emoji count as two, combining marks as none. */
export function cellWidth(text: string): number {
	let width = 0;
	for (const glyph of text) {
		const code = glyph.codePointAt(0) ?? 0;
		if ((code >= 0x300 && code <= 0x36f) || (code >= 0xfe00 && code <= 0xfe0f)) continue;
		width += isWide(code) ? 2 : 1;
	}
	return width;
}

/** Bun.stringWidth when the host is Bun, else the portable estimate. */
export function textWidth(): (text: string) => number {
	return typeof Bun !== "undefined" && typeof Bun.stringWidth === "function" ? Bun.stringWidth : cellWidth;
}
