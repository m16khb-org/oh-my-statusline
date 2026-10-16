// Install oh-my-statusline into omp's user extensions directory.
//
// omp (18.x) scans `<agent dir>/extensions/*/index.{ts,js}` one level deep (discovery/helpers.ts
// discoverExtensionModulePaths), so the install directory carries a root `index.ts` that
// re-exports the extension, next to the copied `src/` tree, which omp never scans on its own.
// Nothing else is changed; omp's config.yml is left alone.

import path from "node:path";
import { canOwn, installTree, removeTree } from "../../infrastructure/install-kit.ts";

export interface OmpInstallOptions {
	home: string;
	env: Record<string, string | undefined>;
	sourceRoot: string;
	/** Save the plain glyph mode (no private-use glyphs) for the extension. */
	plain: boolean;
	log: (line: string) => void;
	/** The omp agent directory; default `$PI_CODING_AGENT_DIR`, else `<home>/.omp/agent`. */
	agentDir?: string;
}

export type OmpUninstallOptions = Omit<OmpInstallOptions, "plain" | "sourceRoot">;

/** What omp loads: the extension's default export, from the copied source tree. */
const ENTRY_SHIM = 'export { default } from "./src/harnesses/omp/main.ts";\n';

/** `<agent dir>/extensions/oh-my-statusline`; a profile uses `~/.omp/profiles/<name>/agent`. */
export function ompInstallDir(opts: Pick<OmpInstallOptions, "home" | "env" | "agentDir">): string {
	const agentDir = opts.agentDir ?? (opts.env.PI_CODING_AGENT_DIR || path.join(opts.home, ".omp", "agent"));
	return path.join(agentDir, "extensions", "oh-my-statusline");
}

export function install(opts: OmpInstallOptions): void {
	const dir = ompInstallDir(opts);
	const glyphs = opts.plain ? "plain" : "powerline";
	installTree(opts.sourceRoot, dir, "omp", {
		"index.ts": ENTRY_SHIM,
		"config.json": `${JSON.stringify({ glyphs })}\n`,
	});
	opts.log(`Installed oh-my-statusline to ${dir} (${glyphs} glyphs).`);
	if (!Bun.which("omp")) opts.log("omp is not on PATH; install it first: https://github.com/can1357/oh-my-pi");
	opts.log(`Restart omp to load it. Preview without omp: bun ${path.join(dir, "src", "harnesses", "omp", "main.ts")} --demo`);
}

export function uninstall(opts: OmpUninstallOptions): void {
	const dir = ompInstallDir(opts);
	if (!canOwn(dir)) throw new Error(`${dir} was not installed by oh-my-statusline; leaving it alone.`);
	if (!removeTree(dir)) {
		opts.log(`oh-my-statusline is not installed in ${path.dirname(path.dirname(dir))}.`);
		return;
	}
	opts.log(`Removed ${dir}. Restart omp to get its default status bar back.`);
}
