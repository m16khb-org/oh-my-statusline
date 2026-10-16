// Value objects shared by the snapshot and the render rules. Each constructor accepts `unknown`
// because harness payloads are untyped JSON; invalid input never throws. The aliases are not
// branded: every snapshot is built through toSnapshot, which applies these constructors, so the
// range guarantee holds by construction without casts at every test and adapter call site.

/** A share in percent, 0..100, with at most one decimal place. */
export type Percentage = number;

/** A non-negative whole number of tokens. */
export type TokenAmount = number;

/** An sRGB color as [red, green, blue], each a whole number in 0..255. */
export type Rgb = readonly [number, number, number];

/** A finite number from a number or numeric string, else undefined. */
export function finiteNumber(raw: unknown): number | undefined {
	const value = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : Number.NaN;
	return Number.isFinite(value) ? value : undefined;
}

/** Clamp to 0..100 and round to tenths; null when the input is not a finite number. */
export function toPercentage(raw: unknown): Percentage | null {
	const value = finiteNumber(raw);
	if (value === undefined) return null;
	return Math.round(Math.min(100, Math.max(0, value)) * 10) / 10;
}

/** Whole tokens, floored; anything invalid or negative is 0. */
export function toTokenAmount(raw: unknown): TokenAmount {
	const value = finiteNumber(raw);
	return value === undefined || value < 0 ? 0 : Math.floor(value);
}

export function rgbToHex(color: Rgb): string {
	return `#${color.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}
