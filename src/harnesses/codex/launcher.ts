// The Codex launcher. Interactive runs start Codex inside a private tmux server whose two-row
// status area shows the status line; everything else (scripts, subcommands, --help, a disabled
// or nested run) goes straight to the real Codex. Entry points, selected by argv:
//   launcher.ts <codex args…>        launch (the command users run)
//   launcher.ts --run <runDir>       inside tmux: run Codex and record its exit code
//   launcher.ts --collect <runDir>   beside tmux: feed the status rows

import { accessSync, constants as fsConstants, mkdirSync, mkdtempSync, readFileSync, readSync, openSync, closeSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { constants as osConstants, tmpdir } from "node:os";
import path from "node:path";
import { EnvAdapter, tmuxTarget } from "../../infrastructure/env-chips.ts";
import { collect } from "./collector.ts";
import { readManifest, ROOT } from "./manifest.ts";
import { runTmux, shellQuote, tmuxConf } from "./tmux.ts";

type Env = Record<string, string | undefined>;

/** Written by the installer at the top of every launcher script; discovery never picks one of those. */
export const LAUNCHER_MARKER = "# codex-statusline launcher";

/** Codex subcommands: they are not the interactive terminal UI, so no status line is drawn for them. */
const COMMANDS: Record<string, true> = Object.fromEntries([
	"agents", "exec", "e", "review", "login", "logout", "mcp", "plugin", "app-server", "remote-control", "app", "completion",
	"update", "doctor", "sandbox", "debug", "apply", "a", "queue", "archive", "delete", "migrate-rollouts", "unarchive",
	"cloud", "exec-server", "features", "help",
].map((name) => [name, true]));

/** Options that take the next argument as their value; that value is never a prompt or a subcommand. */
const VALUE_OPTIONS: Record<string, true> = Object.fromEntries([
	"-c", "--config", "--enable", "--disable", "--remote", "--remote-auth-token-env", "-i", "--image", "-m", "--model",
	"--local-provider", "-p", "--profile", "-s", "--sandbox", "-C", "--cd", "--add-dir", "-a", "--ask-for-approval",
].map((name) => [name, true]));

/** True when `args` start the interactive terminal UI. */
export function interactiveArgs(args: string[]): boolean {
	let skip = false;
	for (const arg of args) {
		if (skip) {
			skip = false;
			continue;
		}
		if (arg === "-h" || arg === "--help" || arg === "-V" || arg === "--version") return false;
		if (VALUE_OPTIONS[arg]) skip = true;
		else if (COMMANDS[arg]) return false;
		else if (!arg.startsWith("-")) {
			// A prompt is opaque: its words are not CLI options.
			return !args.some((a) => a === "-h" || a === "--help");
		}
	}
	return true;
}

/** Run the real Codex directly: not a terminal, not the interactive UI, or switched off/already inside. */
export function shouldPassThrough(args: string[], env: Env, isTty: boolean): boolean {
	return !isTty || !interactiveArgs(args) || env.CODEX_STATUSLINE_DISABLE === "1" || env.CODEX_STATUSLINE_ACTIVE === "1";
}

function isExecutableFile(file: string): boolean {
	try {
		if (!statSync(file).isFile()) return false;
		accessSync(file, fsConstants.X_OK);
		return true;
	} catch {
		return false;
	}
}

function isLauncherScript(file: string): boolean {
	const head = Buffer.alloc(128);
	let fd: number | undefined;
	try {
		fd = openSync(file, "r");
		return head.toString("utf8", 0, readSync(fd, head, 0, 128, 0)).includes(LAUNCHER_MARKER);
	} catch {
		return false;
	} finally {
		if (fd !== undefined) closeSync(fd);
	}
}

/**
 * The real Codex: the explicit path, else CODEX_STATUSLINE_CODEX, else the install manifest's,
 * else the first `codex` on PATH. Our own launchers (and this script) are skipped, so a
 * `codex` wrapper never starts itself.
 */
export function findCodex(explicit: string | undefined, env: Env): string | null {
	const chosen = explicit || env.CODEX_STATUSLINE_CODEX || readManifest(ROOT).codex;
	const candidates = chosen
		? [chosen.replace(/^~(?=$|\/)/, env.HOME ?? "~")]
		: (env.PATH ?? "").split(path.delimiter).filter(Boolean).map((dir) => path.join(dir, "codex"));
	for (const candidate of candidates) {
		if (!isExecutableFile(candidate)) continue;
		const real = realpathSync(candidate);
		if (real === import.meta.path || path.basename(path.dirname(real)) === "codex-statusline" || isLauncherScript(candidate)) continue;
		return path.resolve(candidate);
	}
	return null;
}

/** Process exit code of a finished child: its own, or 128 + signal number. */
function exitCodeOf(proc: { exitCode: number | null; signalCode: NodeJS.Signals | number | null }): number {
	if (proc.exitCode !== null) return proc.exitCode;
	if (proc.signalCode === null) return 1;
	return 128 + (typeof proc.signalCode === "number" ? proc.signalCode : (osConstants.signals[proc.signalCode] ?? 0));
}

/** Stay alive while the child runs: Ctrl-C reaches it through the terminal, HUP/TERM are passed on. */
function forwardSignals(child: { kill(signal?: NodeJS.Signals): void }): void {
	process.on("SIGINT", () => {});
	for (const signal of ["SIGHUP", "SIGTERM"] as const) process.on(signal, () => child.kill(signal));
}

async function passThrough(real: string, args: string[]): Promise<number> {
	const child = Bun.spawn([real, ...args], { stdin: "inherit", stdout: "inherit", stderr: "inherit" });
	forwardSignals(child);
	await child.exited;
	return exitCodeOf(child);
}

interface LaunchSpec {
	args: string[];
	codex: string;
	tmux: string;
	/**
	 * The user's own tmux, recorded at launch: Codex runs inside a private tmux server, so the
	 * tmux chip must describe the OUTER one. `outerTmux` is `$TMUX`, `outerPane` is `$TMUX_PANE`,
	 * `outerLabel` the `session:window` they resolved to then. All null outside tmux.
	 */
	outerTmux?: string | null;
	outerPane?: string | null;
	outerLabel?: string | null;
}

/** Inside the tmux pane: run Codex, record its exit code, end the session. */
async function runCodex(runDir: string): Promise<number> {
	const spec = JSON.parse(readFileSync(path.join(runDir, "launch.json"), "utf8")) as LaunchSpec;
	const env: Env = { ...process.env, CODEX_STATUSLINE_ACTIVE: "1" };
	// An unrelated parent agent's id must not leak into a new top-level CLI.
	delete env.CODEX_THREAD_ID;
	// The title shows the thread id (the collector finds the session by it); the built-in status line is off.
	const child = Bun.spawn([spec.codex, "-c", 'tui.terminal_title=["thread-id"]', "-c", "tui.status_line=[]", ...spec.args], {
		stdin: "inherit",
		stdout: "inherit",
		stderr: "inherit",
		env,
	});
	forwardSignals(child);
	await child.exited;
	const code = exitCodeOf(child);
	writeFileSync(path.join(runDir, "exit-code"), String(code));
	await runTmux(spec.tmux, path.join(runDir, "tmux.sock"), ["kill-session", "-t", "codex"]);
	return code;
}

/** A private run directory; tmux socket paths are limited to ~104 bytes, so a long TMPDIR falls back to /tmp. */
function makeRunDir(): string {
	const longest = path.join("codex-statusline-XXXXXX", "tmux.sock");
	const base = path.join(tmpdir(), longest).length > 100 ? "/tmp" : tmpdir();
	return mkdtempSync(path.join(base, "codex-statusline-"));
}

/** The user's tmux as the launcher sees it, before Codex moves into its own private server. */
export async function outerTmux(env: Env, adapter = new EnvAdapter()): Promise<Required<Pick<LaunchSpec, "outerTmux" | "outerPane" | "outerLabel">>> {
	const target = tmuxTarget(env);
	if (!target) return { outerTmux: null, outerPane: null, outerLabel: null };
	return { outerTmux: env.TMUX ?? null, outerPane: env.TMUX_PANE ?? null, outerLabel: await adapter.tmux(target) };
}

async function launch(real: string, args: string[], env: Env): Promise<number> {
	const tmux = Bun.which("tmux", { PATH: env.PATH });
	if (!tmux) {
		console.error("tmux not found. Install tmux (for example `brew install tmux`), or run codex-plain for Codex without the status line.");
		return 1;
	}
	// A private server keeps the user's tmux options and sessions untouched.
	const runDir = makeRunDir();
	const socket = path.join(runDir, "tmux.sock");
	let collector: Bun.Subprocess | undefined;
	let attach: Bun.Subprocess | undefined;
	let signalled = false;
	const onSignal = () => {
		signalled = true;
		attach?.kill();
	};
	process.on("SIGHUP", onSignal);
	process.on("SIGTERM", onSignal);
	try {
		const spec: LaunchSpec = { args, codex: real, tmux, ...(await outerTmux(env)) };
		writeFileSync(path.join(runDir, "launch.json"), JSON.stringify(spec));
		mkdirSync(path.join(runDir, "cache"));
		// The status format `cat`s these files, so they must exist before the first collector tick.
		for (const row of [0, 1]) writeFileSync(path.join(runDir, `row${row}`), "");
		writeFileSync(path.join(runDir, "tmux.conf"), tmuxConf(runDir));

		const command = [process.execPath, import.meta.path, "--run", runDir].map(shellQuote).join(" ");
		const created = await runTmux(tmux, socket, [
			"-f", path.join(runDir, "tmux.conf"),
			"new-session", "-d", "-s", "codex",
			"-x", String(process.stdout.columns || 120), "-y", String(process.stdout.rows || 40),
			"-c", process.cwd(),
			command,
		]);
		if (created.code !== 0) {
			console.error(created.stderr.trim() || "tmux could not start a session");
			return created.code;
		}
		collector = Bun.spawn([process.execPath, import.meta.path, "--collect", runDir], { stdin: "ignore", stdout: "ignore", stderr: "ignore" });
		const attachEnv: Env = { ...env };
		delete attachEnv.TMUX;
		if (signalled) return 130;
		attach = Bun.spawn([tmux, "-S", socket, "attach-session", "-t", "codex"], { stdin: "inherit", stdout: "inherit", stderr: "inherit", env: attachEnv });
		await attach.exited;
		if (signalled) return 130;
		try {
			return Number.parseInt(readFileSync(path.join(runDir, "exit-code"), "utf8"), 10) || 0;
		} catch {
			return 0;
		}
	} finally {
		collector?.kill();
		await collector?.exited;
		await runTmux(tmux, socket, ["kill-server"]);
		rmSync(runDir, { recursive: true, force: true });
	}
}

/** The command line; returns the process exit code. */
export async function main(argv: string[], env: Env = process.env): Promise<number> {
	const [mode, runDir] = argv;
	if (argv.length === 2 && mode === "--run" && runDir) return runCodex(runDir);
	if (argv.length === 2 && mode === "--collect" && runDir) {
		await collect(runDir, env);
		return 0;
	}
	const real = findCodex(undefined, env);
	if (real === null) {
		console.error("Codex CLI not found. Install it first or set CODEX_STATUSLINE_CODEX to its executable.");
		return 1;
	}
	if (shouldPassThrough(argv, env, Boolean(process.stdin.isTTY && process.stdout.isTTY))) return passThrough(real, argv);
	return launch(real, argv, env);
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
