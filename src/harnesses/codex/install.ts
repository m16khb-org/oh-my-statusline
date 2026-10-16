// Installs the Codex launchers. Nothing here touches the official Codex executable or its
// config: `codex-statusline` runs Codex under the status line, `codex-plain` runs it without,
// and the optional `codex` wrapper shadows the official command when its directory is first on PATH.
//
// A standalone codex-statusline (`<data>/codex-statusline/install.json` and the launchers it lists) is
// taken over: its unmodified launchers go, its Codex path, glyph mode and `codex` wrapper choice carry
// over, and its install directory is removed once ours is in place.

import { chmodSync, existsSync, lstatSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { holdsOnly, installTree, removeTree, runSteps, sha256, type Step } from "../../infrastructure/install-kit.ts";
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
	/** Print every step, write nothing. */
	dryRun?: boolean;
}

export type CodexUninstallOptions = Omit<CodexInstallOptions, "sourceRoot" | "plain">;

/** What the standalone codex-statusline keeps in its install directory. */
const LEGACY_FILES = ["statusline.py", "renderer.sh", "LICENSE", "install.json", "__pycache__"];

export function codexInstallDir(opts: Pick<CodexInstallOptions, "home" | "env">): string {
	return path.resolve(opts.env.XDG_DATA_HOME || path.join(opts.home, ".local", "share"), "oh-my-statusline", "codex");
}

function legacyDir(opts: Pick<CodexInstallOptions, "home" | "env">): string {
	return path.resolve(opts.env.XDG_DATA_HOME || path.join(opts.home, ".local", "share"), "codex-statusline");
}

/** Present at all, including a dangling symlink. */
const exists = (file: string): boolean => lstatSync(file, { throwIfNoEntry: false }) !== undefined;

/** The file is a regular file that still has exactly the bytes the installer wrote. */
const unmodified = (file: string, checksum: string | undefined): boolean => statSync(file, { throwIfNoEntry: false })?.isFile() === true && sha256(file) === checksum;

export function install(opts: CodexInstallOptions): void {
	const dest = codexInstallDir(opts);
	const bin = path.resolve(opts.binDir ?? path.join(opts.home, ".local", "bin"));
	const prior = readManifest(dest);
	const oldDir = legacyDir(opts);
	const old = holdsOnly(oldDir, LEGACY_FILES, ["statusline.py", "install.json"]) ? readManifest(oldDir) : null;
	const real = findCodex(opts.codex || prior.codex || old?.codex, opts.env);
	if (real === null) throw new Error("Codex CLI not found. Install Codex first, or pass --codex /path/to/codex");
	if (!Bun.which("tmux", { PATH: opts.env.PATH })) throw new Error("tmux is required; install it with your package manager");

	// The old install's launchers that still match what it wrote: removed, and a `codex` wrapper among them is kept as ours.
	const oldLaunchers = Object.entries(old?.launchers ?? {});
	const wrapCodex = opts.wrapCodex || oldLaunchers.some(([file, checksum]) => path.basename(file) === "codex" && unmodified(file, checksum));
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
	if (wrapCodex) targets[path.join(bin, "codex")] = launcher;

	// Refuse before writing anything: a command we did not install is never replaced.
	for (const file of Object.keys(targets)) {
		if (exists(file) && !unmodified(file, prior.launchers?.[file]) && !unmodified(file, old?.launchers?.[file])) {
			throw new Error(`Refusing to replace existing command: ${file}`);
		}
	}

	const steps: Step[] = [];
	for (const [file, checksum] of oldLaunchers) {
		if (unmodified(file, checksum)) {
			steps.push({ say: `remove the old launcher ${file}`, run: () => rmSync(file), legacy: true });
		} else if (exists(file)) opts.log(`Keeping ${file}: it was modified since the old codex-statusline wrote it.`);
	}
	const glyphs = opts.plain || old?.glyphs === "plain" ? "plain" : "powerline";
	const manifestFile = path.join(dest, "install.json");
	steps.push({
		say: `copy the runtime into ${dest} and write ${Object.keys(targets).join(", ")}`,
		run: () => {
			installTree(opts.sourceRoot, dest, "codex");
			mkdirSync(bin, { recursive: true });
			const launchers = { ...prior.launchers };
			for (const [file, content] of Object.entries(targets)) {
				writeFileSync(file, content);
				chmodSync(file, 0o755);
				launchers[file] = sha256(file);
			}
			const manifest: Manifest = { codex: real, glyphs, launchers };
			writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
			chmodSync(manifestFile, 0o600);
		},
	});
	if (old !== null) {
		steps.push({ say: `remove the old install directory ${oldDir}`, run: () => rmSync(oldDir, { recursive: true, force: true }), legacy: true });
	} else if (existsSync(oldDir)) opts.log(`${oldDir} is not an installation of codex-statusline; left it in place.`);

	runSteps(steps, opts);
	if (opts.dryRun) return;
	opts.log(`Installed: ${path.join(bin, "codex-statusline")}`);
	opts.log(`Original CLI: ${real}`);
	opts.log(`Put ${bin} first on PATH, then run rehash or open a new terminal.`);
}

/** Remove the launchers that are still exactly what we wrote, keep modified ones, then the install tree. */
export function uninstall(opts: CodexUninstallOptions): void {
	const dest = codexInstallDir(opts);
	const steps: Step[] = [];
	for (const [file, checksum] of Object.entries(readManifest(dest).launchers ?? {})) {
		if (unmodified(file, checksum)) {
			steps.push({
				say: `remove ${file}`,
				run: () => {
					rmSync(file);
					opts.log(`Removed ${file}`);
				},
			});
		} else if (exists(file)) opts.log(`Preserved modified launcher ${file}`);
	}
	steps.push({ say: `remove ${dest}`, run: () => void removeTree(dest) });
	runSteps(steps, opts);
	if (!opts.dryRun) opts.log("Official Codex preserved. Run rehash or open a new terminal.");
}
