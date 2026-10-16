import { resolveConfig } from "../../../src/application/config.ts";
import { renderStatusline } from "../../../src/application/render-statusline.ts";
import type { StatusSnapshot } from "../../../src/domain/model/snapshot.ts";

export const NOW_MS = 1_790_000_000_000;

/** The two rows the collector draws in a pane `columns` wide: truecolor, dark, padded to two rows. */
export function renderRows(snapshot: StatusSnapshot, columns: number): string[] {
	const { config } = resolveConfig({ harness: "codex", file: null, env: {}, flags: { colors: "truecolor", theme: "dark" } });
	const rows = renderStatusline(snapshot, { config, width: columns - 4, nowMs: NOW_MS, appearance: "dark", env: {}, measure: Bun.stringWidth });
	return [rows[0] ?? "", rows[1] ?? ""];
}

export const stripAnsi = (text: string): string => text.replace(/\x1b\][^\x07]*\x07/g, "").replace(/\x1b\[[0-9;]*m/g, "");
