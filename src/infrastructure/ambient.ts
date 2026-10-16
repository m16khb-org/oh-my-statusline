// Background reads for the long-lived harness processes (Codex's collector, omp, OpenCode): the
// environment chips that need a command (tmux, kubectl), the pull request and today's cost. One
// Poller per source, so nothing here ever delays a frame: `read()` returns what the last
// finished fetch found.

import type { Config } from "../application/config.ts";
import { Poller } from "../application/poller.ts";
import type { ClockPort, PrPort } from "../application/ports.ts";
import type { EnvChips, PrState } from "../domain/model/snapshot.ts";
import { buildEnvChips, type EnvAdapter, K8S_TTL_MS, TMUX_TTL_MS, type TmuxTarget, tmuxTarget } from "./env-chips.ts";

const PR_TTL_MS = 300_000;
/** Today's cost changes slowly and a refresh reads session files: at most every two minutes. */
export const TODAY_COST_TTL_MS = 120_000;

export interface AmbientOptions {
	clock: ClockPort;
	config: Pick<Config, "chips" | "pr" | "stats">;
	env: Record<string, string | undefined>;
	adapter: EnvAdapter;
	/** The tmux to describe; default: the one `env` says the process runs in. */
	tmux?: TmuxTarget | null;
	/** The tmux text already known (Codex resolves it at launch), shown until the first poll lands. */
	initialTmux?: string | null;
	/** Pull request source; null leaves the PR out (the harness reads its own). */
	pr?: PrPort | null;
	/** Today's cost; null leaves the chip off. Runs in the background and may be slow. */
	todayCost?: (() => Promise<number | null>) | null;
}

export interface AmbientReading {
	env: EnvChips;
	pr: PrState | null;
	todayCostUsd: number | null;
}

export class Ambient {
	readonly #tmux: Poller<string>;
	readonly #k8s: Poller<string>;
	readonly #pr: Poller<PrState>;
	readonly #today: Poller<number>;
	readonly #target: TmuxTarget | null;
	#tmuxSettled = false;

	constructor(readonly options: AmbientOptions) {
		const { clock } = options;
		this.#tmux = new Poller(clock, TMUX_TTL_MS, TMUX_TTL_MS);
		this.#k8s = new Poller(clock, K8S_TTL_MS, K8S_TTL_MS);
		this.#pr = new Poller(clock, PR_TTL_MS, 15_000);
		this.#today = new Poller(clock, TODAY_COST_TTL_MS, TODAY_COST_TTL_MS);
		this.#target = options.tmux === undefined ? tmuxTarget(options.env) : options.tmux;
	}

	/** Start whichever reads are due. `onUpdate` runs after each one lands. `pr` names the checkout to ask. */
	poll(onUpdate: () => void, pr?: { cwd: string; key: string }): void {
		const { config, adapter } = this.options;
		if (config.chips.tmux && this.#target) {
			const target = this.#target;
			this.#tmux.poll(
				"tmux",
				async () => (await adapter.tmux(target)) ?? undefined,
				() => {
					this.#tmuxSettled = true;
					onUpdate();
				},
			);
		}
		if (config.chips.k8s) this.#k8s.poll("k8s", async () => (await adapter.k8s()) ?? undefined, onUpdate);
		const prPort = this.options.pr;
		if (prPort && config.pr.enabled && pr) this.#pr.poll(pr.key, async () => (await prPort.read(pr.cwd)) ?? undefined, onUpdate);
		const cost = this.options.todayCost;
		if (cost && config.stats.chip) {
			this.#today.poll(
				"today",
				async () => {
					// Let the caller's frame finish first: the collector reads files synchronously.
					await new Promise((resolve) => setTimeout(resolve, 0));
					return (await cost()) ?? undefined;
				},
				onUpdate,
			);
		}
	}

	invalidatePr(): void {
		this.#pr.invalidate();
	}

	read(): AmbientReading {
		const { config, env, adapter } = this.options;
		const tmux = this.#tmuxSettled ? (this.#tmux.value ?? null) : (this.options.initialTmux ?? null);
		return {
			env: buildEnvChips(config.chips, env, adapter, { tmux: this.#target ? tmux : null, k8s: this.#k8s.value ?? null }),
			pr: config.pr.enabled ? (this.#pr.value ?? null) : null,
			todayCostUsd: config.stats.chip ? (this.#today.value ?? null) : null,
		};
	}
}
