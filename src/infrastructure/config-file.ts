import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import * as path from "node:path";

/** `$XDG_CONFIG_HOME/oh-my-statusline/config.toml`, else `~/.config/oh-my-statusline/config.toml`. */
export function defaultConfigPath(env: Record<string, string | undefined>): string {
	const base = env.XDG_CONFIG_HOME || path.join(env.HOME || homedir(), ".config");
	return path.join(base, "oh-my-statusline", "config.toml");
}

/** The parsed TOML; null when the file is missing, `{ error }` when it cannot be read or parsed. */
export function readConfigFile(file: string): { raw: unknown } | { error: string } | null {
	let text: string;
	try {
		text = readFileSync(file, "utf8");
	} catch (e) {
		return (e as NodeJS.ErrnoException).code === "ENOENT" ? null : { error: (e as Error).message };
	}
	try {
		return { raw: Bun.TOML.parse(text) };
	} catch (e) {
		return { error: (e as Error).message };
	}
}
