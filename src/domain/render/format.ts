// Number formats and the time-to-limit rule. Integer math mirrors the shell renderers, so the
// same input formats identically across every harness.

/** Seconds → 3d5h, 1h12m, 42m, <1m. */
export function formatDuration(seconds: number): string {
	const s = Math.trunc(seconds);
	if (s >= 86_400) {
		const h = Math.trunc((s % 86_400) / 3600);
		return `${Math.trunc(s / 86_400)}d${h > 0 ? `${h}h` : ""}`;
	}
	if (s >= 3600) {
		const m = Math.trunc((s % 3600) / 60);
		return `${Math.trunc(s / 3600)}h${m > 0 ? `${m}m` : ""}`;
	}
	if (s >= 60) return `${Math.trunc(s / 60)}m`;
	return "<1m";
}

/** 283000 → 283k, 1000000 → 1M, 1500000 → 1.5M. */
export function formatTokens(n: number): string {
	if (n >= 1_000_000) {
		const tenth = Math.trunc((n % 1_000_000) / 100_000);
		return `${Math.trunc(n / 1_000_000)}${tenth > 0 ? `.${tenth}` : ""}M`;
	}
	if (n >= 1000) return `${Math.trunc(n / 1000)}k`;
	return String(Math.trunc(n));
}

/** Dollars → $4.21. */
export function formatCost(usd: number): string {
	const cents = Math.round(usd * 100);
	return `$${Math.trunc(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

/**
 * Seconds until a limit reaches 100% at the window's average pace so far, when that comes before
 * the reset; 0 means already at 100%; undefined means on pace, or under 5% of the window elapsed
 * (too early to tell). `tenths` is the used share in tenths of a percent; times are epoch seconds.
 */
export function etaLimit(tenths: number, resetsAtS: number, windowS: number, nowS: number): number | undefined {
	if (!(tenths > 0) || !(resetsAtS > nowS)) return undefined;
	const left = resetsAtS - nowS;
	const elapsed = windowS - resetsAtS + nowS;
	if (elapsed < Math.trunc(windowS / 20)) return undefined;
	if (tenths >= 1000) return 0;
	const t = Math.trunc(((1000 - tenths) * elapsed) / tenths);
	return t < left ? t : undefined;
}
