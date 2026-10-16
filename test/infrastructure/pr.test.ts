import { expect, test } from "bun:test";
import { PrAdapter, parseGhPr, parseGlabMr } from "../../src/infrastructure/pr.ts";

const gh = (o: object) => JSON.stringify({ number: 7, url: "https://x/pull/7", state: "OPEN", isDraft: false, reviewDecision: "", ...o });

test("gh states", () => {
	expect(parseGhPr(gh({ isDraft: true }))?.state).toBe("draft");
	expect(parseGhPr(gh({ reviewDecision: "APPROVED" }))?.state).toBe("approved");
	expect(parseGhPr(gh({ reviewDecision: "CHANGES_REQUESTED" }))?.state).toBe("changes_requested");
	expect(parseGhPr(gh({ reviewDecision: "REVIEW_REQUIRED" }))).toEqual({ number: 7, url: "https://x/pull/7", state: "pending", kind: "pr" });
});
test("closed, merged and malformed give null", () => {
	expect(parseGhPr(gh({ state: "CLOSED" }))).toBeNull();
	expect(parseGhPr(gh({ state: "MERGED" }))).toBeNull();
	expect(parseGhPr("{nope")).toBeNull();
	expect(parseGhPr("null")).toBeNull();
	expect(parseGlabMr("{nope")).toBeNull();
});
test("glab", () => {
	const mr = (o: object) => JSON.stringify({ iid: 3, web_url: "https://g/mr/3", state: "opened", draft: false, ...o });
	expect(parseGlabMr(mr({}))).toEqual({ number: 3, url: "https://g/mr/3", state: "pending", kind: "mr" });
	expect(parseGlabMr(mr({ draft: true }))?.state).toBe("draft");
	expect(parseGlabMr(mr({ state: "merged" }))).toBeNull();
});
test("adapter picks glab for gitlab remotes and null without the binary", async () => {
	const calls: string[][] = [];
	const exec = async (cmd: string[]) => {
		calls.push(cmd);
		if (cmd[0] === "git") return "git@gitlab.com:a/b.git\n";
		return JSON.stringify({ iid: 1, state: "opened" });
	};
	expect((await new PrAdapter(exec, () => "/bin/glab").read("/x"))?.kind).toBe("mr");
	expect(calls[1]?.[0]).toBe("glab");
	expect(await new PrAdapter(exec, () => null).read("/x")).toBeNull();
	const ghExec = async (cmd: string[]) => (cmd[0] === "git" ? "git@github.com:a/b.git" : gh({}));
	expect((await new PrAdapter(ghExec, () => "/bin/gh").read("/x"))?.kind).toBe("pr");
});
