// The command line behind install.sh and uninstall.sh: pick harnesses (named, `all`, or from a
// checklist), run each one's install or uninstall, report a refusal per harness without stopping
// the others, and exit non-zero when any failed.

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { claudeInstallDir, install as installClaude, uninstall as uninstallClaude } from "../harnesses/claude/install.ts";
import { codexInstallDir, install as installCodex, uninstall as uninstallCodex } from "../harnesses/codex/install.ts";
import { install as installOmp, ompInstallDir, uninstall as uninstallOmp } from "../harnesses/omp/install.ts";
import { install as installOpencode, opencodeInstallDir, uninstall as uninstallOpencode } from "../harnesses/opencode/install.ts";

export type Mode = "install" | "uninstall";

export const TARGETS = ["claude", "codex", "omp", "opencode"] as const;
export type Target = (typeof TARGETS)[number];

/** A mistake in the command line: reported with exit code 2. */
export class UsageError extends Error {}

export interface Parsed {
	targets: Target[];
	help: boolean;
	plain: boolean;
	dryRun: boolean;
	wrapCodex: boolean;
	agentDir?: string;
	configDir?: string;
	claudeDir?: string;
	binDir?: string;
	codex?: string;
}

/** Options that take a value (`--opt value` or `--opt=value`), and the field each one sets. */
const VALUE_OPTIONS: Record<string, "agentDir" | "configDir" | "claudeDir" | "binDir" | "codex"> = {
	"--agent-dir": "agentDir",
	"--config-dir": "configDir",
	"--claude-dir": "claudeDir",
	"--bin-dir": "binDir",
	"--codex": "codex",
};

const FLAG_OPTIONS: Record<string, "plain" | "dryRun" | "wrapCodex" | "help"> = {
	"--plain": "plain",
	"--dry-run": "dryRun",
	"--wrap-codex": "wrapCodex",
	"-h": "help",
	"--help": "help",
};

export function parseArgs(argv: readonly string[], home: string): Parsed {
	const parsed: Parsed = { targets: [], help: false, plain: false, dryRun: false, wrapCodex: false };
	const wanted = new Set<Target>();
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i] ?? "";
		if (!arg.startsWith("-")) {
			if (arg === "all") for (const target of TARGETS) wanted.add(target);
			else if ((TARGETS as readonly string[]).includes(arg)) wanted.add(arg as Target);
			else throw new UsageError(`unknown target: ${arg} (one of ${TARGETS.join(", ")}, all)`);
			continue;
		}
		const eq = arg.indexOf("=");
		const name = arg.startsWith("--") && eq > 0 ? arg.slice(0, eq) : arg;
		const flag = FLAG_OPTIONS[name];
		const field = VALUE_OPTIONS[name];
		if (flag !== undefined && name === arg) parsed[flag] = true;
		else if (field !== undefined) {
			const value = eq > 0 && name !== arg ? arg.slice(eq + 1) : argv[++i];
			if (value === undefined || value === "" || (eq < 0 && value.startsWith("--"))) throw new UsageError(`${name} needs a value`);
			parsed[field] = path.resolve(value === "~" ? home : value.startsWith("~/") ? path.join(home, value.slice(2)) : value);
		} else throw new UsageError(`unknown option: ${arg}`);
	}
	parsed.targets = TARGETS.filter((target) => wanted.has(target));
	return parsed;
}

/** Targets named by a checklist answer: numbers, names (or unique prefixes), `a`/`all`; empty keeps `marked`. */
export function parseSelection(answer: string, marked: readonly Target[]): Target[] {
	const words = answer.toLowerCase().split(/[\s,]+/).filter(Boolean);
	if (words.length === 0) return [...marked];
	const picked = new Set<Target>();
	for (const word of words) {
		if (word === "a" || word === "all") for (const target of TARGETS) picked.add(target);
		else {
			const byNumber = /^[1-4]$/.test(word) ? TARGETS[Number(word) - 1] : undefined;
			const byName = TARGETS.filter((target) => target.startsWith(word));
			const exact = TARGETS.find((target) => target === word);
			const chosen = byNumber ?? exact ?? (byName.length === 1 ? byName[0] : undefined);
			if (chosen === undefined) throw new UsageError(`cannot tell which harness "${word}" means; use 1-${TARGETS.length}, a name, or all`);
			picked.add(chosen);
		}
	}
	return TARGETS.filter((target) => picked.has(target));
}

export function usage(mode: Mode): string {
	const install = mode === "install";
	const script = `./${mode}.sh`;
	return `${install ? "Install" : "Remove"} oh-my-statusline ${install ? "into" : "from"} Claude Code, Codex, omp and OpenCode.

Usage: ${script} [claude] [codex] [omp] [opencode] [all] [options]

Targets (name any number of them; \`all\` is all four):
  claude     Claude Code   statusLine and subagentStatusLine in settings.json
  codex      Codex         the codex-statusline and codex-plain launchers (needs tmux)
  omp        omp           an extension in <agent dir>/extensions/oh-my-statusline
  opencode   OpenCode      a TUI plugin registered in cli.json
With no target on a terminal, ${script} shows a checklist (${install ? "harnesses found on this machine" : "harnesses installed here"} are marked);
with no target and no terminal it exits with status 2.

Options:
  --plain              ${install ? "Plain glyphs, no private-use powerline characters (for any font)" : "Accepted for symmetry with install; has no effect"}
  --dry-run            Print every step and write nothing
  --claude-dir DIR     Claude config directory (default: $CLAUDE_CONFIG_DIR, else ~/.claude)
  --agent-dir DIR      omp agent directory (default: $PI_CODING_AGENT_DIR, else ~/.omp/agent)
  --config-dir DIR     OpenCode config directory (default: $OPENCODE_CONFIG_DIR, else ~/.config/opencode)
  --bin-dir DIR        Codex launcher directory (default: ~/.local/bin)
  --codex PATH         The original Codex executable (default: the one on PATH)
  --wrap-codex         Also install a \`codex\` launcher that shadows the official command
  -h, --help           Show this help
${
	install
		? `
Migration from the four standalone projects (claude-code-statusline, codex-statusline,
omp-statusline, opencode-statusline) happens on install, per harness, and is printed step by step:
  claude    The settings the old install saved become the settings ${script} restores on uninstall (not
            the old command). settings.json is backed up (settings.json.bak-<timestamp>) and switched
            to oh-my-statusline, then <config>/claude-code-statusline is removed if it holds only the old files.
  codex     The old launchers that are unmodified are removed (modified ones are kept and reported);
            its Codex path, glyph mode and \`codex\` wrapper choice carry over; then
            <data>/codex-statusline is removed if it holds only the old files.
  omp       <agent dir>/extensions/omp-statusline is removed (omp would load two widgets); its glyph
            mode carries over. A directory that only looks similar is left alone.
  opencode  The ./statusline entry in cli.json is replaced by ./oh-my-statusline with its options
            (such as glyphs) kept; the plugins list the old install saved becomes the one restored on
            uninstall; cli.json is backed up and <config>/statusline is removed if it holds only the old files.
The old glyph mode is kept unless --plain asks for plain glyphs. A settings or cli.json file that is
not valid JSON stops that harness with every file untouched; the other harnesses continue, and the
exit status is 1 if any of them failed. Use --dry-run first to see the plan.
`
		: `
Uninstall restores what install saved (previous settings, plugins list) and removes only
directories and launchers that oh-my-statusline itself created. Anything changed since is kept.
`
}`;
}

export interface Context {
	env: Record<string, string | undefined>;
	home: string;
	isTTY: boolean;
	/** The repository the script lives in. */
	sourceRoot: string;
	out: (line: string) => void;
	err: (line: string) => void;
	/** One line typed by the user, or null at end of input. */
	ask: (prompt: string) => Promise<string | null>;
}

export function defaultContext(): Context {
	return {
		env: Bun.env,
		home: Bun.env.HOME || homedir(),
		isTTY: process.stdin.isTTY === true,
		sourceRoot: path.resolve(import.meta.dir, "..", ".."),
		out: (line) => console.log(line),
		err: (line) => console.error(line),
		ask: async (prompt) => {
			const rl = createInterface({ input: process.stdin, output: process.stdout });
			try {
				return await rl.question(prompt);
			} catch {
				return null;
			} finally {
				rl.close();
			}
		},
	};
}

/** Directories each harness uses once the options and environment are applied. */
function directories(p: Parsed, ctx: Context): Record<Target, string> {
	const env = { ...ctx.env, ...(p.claudeDir ? { CLAUDE_CONFIG_DIR: p.claudeDir } : {}) };
	return {
		claude: path.dirname(claudeInstallDir({ home: ctx.home, env })),
		codex: path.dirname(codexInstallDir({ home: ctx.home, env })),
		omp: path.dirname(path.dirname(ompInstallDir({ home: ctx.home, env, agentDir: p.agentDir }))),
		opencode: path.dirname(opencodeInstallDir({ home: ctx.home, env, configDir: p.configDir })),
	};
}

/** Harnesses to mark in the checklist: found on this machine (install) or installed by us (uninstall). */
function marked(mode: Mode, p: Parsed, ctx: Context): Target[] {
	const dirs = directories(p, ctx);
	const found: Record<Target, boolean> = {
		claude: existsSync(dirs.claude) || Bun.which("claude", { PATH: ctx.env.PATH }) !== null,
		codex: existsSync(ctx.env.CODEX_HOME || path.join(ctx.home, ".codex")) || Bun.which("codex", { PATH: ctx.env.PATH }) !== null,
		omp: existsSync(dirs.omp) || Bun.which("omp", { PATH: ctx.env.PATH }) !== null,
		opencode: existsSync(dirs.opencode) || Bun.which("opencode", { PATH: ctx.env.PATH }) !== null,
	};
	if (mode === "install") return TARGETS.filter((target) => found[target]);
	const env = { ...ctx.env, ...(p.claudeDir ? { CLAUDE_CONFIG_DIR: p.claudeDir } : {}) };
	const ours: Record<Target, string> = {
		claude: claudeInstallDir({ home: ctx.home, env }),
		codex: codexInstallDir({ home: ctx.home, env }),
		omp: ompInstallDir({ home: ctx.home, env, agentDir: p.agentDir }),
		opencode: opencodeInstallDir({ home: ctx.home, env, configDir: p.configDir }),
	};
	return TARGETS.filter((target) => existsSync(ours[target]));
}

function runTarget(mode: Mode, target: Target, p: Parsed, ctx: Context, log: (line: string) => void): void {
	const env = { ...ctx.env, ...(p.claudeDir ? { CLAUDE_CONFIG_DIR: p.claudeDir } : {}) };
	const common = { home: ctx.home, env, log, dryRun: p.dryRun };
	const full = { ...common, sourceRoot: ctx.sourceRoot, plain: p.plain };
	const run = mode === "install";
	switch (target) {
		case "claude":
			return run ? installClaude(full) : uninstallClaude(common);
		case "codex": {
			const codex = { binDir: p.binDir, codex: p.codex, wrapCodex: p.wrapCodex };
			return run ? installCodex({ ...full, ...codex }) : uninstallCodex({ ...common, ...codex });
		}
		case "omp":
			return run ? installOmp({ ...full, agentDir: p.agentDir }) : uninstallOmp({ ...common, agentDir: p.agentDir });
		case "opencode":
			return run ? installOpencode({ ...full, configDir: p.configDir }) : uninstallOpencode({ ...common, configDir: p.configDir });
	}
}

/** Run the command line; resolves to the process exit code (0 ok, 1 a harness failed, 2 usage). */
export async function runCli(mode: Mode, argv: readonly string[], ctx: Context = defaultContext()): Promise<number> {
	let parsed: Parsed;
	try {
		parsed = parseArgs(argv, ctx.home);
	} catch (error) {
		if (!(error instanceof UsageError)) throw error;
		ctx.err(`${error.message}\nTry: ./${mode}.sh --help`);
		return 2;
	}
	if (parsed.help) {
		ctx.out(usage(mode));
		return 0;
	}

	let targets = parsed.targets;
	if (targets.length === 0) {
		if (!ctx.isTTY) {
			ctx.err(`No target given and no terminal to ask on.\n\n${usage(mode)}`);
			return 2;
		}
		const defaults = marked(mode, parsed, ctx);
		ctx.out(`${mode === "install" ? "Install into" : "Remove from"} which harnesses?`);
		TARGETS.forEach((target, i) => ctx.out(`  ${i + 1}) [${defaults.includes(target) ? "x" : " "}] ${target}`));
		const answer = await ctx.ask("Numbers or names (a = all, Enter = the marked ones, q = quit): ");
		if (answer === null || answer.trim().toLowerCase() === "q") {
			ctx.out("Nothing done.");
			return 0;
		}
		try {
			targets = parseSelection(answer, defaults);
		} catch (error) {
			if (!(error instanceof UsageError)) throw error;
			ctx.err(error.message);
			return 2;
		}
		if (targets.length === 0) {
			ctx.out("Nothing selected; nothing done.");
			return 0;
		}
	}

	if (parsed.dryRun) ctx.out("Dry run: every step is printed, nothing is written.");
	const done: Target[] = [];
	const failed: Target[] = [];
	for (const target of targets) {
		try {
			runTarget(mode, target, parsed, ctx, (line) => ctx.out(`[${target}] ${line}`));
			done.push(target);
		} catch (error) {
			failed.push(target);
			ctx.err(`[${target}] ${mode} failed: ${(error as Error).message}`);
		}
	}
	const verb = parsed.dryRun ? "Planned" : mode === "install" ? "Installed" : "Removed";
	if (done.length > 0) ctx.out(`${verb}: ${done.join(", ")}`);
	if (failed.length > 0) ctx.err(`Failed: ${failed.join(", ")}`);
	return failed.length > 0 ? 1 : 0;
}
