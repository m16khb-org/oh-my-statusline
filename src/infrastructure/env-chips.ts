// Environment chips: where the session runs. ssh and venv are read from the environment alone
// (no process is spawned); tmux and k8s ask a command, so callers cache them (see ambient.ts for
// long-lived processes; the Claude adapter caches through FileCache).

import { hostname as osHostname } from "node:os";
import * as path from "node:path";
import type { Config } from "../application/config.ts";
import type { EnvChips } from "../domain/model/snapshot.ts";
import { type CommandRunner, run } from "./process.ts";

export const TMUX_TTL_MS = 5_000;
export const K8S_TTL_MS = 60_000;
const COMMAND_TIMEOUT_MS = 2_000;

type Env = Record<string, string | undefined>;

/** This machine's short hostname when the session is reached over SSH (`SSH_CONNECTION` is set). */
export function sshChip(env: Env, hostname: () => string = osHostname): string | null {
	if (!env.SSH_CONNECTION) return null;
	return hostname().split(".")[0] || null;
}

/**
 * The active Python environment: the basename of `VIRTUAL_ENV`, else `CONDA_DEFAULT_ENV`. Conda's
 * `base` is skipped: many shells activate it for every session, so it says nothing about this one.
 */
export function venvChip(env: Env): string | null {
	const virtual = env.VIRTUAL_ENV ? path.basename(env.VIRTUAL_ENV.replace(/\/+$/, "")) : "";
	if (virtual) return virtual;
	const conda = env.CONDA_DEFAULT_ENV;
	return conda && conda !== "base" ? conda : null;
}

/** Which tmux server and pane/session a tmux query addresses. */
export interface TmuxTarget {
	/** Server socket path; null addresses the default server. */
	socket: string | null;
	/** `%pane` id, else `$session` id; null lets tmux decide. */
	target: string | null;
}

/**
 * The tmux the process was started in, from `TMUX` (`<socket>,<server pid>,<session id>`) and
 * `TMUX_PANE`; null outside tmux.
 */
export function tmuxTarget(env: Env): TmuxTarget | null {
	if (!env.TMUX) return null;
	const match = /^(.*),\d+,(\d+)$/.exec(env.TMUX);
	return { socket: match?.[1] ?? null, target: env.TMUX_PANE || (match?.[2] ? `$${match[2]}` : null) };
}

export interface EnvAdapterOptions {
	exec?: CommandRunner;
	which?: (bin: string) => string | null;
	/** Receives the one-time kubectl warning; default stderr. */
	warn?: (message: string) => void;
	hostname?: () => string;
}

export class EnvAdapter {
	readonly hostname: () => string;
	readonly #exec: CommandRunner;
	readonly #which: (bin: string) => string | null;
	readonly #warn: (message: string) => void;
	#warned = false;

	constructor(options: EnvAdapterOptions = {}) {
		this.#exec = options.exec ?? run;
		this.#which = options.which ?? ((bin) => Bun.which(bin));
		this.#warn = options.warn ?? ((message) => void process.stderr.write(`${message}\n`));
		this.hostname = options.hostname ?? osHostname;
	}

	/** `session:window` of the tmux `target` addresses; null when tmux fails or has no such server. */
	async tmux(target: TmuxTarget): Promise<string | null> {
		const argv = ["tmux", ...(target.socket ? ["-S", target.socket] : []), "display-message", "-p", ...(target.target ? ["-t", target.target] : []), "#S:#W"];
		const out = await this.#exec(argv, { timeoutMs: COMMAND_TIMEOUT_MS });
		return out?.split("\n")[0]?.trim() || null;
	}

	/** Whether kubectl exists; the first time it does not, one warning is written for the process. */
	hasKubectl(): boolean {
		if (this.#which("kubectl")) return true;
		if (!this.#warned) {
			this.#warned = true;
			this.#warn("oh-my-statusline: chips.k8s is on but kubectl was not found on PATH; the k8s chip is omitted");
		}
		return false;
	}

	/** The current kubectl context; null when kubectl is missing or has no current context. */
	async k8s(): Promise<string | null> {
		if (!this.hasKubectl()) return null;
		const out = await this.#exec(["kubectl", "config", "current-context"], { timeoutMs: COMMAND_TIMEOUT_MS });
		return out?.split("\n")[0]?.trim() || null;
	}
}

/** The chips from the environment and the already-read tmux / k8s texts, each gated by its switch. */
export function buildEnvChips(chips: Config["chips"], env: Env, adapter: EnvAdapter, dynamic: { tmux: string | null; k8s: string | null }): EnvChips {
	return {
		ssh: chips.ssh ? sshChip(env, adapter.hostname) : null,
		tmux: chips.tmux ? dynamic.tmux : null,
		venv: chips.venv ? venvChip(env) : null,
		k8s: chips.k8s ? dynamic.k8s : null,
	};
}
