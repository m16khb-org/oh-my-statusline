// Install oh-my-statusline into omp's user extensions directory.
//
// omp (18.x) scans `<agent dir>/extensions/*/index.{ts,js}` one level deep (discovery/helpers.ts
// discoverExtensionModulePaths), so the install directory carries a root `index.ts` that
// re-exports the extension, next to the copied `src/` tree, which omp never scans on its own.
// Nothing else is changed; omp's config.yml is left alone.
//
// A standalone omp-statusline (`<agent dir>/extensions/omp-statusline/`) is removed when ours is
// installed: omp loads every extension directory, so both would draw a widget.

import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { canOwn, holdsOnly, installTree, removeTree, runSteps, type Step } from "../../infrastructure/install-kit.ts";

export interface OmpInstallOptions {
	home: string;
	env: Record<string, string | undefined>;
	sourceRoot: string;
	/** Save the plain glyph mode (no private-use glyphs) for the extension. */
	plain: boolean;
	log: (line: string) => void;
	/** The omp agent directory; default `$PI_CODING_AGENT_DIR`, else `<home>/.omp/agent`. */
	agentDir?: string;
	/** Print every step, write nothing. */
	dryRun?: boolean;
}

export type OmpUninstallOptions = Omit<OmpInstallOptions, "plain" | "sourceRoot">;

/** What omp loads: the extension's default export, from the copied source tree. */
const ENTRY_SHIM = 'export { default } from "./src/harnesses/omp/main.ts";\n';

/** `<agent dir>/extensions/oh-my-statusline`; a profile uses `~/.omp/profiles/<name>/agent`. */
export function ompInstallDir(opts: Pick<OmpInstallOptions, "home" | "env" | "agentDir">): string {
	const agentDir = opts.agentDir ?? (opts.env.PI_CODING_AGENT_DIR || path.join(opts.home, ".omp", "agent"));
	return path.join(agentDir, "extensions", "oh-my-statusline");
}

/** What the standalone omp-statusline's install.sh leaves in its directory. */
const LEGACY_FILES = [".omp-statusline", "index.ts", "render.ts", "config.json"];

/** The old extension directory next to ours, when it is the standalone omp-statusline. */
function legacyDir(opts: Pick<OmpInstallOptions, "home" | "env" | "agentDir">): string | null {
	const dir = path.join(path.dirname(ompInstallDir(opts)), "omp-statusline");
	if (!existsSync(dir)) return null;
	// install.sh leaves a marker; a hand copy has only the two sources, with the project's header comment.
	const header = (file: string) => {
		try {
			return readFileSync(path.join(dir, file), "utf8").slice(0, 200).startsWith("// omp-statusline");
		} catch {
			return false;
		}
	};
	if (existsSync(path.join(dir, ".omp-statusline")) || (header("index.ts") && header("render.ts"))) return dir;
	return null;
}

export function install(opts: OmpInstallOptions): void {
	const dir = ompInstallDir(opts);
	const legacy = legacyDir(opts);
	if (legacy !== null && !holdsOnly(legacy, LEGACY_FILES)) {
		throw new Error(`${legacy} is the old omp-statusline but holds files it did not install; move it away first, or omp loads two status lines.`);
	}
	if (!canOwn(dir)) throw new Error(`${dir} exists and was not installed by oh-my-statusline; move it away first.`);

	let plain = opts.plain;
	if (legacy !== null) {
		try {
			if ((JSON.parse(readFileSync(path.join(legacy, "config.json"), "utf8")) as { glyphs?: unknown }).glyphs === "plain") plain = true;
		} catch {
			// no readable glyph choice: the default stays
		}
	}
	const glyphs = plain ? "plain" : "powerline";
	const steps: Step[] = [
		{
			say: `copy the runtime into ${dir} (${glyphs} glyphs)`,
			run: () => void installTree(opts.sourceRoot, dir, "omp", { "index.ts": ENTRY_SHIM, "config.json": `${JSON.stringify({ glyphs })}\n` }),
		},
	];
	if (legacy !== null) {
		steps.push({ say: `remove the old omp-statusline ${legacy} (omp would load two widgets)`, run: () => rmSync(legacy, { recursive: true, force: true }), legacy: true });
	}
	runSteps(steps, opts);
	if (opts.dryRun) return;
	opts.log(`Installed oh-my-statusline to ${dir} (${glyphs} glyphs).`);
	if (!Bun.which("omp")) opts.log("omp is not on PATH; install it first: https://github.com/can1357/oh-my-pi");
	opts.log(`Restart omp to load it. Preview without omp: bun ${path.join(dir, "src", "harnesses", "omp", "main.ts")} --demo`);
}

export function uninstall(opts: OmpUninstallOptions): void {
	const dir = ompInstallDir(opts);
	if (!canOwn(dir)) throw new Error(`${dir} was not installed by oh-my-statusline; leaving it alone.`);
	if (!existsSync(dir)) {
		opts.log(`oh-my-statusline is not installed in ${path.dirname(path.dirname(dir))}.`);
		return;
	}
	runSteps([{ say: `remove ${dir}`, run: () => void removeTree(dir) }], opts);
	if (!opts.dryRun) opts.log(`Removed ${dir}. Restart omp to get its default status bar back.`);
}
