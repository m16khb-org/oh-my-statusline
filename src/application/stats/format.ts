// Human output of `stats`: an aligned table. Missing data prints as `–`, never as 0.

import { localMinute } from "./aggregate.ts";
import type { StatsSummary, UsageSummary } from "./model.ts";

const DASH = "–";
const HEADER = ["HARNESS", "MODEL", "SESSIONS", "COST", "INPUT", "OUTPUT", "CACHE-R", "CACHE-W", "TOTAL", "FIRST", "LAST"];
/** Columns left-aligned; the rest are numeric and right-aligned. */
const TEXT_COLUMNS = 2;
const FIRST_DATE_COLUMN = 9;

function compact(n: number): string {
	if (n < 1000) return String(n);
	const units: Array<[number, string]> = [
		[1e9, "B"],
		[1e6, "M"],
		[1e3, "K"],
	];
	for (const [size, suffix] of units) if (n >= size) return `${(n / size).toFixed(n >= size * 100 ? 0 : 1)}${suffix}`;
	return String(n);
}

function money(u: UsageSummary): string {
	if (u.costUsd === null) return DASH;
	const text = u.costUsd > 0 && u.costUsd < 0.01 ? u.costUsd.toFixed(4) : u.costUsd.toFixed(2);
	return `$${text}${u.costSessions < u.sessions ? "*" : ""}`;
}

function cells(label: string, model: string, u: UsageSummary, tz: string): string[] {
	if (u.sessions === 0) return [label, model || "no data", ...Array<string>(HEADER.length - 2).fill(DASH)];
	const t = u.tokens;
	// A source that records only a lifetime total has no input/output split to show.
	const split = (n: number): string => (t.unsplit === t.total ? DASH : compact(n));
	const at = (iso: string | null): string => (iso === null ? DASH : localMinute(Date.parse(iso), tz));
	return [
		label,
		model,
		String(u.sessions),
		money(u),
		split(t.input),
		split(t.output),
		split(t.cacheRead),
		split(t.cacheWrite),
		compact(t.total),
		at(u.firstActivity),
		at(u.lastActivity),
	];
}

export function renderTable(summary: StatsSummary): string {
	const tz = summary.timezone;
	const rows: string[][] = [];
	let partialCost = false;
	for (const h of summary.harnesses) {
		rows.push(cells(h.harness, h.sessions === 0 ? "" : "all models", h, tz));
		for (const m of h.models) rows.push(cells("", `  ${m.model}`, m, tz));
		partialCost ||= h.costUsd !== null && h.costSessions < h.sessions;
	}
	if (summary.harnesses.length > 1) rows.push(cells("TOTAL", "", summary.total, tz));
	const all = [HEADER, ...rows];
	const widths = HEADER.map((_, i) => Math.max(...all.map((r) => (r[i] ?? "").length)));
	const line = (r: string[]): string =>
		r
			.map((c, i) => (i < TEXT_COLUMNS || i >= FIRST_DATE_COLUMN ? c.padEnd(widths[i] ?? 0) : c.padStart(widths[i] ?? 0)))
			.join("  ")
			.trimEnd();
	const window = summary.since.day === null ? "all time" : `since ${summary.since.day}`;
	const out = [`Usage ${window} (${tz})`, line(HEADER), ...rows.map(line)];
	if (partialCost) out.push("* cost covers only the sessions that stored one; tokens cover every session");
	return `${out.join("\n")}\n`;
}
