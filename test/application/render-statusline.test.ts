import { describe, expect, test } from "bun:test";
import path from "node:path";
import { DEFAULT_CONFIG } from "../../src/application/config.ts";
import { renderStatusline } from "../../src/application/render-statusline.ts";
import { type HarnessId, toSnapshot } from "../../src/domain/model/snapshot.ts";

const FIXTURES = path.join(import.meta.dir, "..", "fixtures");

const NOW_MS = 1_790_000_000_000;
const HARNESSES: HarnessId[] = ["claude", "codex", "omp", "opencode"];
const golden: Record<string, Record<string, string[]>> = await Bun.file(`${FIXTURES}/golden/rows.json`).json();

describe("renderStatusline", () => {
	for (const harness of HARNESSES) {
		for (const width of [120, 60]) {
			test(`${harness} at width ${width} matches the golden rows`, async () => {
				const snapshot = toSnapshot(harness, await Bun.file(`${FIXTURES}/snapshots/${harness}.json`).json());
				const rows = renderStatusline(snapshot, {
					config: DEFAULT_CONFIG,
					width,
					nowMs: NOW_MS,
					appearance: "dark",
					env: { COLORTERM: "truecolor" },
					measure: Bun.stringWidth,
				});
				expect(rows).toEqual(golden[harness]?.[String(width)] ?? []);
			});
		}
	}

	test("theme auto follows the appearance; an explicit theme wins", async () => {
		const snapshot = toSnapshot("omp", await Bun.file(`${FIXTURES}/snapshots/omp.json`).json());
		const draw = (theme: "auto" | "dark" | "light", appearance: "dark" | "light") =>
			renderStatusline(snapshot, {
				config: { ...DEFAULT_CONFIG, theme },
				width: 120,
				nowMs: NOW_MS,
				appearance,
				env: { COLORTERM: "truecolor" },
				measure: Bun.stringWidth,
			});
		expect(draw("auto", "light")).toEqual(draw("light", "dark"));
		expect(draw("auto", "light")).not.toEqual(draw("auto", "dark"));
	});

	test("plain glyphs and 256 colors reach the renderer", async () => {
		const snapshot = toSnapshot("omp", await Bun.file(`${FIXTURES}/snapshots/omp.json`).json());
		const rows = renderStatusline(snapshot, {
			config: { ...DEFAULT_CONFIG, glyphs: "plain" },
			width: 120,
			nowMs: NOW_MS,
			appearance: "dark",
			env: {},
			measure: Bun.stringWidth,
		});
		const text = rows.join("\n");
		expect(text).not.toContain("\ue0b0");
		expect(text).not.toContain("38;2;");
		expect(text).toContain("38;5;");
	});
});
