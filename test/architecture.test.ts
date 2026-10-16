import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const DOMAIN_ROOT = path.join(import.meta.dir, "..", "src", "domain");

// Static and dynamic import/export specifiers, plus CommonJS require.
const SPECIFIER = [
	/\b(?:import|export)\s[^'"`;]*?\bfrom\s*["']([^"']+)["']/g,
	/\bimport\s*["']([^"']+)["']/g,
	/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
	/\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
];
// Host globals reach the runtime without an import; the domain must not touch them either.
const HOST_GLOBAL = /\b(?:Bun|process|Deno)\s*\.|\brequire\s*\(/;

function tsFiles(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) out.push(...tsFiles(full));
		else if (/\.tsx?$/.test(entry.name)) out.push(full);
	}
	return out.sort();
}

/** Every rule the domain layer breaks: outside imports, host globals, and import cycles. */
function domainViolations(root: string): string[] {
	const violations: string[] = [];
	const graph = new Map<string, string[]>();
	for (const file of tsFiles(root)) {
		const rel = path.relative(root, file);
		const code = readFileSync(file, "utf8")
			.replace(/\/\*[\s\S]*?\*\//g, "")
			.replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
		const edges: string[] = [];
		for (const pattern of SPECIFIER) {
			for (const match of code.matchAll(pattern)) {
				const spec = match[1] ?? "";
				if (!spec.startsWith(".")) {
					violations.push(`${rel}: imports "${spec}" (only relative domain imports are allowed)`);
					continue;
				}
				const target = path.resolve(path.dirname(file), spec);
				if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
					violations.push(`${rel}: imports "${spec}" from outside src/domain`);
					continue;
				}
				edges.push(target);
			}
		}
		const host = HOST_GLOBAL.exec(code);
		if (host) violations.push(`${rel}: uses host global "${host[0].replace(/\s/g, "")}"`);
		graph.set(file, edges);
	}

	const state = new Map<string, "visiting" | "done">();
	const visit = (file: string, trail: string[]): void => {
		if (state.get(file) === "done") return;
		if (state.get(file) === "visiting") {
			const cycle = [...trail.slice(trail.indexOf(file)), file].map((f) => path.relative(root, f));
			violations.push(`import cycle: ${cycle.join(" -> ")}`);
			return;
		}
		state.set(file, "visiting");
		for (const next of graph.get(file) ?? []) if (graph.has(next)) visit(next, [...trail, file]);
		state.set(file, "done");
	};
	for (const file of graph.keys()) visit(file, []);
	return violations;
}

describe("domain boundary", () => {
	test("src/domain imports nothing outside itself, touches no host globals, and has no cycles", () => {
		expect(tsFiles(DOMAIN_ROOT).length).toBeGreaterThan(0);
		expect(domainViolations(DOMAIN_ROOT)).toEqual([]);
	});

	test("the scanner catches every kind of violation", () => {
		const root = mkdtempSync(path.join(tmpdir(), "oms-arch-"));
		try {
			mkdirSync(path.join(root, "model"));
			const files: Record<string, string> = {
				"node.ts": 'import { readFileSync } from "node:fs";\n',
				"bun.ts": 'import { $ } from "bun";\n',
				"pkg.ts": 'export { x } from "some-package";\n',
				"dynamic.ts": 'export const m = () => import("node:path");\n',
				"escape.ts": 'import { a } from "../outside.ts";\n',
				"global.ts": "export const w = Bun.stringWidth('x');\n",
				"model/a.ts": 'import { b } from "./b.ts";\nexport const a = b;\n',
				"model/b.ts": 'import { a } from "./a.ts";\nexport const b = a;\n',
				"clean.ts": '// Bun.stringWidth is injected, never imported\nimport { a } from "./model/a.ts";\nexport const url = "https://example.com";\n',
			};
			for (const [name, body] of Object.entries(files)) writeFileSync(path.join(root, name), body);
			const found = domainViolations(root);
			expect(found).toContain('node.ts: imports "node:fs" (only relative domain imports are allowed)');
			expect(found).toContain('bun.ts: imports "bun" (only relative domain imports are allowed)');
			expect(found).toContain('pkg.ts: imports "some-package" (only relative domain imports are allowed)');
			expect(found).toContain('dynamic.ts: imports "node:path" (only relative domain imports are allowed)');
			expect(found).toContain('escape.ts: imports "../outside.ts" from outside src/domain');
			expect(found).toContain('global.ts: uses host global "Bun."');
			expect(found).toContain("import cycle: model/a.ts -> model/b.ts -> model/a.ts");
			expect(found.filter((v) => v.startsWith("clean.ts"))).toEqual([]);
			expect(found).toHaveLength(7);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
