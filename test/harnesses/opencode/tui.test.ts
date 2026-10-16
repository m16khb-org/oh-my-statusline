// The plugin definition: its id and where it claims space in the TUI. What the claims draw is
// covered by view.test.ts (data → rows) and test/domain/render.test.ts (cells).
import { describe, expect, test } from "bun:test";
import plugin from "../../../src/harnesses/opencode/tui.tsx";

describe("plugin", () => {
	test("is local.statusline and claims the prompt footer (prepended) and the home footer status (appended)", () => {
		const claims: Array<Record<string, unknown>> = [];
		let removed = 0;
		const cleanup = plugin.setup({
			ui: {
				slot: (claim: Record<string, unknown>) => {
					claims.push(claim);
					return () => {
						removed += 1;
					};
				},
			},
		} as never);

		expect(plugin.id).toBe("local.statusline");
		expect(claims.map(({ render, ...placement }) => placement)).toEqual([{ prepend: "prompt.footer" }, { append: "home.footer.status" }]);
		for (const claim of claims) expect(typeof claim.render).toBe("function");
		expect(cleanup).toBeUndefined();
		expect(removed).toBe(0);
	});
});
