// The background reads behind OpenCode's extra chips: environment chips (ssh, tmux, venv, k8s),
// the gh/glab pull request and today's cost. One shared Ambient serves the session and home
// footers, since only one of them is on screen. The plugin may run under Node, so nothing here
// may assume `Bun`: commands go through nodeRunner and PATH lookups through nodeWhich. Today's
// cost runs in a child `bun` process (the collector needs bun:sqlite and blocks while reading).

import { type Config, type ConfigOverrides, resolveConfig } from "../../application/config.ts";
import { Ambient } from "../../infrastructure/ambient.ts";
import { defaultConfigPath, readConfigFile } from "../../infrastructure/config-file.ts";
import { EnvAdapter } from "../../infrastructure/env-chips.ts";
import { PrAdapter } from "../../infrastructure/pr.ts";
import type { CommandRunner } from "../../infrastructure/process.ts";
import { findBun, todayCostViaProcess } from "../../infrastructure/stats/today-process.ts";
import { nodeRunner, nodeWhich } from "./runtime.ts";

type Env = Record<string, string | undefined>;

/** The shared configuration (config.toml, environment); defaults when the file cannot be read. */
export function loadConfig(env: Env, installed: ConfigOverrides = {}): Config {
	return resolveConfig({ harness: "opencode", installed, file: readConfigFile(defaultConfigPath(env)), env, flags: {} }).config;
}

export function createAmbient(env: Env = process.env as Env, exec: CommandRunner = nodeRunner): Ambient {
	const config = loadConfig(env);
	const which = (bin: string) => nodeWhich(bin, env.PATH);
	return new Ambient({
		clock: { now: () => Date.now() },
		config,
		env,
		// A TUI host: the kubectl warning would corrupt its screen, so it is dropped.
		adapter: new EnvAdapter({ exec, which, warn: () => {} }),
		pr: new PrAdapter(exec, which),
		// Out of process: the stats collector must not block the TUI thread.
		todayCost: () => todayCostViaProcess(exec, findBun(which, process.execPath)),
	});
}
