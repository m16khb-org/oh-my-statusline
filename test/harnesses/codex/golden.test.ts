// Golden rows: a rollout → snapshot → the two rendered rows must equal what the original
// codex-statusline renders (statusline.py payload_for + renderer.sh) for the same data.
//
// Generated once from the reference (read-only, no files changed there), with PYTHONDONTWRITEBYTECODE=1:
//   rollout.jsonl                       hand-written records (partial/garbage line, a foreign limit id,
//                                       a settings change, no resets_at so nothing depends on the clock)
//   python: m = import statusline.py; m.RolloutReader(rollout).read() → state; per case
//     os.environ STATUSLINE_THEME=dark, STATUSLINE_GIT_RAW=<gitRaw>;
//     p = m.payload_for(state, "/golden/my-app", started); p.cost.total_duration_ms = 0;
//     p.cost.total_lines_added/removed = <lines>; rows = m.render(p, <columns>, <cache dir>)
//   → golden-rows.json {state, cases: [{name, columns, gitRaw, lines, rows}]}
// Cases: "full" 140 columns, "narrow" 70 columns, "empty" (model and effort only: no rollout state, no git; the
// `ctx —` / `7d —` placeholders).

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parsePorcelain } from "../../../src/infrastructure/git.ts";
import { snapshotFor } from "../../../src/harnesses/codex/payload.ts";
import { RolloutReader, type RolloutState } from "../../../src/harnesses/codex/rollout.ts";
import { NOW_MS, renderRows } from "./helpers.ts";

const fixtures = path.resolve(import.meta.dir, "../../fixtures/codex");
const golden = JSON.parse(readFileSync(path.join(fixtures, "golden-rows.json"), "utf8")) as {
	state: RolloutState;
	cases: { name: string; columns: number; gitRaw: string; lines: [number, number]; rows: string[] }[];
};

test("the rollout fixture reads to the state the reference read", () => {
	expect(new RolloutReader(path.join(fixtures, "rollout.jsonl")).read()).toEqual(golden.state);
});

for (const { name, columns, gitRaw, lines, rows } of golden.cases) {
	test(`rows equal the original renderer's: ${name}`, () => {
		const state = name === "empty" ? { model: "gpt-6-astra", effort: "max" } : new RolloutReader(path.join(fixtures, "rollout.jsonl")).read();
		const cwd = "/golden/my-app";
		const git = gitRaw ? { top: cwd, main: cwd, state: parsePorcelain(gitRaw) } : null;
		const snapshot = snapshotFor(state, { cwd, startedMs: NOW_MS, nowMs: NOW_MS, linesAdded: lines[0], linesRemoved: lines[1], git });
		expect(renderRows(snapshot, columns)).toEqual(rows);
	});
}
