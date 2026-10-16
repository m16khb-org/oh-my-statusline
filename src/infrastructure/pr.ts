import type { PrPort } from "../application/ports.ts";
import type { PrState } from "../domain/model/snapshot.ts";
import { type CommandRunner, run } from "./process.ts";

function parseJson(raw: string): Record<string, unknown> | null {
	try {
		const v: unknown = JSON.parse(raw);
		return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null;
	} catch {
		return null;
	}
}

/** `gh pr view --json number,url,state,isDraft,reviewDecision`; only OPEN pull requests count. */
export function parseGhPr(raw: string): PrState | null {
	const pr = parseJson(raw);
	if (!pr || typeof pr.number !== "number" || !pr.number || pr.state !== "OPEN") return null;
	const state: PrState["state"] = pr.isDraft
		? "draft"
		: pr.reviewDecision === "APPROVED"
			? "approved"
			: pr.reviewDecision === "CHANGES_REQUESTED"
				? "changes_requested"
				: "pending";
	return { number: pr.number, url: typeof pr.url === "string" ? pr.url : "", state, kind: "pr" };
}

/** `glab mr view --output json`; only opened merge requests count. */
export function parseGlabMr(raw: string): PrState | null {
	const mr = parseJson(raw);
	if (!mr || typeof mr.iid !== "number" || !mr.iid || mr.state !== "opened") return null;
	return { number: mr.iid, url: typeof mr.web_url === "string" ? mr.web_url : "", state: mr.draft ? "draft" : "pending", kind: "mr" };
}

export class PrAdapter implements PrPort {
	constructor(
		private readonly exec: CommandRunner = run,
		private readonly which: (bin: string) => string | null = Bun.which,
	) {}

	async read(cwd: string): Promise<PrState | null> {
		const remote = (await this.exec(["git", "remote", "get-url", "origin"], { cwd }))?.trim() ?? "";
		const gitlab = /gitlab/i.test(remote);
		const bin = gitlab ? "glab" : "gh";
		if (!this.which(bin)) return null;
		const out = await this.exec(
			gitlab ? ["glab", "mr", "view", "--output", "json"] : ["gh", "pr", "view", "--json", "number,url,state,isDraft,reviewDecision"],
			{ cwd },
		);
		if (!out) return null;
		return gitlab ? parseGlabMr(out) : parseGhPr(out);
	}
}
