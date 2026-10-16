// Shared helpers for the harness line parsers.

export type Json = Record<string, unknown>;

/** A finite non-negative number, else 0. */
export function num(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

/** A finite non-negative number, else null (distinguishes "no stored value" from 0). */
export function numOrNull(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

/** The parsed line when it is a JSON object, else null. */
export function parseObject(text: string): Json | null {
	try {
		const value: unknown = JSON.parse(text);
		return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Json) : null;
	} catch {
		return null;
	}
}

export function obj(value: unknown): Json | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Json) : undefined;
}

export function str(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Epoch ms of an ISO timestamp, NaN when absent or unparseable. */
export function isoMs(value: unknown): number {
	return typeof value === "string" ? Date.parse(value) : Number.NaN;
}
