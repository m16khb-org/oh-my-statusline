// File operations every harness installer shares: copying the runtime source tree with a marker
// that lists each file's checksum, refusing directories someone else owns, timestamped backups,
// and JSON edits that keep the file's mode and symlinks. Installers only ever replace or delete
// what carries the marker.

import { createHash } from "node:crypto";
import {
	chmodSync,
	copyFileSync,
	existsSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	realpathSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import path from "node:path";

export const MARKER = ".oh-my-statusline";

/** What an install directory's marker records. */
export interface Marker {
	harness: string;
	installedFrom: string;
	installedAt: string;
	/** Relative path → sha256 of every installed file. */
	files: Record<string, string>;
}

export function sha256(file: string): string {
	return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function listFiles(root: string, rel = ""): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(path.join(root, rel), { withFileTypes: true })) {
		const child = path.join(rel, entry.name);
		if (entry.isDirectory()) out.push(...listFiles(root, child));
		else if (entry.isFile() && !entry.name.startsWith(".")) out.push(child);
	}
	return out.sort();
}

export function readMarker(dir: string): Marker | null {
	try {
		const marker = JSON.parse(readFileSync(path.join(dir, MARKER), "utf8")) as Marker;
		return marker && typeof marker.files === "object" ? marker : null;
	} catch {
		return null;
	}
}

/** The directory is absent, or carries our marker. */
export function canOwn(dir: string): boolean {
	return !existsSync(dir) || readMarker(dir) !== null;
}

/**
 * Copy the runtime tree (`src/`, `package.json`, `LICENSE` from `sourceRoot`) into `dest`, replacing
 * a previous install of ours, and write the marker. Throws when `dest` belongs to someone else.
 */
export function installTree(sourceRoot: string, dest: string, harness: string, extra: Record<string, string> = {}): Marker {
	if (!canOwn(dest)) throw new Error(`${dest} exists and was not installed by oh-my-statusline; move it away first.`);
	const staging = `${dest}.installing-${process.pid}`;
	rmSync(staging, { recursive: true, force: true });
	mkdirSync(staging, { recursive: true });
	const files: Record<string, string> = {};
	const copy = (rel: string) => {
		const target = path.join(staging, rel);
		mkdirSync(path.dirname(target), { recursive: true });
		copyFileSync(path.join(sourceRoot, rel), target);
		files[rel] = sha256(target);
	};
	for (const rel of listFiles(path.join(sourceRoot, "src"))) copy(path.join("src", rel));
	for (const rel of ["package.json", "LICENSE"]) if (existsSync(path.join(sourceRoot, rel))) copy(rel);
	for (const [rel, body] of Object.entries(extra)) {
		const target = path.join(staging, rel);
		mkdirSync(path.dirname(target), { recursive: true });
		writeFileSync(target, body);
		files[rel] = sha256(target);
	}
	const marker: Marker = { harness, installedFrom: sourceRoot, installedAt: new Date().toISOString(), files };
	writeFileSync(path.join(staging, MARKER), `${JSON.stringify(marker, null, 2)}\n`);
	// Files the user put next to ours (saved previous settings) survive a reinstall.
	if (existsSync(dest)) {
		const old = readMarker(dest);
		for (const rel of listFiles(dest)) {
			if (old?.files[rel] !== undefined || files[rel] !== undefined) continue;
			const target = path.join(staging, rel);
			mkdirSync(path.dirname(target), { recursive: true });
			copyFileSync(path.join(dest, rel), target);
		}
		rmSync(dest, { recursive: true, force: true });
	}
	mkdirSync(path.dirname(dest), { recursive: true });
	renameSync(staging, dest);
	return marker;
}

/** Delete an install directory of ours; false (and untouched) when it is absent or not ours. */
export function removeTree(dir: string): boolean {
	if (!existsSync(dir) || readMarker(dir) === null) return false;
	rmSync(dir, { recursive: true, force: true });
	return true;
}

/** `file.bak-YYYYMMDD-HHMMSS` copy of `file`; returns its path, or null when `file` is absent. */
export function backup(file: string, now = new Date()): string | null {
	if (!existsSync(file)) return null;
	const pad = (n: number) => String(n).padStart(2, "0");
	const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
	let target = `${file}.bak-${stamp}`;
	for (let i = 1; existsSync(target); i++) target = `${file}.bak-${stamp}-${i}`;
	copyFileSync(file, target);
	return target;
}

export type JsonObject = Record<string, unknown>;

/** A JSON object file: `{}` when absent; throws when it holds anything but an object. */
export function readJsonObject(file: string): JsonObject {
	if (!existsSync(file)) return {};
	const text = readFileSync(file, "utf8");
	let value: unknown;
	try {
		value = text.trim() === "" ? {} : JSON.parse(text);
	} catch (error) {
		throw new Error(`${file} is not valid JSON (${(error as Error).message}); fix it, or edit it by hand.`);
	}
	if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${file} is not a JSON object; fix it, or edit it by hand.`);
	return value as JsonObject;
}

/**
 * Write JSON atomically to the file a path resolves to: a symlinked dotfile stays a symlink, and
 * the file keeps its permissions.
 */
export function writeJsonObject(file: string, value: JsonObject): void {
	const real = existsSync(file) && lstatSync(file).isSymbolicLink() ? realpathSync(file) : file;
	const mode = existsSync(real) ? statSync(real).mode & 0o777 : 0o644;
	mkdirSync(path.dirname(real), { recursive: true });
	const tmp = `${real}.tmp-${process.pid}`;
	writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
	chmodSync(tmp, mode);
	renameSync(tmp, real);
}

/** One thing an install or uninstall does; `--dry-run` prints `say` instead of running it. */
export interface Step {
	say: string;
	run: () => void;
	/** Part of taking over an old standalone install: announced when it runs, not only on a dry run. */
	legacy?: boolean;
}

/** Run the steps in order. With `dryRun` nothing runs: each one is printed as `[dry-run] <say>`. */
export function runSteps(steps: Step[], opts: { dryRun?: boolean; log: (line: string) => void }): void {
	for (const step of steps) {
		if (opts.dryRun) opts.log(`[dry-run] ${step.say}`);
		else {
			if (step.legacy) opts.log(`Migrating: ${step.say}`);
			step.run();
		}
	}
}

/** `dir` exists and holds only entries named in `allowed`, and every name in `required`. */
export function holdsOnly(dir: string, allowed: readonly string[], required: readonly string[] = []): boolean {
	try {
		const names = readdirSync(dir);
		return required.every((name) => names.includes(name)) && names.every((name) => allowed.includes(name));
	} catch {
		return false;
	}
}
