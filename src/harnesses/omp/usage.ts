// Usage limits for the active model from omp's usage reports (the data behind /usage).

import type { LimitWindow } from "../../domain/model/snapshot.ts";
import type { AccountIdentity, OmpModel, UsageLimit, UsageReport } from "./host.ts";

const FIVE_HOURS_MS = 18_000_000;
const SEVEN_DAYS_MS = 604_800_000;
/** Windows that only carry a duration match their length to within a minute. */
const DURATION_TOLERANCE_MS = 60_000;

/** Used fraction of a limit from whichever amount fields the provider filled in. */
function usedFraction(amount: NonNullable<UsageLimit["amount"]>): number | undefined {
	if (typeof amount.usedFraction === "number") return amount.usedFraction;
	if (typeof amount.used === "number" && typeof amount.limit === "number" && amount.limit > 0) return amount.used / amount.limit;
	if (amount.unit === "percent" && typeof amount.used === "number") return amount.used / 100;
	if (typeof amount.remainingFraction === "number") return 1 - amount.remainingFraction;
	return undefined;
}

function sameValue(a: unknown, b: unknown): boolean {
	return typeof a === "string" && typeof b === "string" && a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** The report of the account this session uses; with no identity match, the provider's first. */
function pickReport(reports: readonly UsageReport[], model: OmpModel, identity: AccountIdentity | undefined): UsageReport | undefined {
	const mine = reports.filter((r) => r.provider === model.provider && Array.isArray(r.limits));
	return (
		(identity &&
			mine.find((r) => {
				const m = r.metadata ?? {};
				if ((identity.orgId || m.orgId) && !sameValue(identity.orgId, m.orgId)) return false;
				return (
					sameValue(identity.accountId, m.accountId ?? m.account_id) ||
					sameValue(identity.email, m.email) ||
					(r.limits ?? []).some((l) => sameValue(identity.accountId, l.scope?.accountId))
				);
			})) ||
		mine[0]
	);
}

/**
 * Windows for the active model: the 5-hour and weekly windows, then any tier-scoped window
 * (Claude's per-model weekly limit, such as Fable). With several accounts for one provider, the
 * report of the account this session uses wins.
 */
export function usageWindows(
	reports: readonly UsageReport[] | null | undefined,
	model: OmpModel | undefined,
	identity: AccountIdentity | undefined,
): LimitWindow[] {
	if (!model || !reports) return [];
	const report = pickReport(reports, model, identity);
	if (!report) return [];

	const base: LimitWindow[] = [];
	const extra: LimitWindow[] = [];
	const seen = new Set<string>();
	// A window scoped to this exact model outranks the provider-wide window of the same name.
	const limits = [...(report.limits ?? [])].sort((a, b) => Number(!!b.scope?.modelId) - Number(!!a.scope?.modelId));
	for (const limit of limits) {
		const scope = limit.scope ?? {};
		if (scope.modelId && !sameValue(scope.modelId, model.id)) continue;
		const fraction = limit.amount ? usedFraction(limit.amount) : undefined;
		if (fraction === undefined || !Number.isFinite(fraction)) continue;
		// Windows are named 5h/7d, or only carry a duration.
		const ms = limit.window?.durationMs ?? Number.NaN;
		const windowId =
			scope.windowId === "5h" || Math.abs(ms - FIVE_HOURS_MS) <= DURATION_TOLERANCE_MS
				? "5h"
				: scope.windowId === "7d" || Math.abs(ms - SEVEN_DAYS_MS) <= DURATION_TOLERANCE_MS
					? "7d"
					: undefined;
		if (!windowId) continue;
		// omp reports tiers in lower case ("fable"); show them the way /usage and Claude Code do.
		const rawTier = scope.tier?.replace(/\s+/g, "") ?? "";
		const tier = rawTier.charAt(0).toUpperCase() + rawTier.slice(1);
		const label = !tier ? windowId : windowId === "7d" ? tier : `${tier}·5h`;
		if (seen.has(label)) continue;
		seen.add(label);
		const resetsAt = limit.window?.resetsAt;
		(tier ? extra : base).push({
			label,
			usedPct: Math.round(fraction * 1000) / 10,
			resetsAtMs: typeof resetsAt === "number" ? Math.floor(resetsAt / 1000) * 1000 : null,
			windowMs: ms ? Math.round(ms / 1000) * 1000 : windowId === "5h" ? FIVE_HOURS_MS : SEVEN_DAYS_MS,
			scopedModel: tier || null,
		});
	}
	base.sort((a, b) => (a.label === "5h" ? -1 : b.label === "5h" ? 1 : 0));
	return [...base, ...extra];
}
