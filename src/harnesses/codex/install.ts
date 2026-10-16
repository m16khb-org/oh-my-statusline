// Installs the Codex launchers. Nothing here touches the official Codex executable or its
// config: `codex-statusline` runs Codex under the status line, `codex-plain` runs it without,
// and the optional `codex` wrapper shadows the official command when its directory is first on PATH.

import { chmodSync, lstatSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { installTree, removeTree, sha256 } from "../../infrastructure/install-kit.ts";
import { findCodex, LAUNCHER_MARKER } from "./launcher.ts";
import { type Manifest, readManifest } from "./manifest.ts";
import { shellQuote } from "./tmux.ts";

export interface CodexInstallOptions {
	home: string;
	env: Record<string, string | undefined>;
	/** The repository (or package) root that holds `src/`. */
	sourceRoot: string;
	/** Badges without Powerline glyphs. */
	plain: boolean;
	log: (line: string) => void;
	/** Where the launchers go; default `<home>/.local/bin`. */
	binDir?: string;
	/** The original Codex executable; default: the one found on PATH. */
	codex?: string;
	/** Also install a `codex` launcher. */
	wrapCodex?: boolean;
}

function installDir(opts: CodexInstallOptions): string {
	return path.resolve(opts.env.XDG_DATA_HOME || path.join(opts.home, ".local", "share"), "oh-my-statusline", "codex");
}

/** Present at all, including a dangling symlink. */
const exists = (file: string): boolean => lstatSync(file, { throwIfNoEntry: false }) !== undefined;

export function install(opts: CodexInstallOptions): void {
	const dest = installDir(opts);
	const bin = path.resolve(opts.binDir ?? path.join(opts.home, ".local", "bin"));
	const prior = readManifest(dest);
	const real = findCodex(opts.codex || prior.codex, opts.env);
	if (real === null) throw new Error("Codex CLI not found. Install Codex first, or pass --codex /path/to/codex");
	if (!Bun.which("tmux", { PATH: opts.env.PATH })) throw new Error("tmux is required; install it with your package manager");

	// The launcher is a /bin/sh script: the bun path and the install path are quoted, "$@" forwards arguments untouched.
	const launcher =
		`#!/bin/sh\n${LAUNCHER_MARKER}\n` +
		'[ -n "$HERDR_PANE_ID" ] && export HERDR_AGENT="${HERDR_AGENT:-codex}"\n' +
		`exec ${shellQuote(process.execPath)} ${shellQuote(path.join(dest, "src", "harnesses", "codex", "launcher.ts"))} "$@"\n`;
	const plain = `#!/bin/sh\n${LAUNCHER_MARKER}\nexec ${shellQuote(real)} "$@"\n`;
	const targets: Record<string, string> = {
		[path.join(bin, "codex-statusline")]: launcher,
		[path.join(bin, "codex-plain")]: plain,
	};
	if (opts.wrapCodex) targets[path.join(bin, "codex")] = launcher;

	// Refuse before writing anything: a command we did not install is never replaced.
	for (const file of Object.keys(targets)) {
		if (exists(file) && !(statSync(file, { throwIfNoEntry: false })?.isFile() && prior.launchers?.[file] === sha256(file))) {
			throw new Error(`Refusing to replace existing command: ${file}`);
		}
	}
	installTree(opts.sourceRoot, dest, "codex");
	mkdirSync(bin, { recursive: true });
	const launchers = { ...prior.launchers };
	for (const [file, content] of Object.entries(targets)) {
		writeFileSync(file, content);
		chmodSync(file, 0o755);
		launchers[file] = sha256(file);
	}
	const manifest: Manifest = { codex: real, glyphs: opts.plain ? "plain" : "powerline", launchers };
	const manifestFile = path.join(dest, "install.json");
	writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
	chmodSync(manifestFile, 0o600);
	opts.log(`Installed: ${path.join(bin, "codex-statusline")}`);
	opts.log(`Original CLI: ${real}`);
	opts.log(`Put ${bin} first on PATH, then run rehash or open a new terminal.`);
}

/** Remove the launchers that are still exactly what we wrote, keep modified ones, then the install tree. */
export function uninstall(opts: CodexInstallOptions): void {
	const dest = installDir(opts);
	for (const [file, checksum] of Object.entries(readManifest(dest).launchers ?? {})) {
		if (statSync(file, { throwIfNoEntry: false })?.isFile() && sha256(file) === checksum) {
			rmSync(file);
			opts.log(`Removed ${file}`);
		} else if (exists(file)) opts.log(`Preserved modified launcher ${file}`);
	}
	removeTree(dest);
	opts.log("Official Codex preserved. Run rehash or open a new terminal.");
}
