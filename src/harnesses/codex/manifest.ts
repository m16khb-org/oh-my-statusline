// `install.json`: what the installer recorded about this installation. The launcher reads it from
// the install directory (the tree root above `src/`); a source checkout has none.

import { readFileSync } from "node:fs";
import path from "node:path";

/** The tree root that holds `src/`, `package.json` and, once installed, `install.json`. */
export const ROOT = path.resolve(import.meta.dir, "..", "..", "..");

export interface Manifest {
	/** Absolute path of the original Codex executable. */
	codex?: string;
	glyphs?: "plain" | "powerline";
	/** Launcher path → sha256 of what the installer wrote there. */
	launchers?: Record<string, string>;
}

/** The manifest of an install directory; empty when there is none or it cannot be read. */
export function readManifest(dir: string): Manifest {
	try {
		const value = JSON.parse(readFileSync(path.join(dir, "install.json"), "utf8")) as unknown;
		return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Manifest) : {};
	} catch {
		return {};
	}
}
