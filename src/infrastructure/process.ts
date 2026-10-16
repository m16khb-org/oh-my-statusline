// Command output for the adapters: `run` spawns, waits, and returns stdout or null. (Processes that must
// outlive the caller or own a terminal — Claude's detached refresh helpers, the Codex launcher and tmux —
// spawn directly where they are started.)

export interface RunOptions {
	cwd?: string;
	timeoutMs?: number;
	stdin?: string;
}

/** A command runner; adapters take one so tests can inject failures and timeouts. */
export type CommandRunner = (cmd: string[], opts?: RunOptions) => Promise<string | null>;

const DEFAULT_TIMEOUT_MS = 5000;

/** stdout when the command exits 0; null on any failure (non-zero exit, missing binary, timeout). */
export const run: CommandRunner = async (cmd, opts = {}) => {
	try {
		const proc = Bun.spawn(cmd, {
			cwd: opts.cwd,
			stdin: opts.stdin === undefined ? "ignore" : new Blob([opts.stdin]),
			stdout: "pipe",
			stderr: "ignore",
			timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
			killSignal: "SIGKILL",
		});
		const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
		return code === 0 ? out : null;
	} catch {
		return null;
	}
};
