import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import * as path from "node:path";
import type { CacheEntry, CachePort, ClockPort } from "../application/ports.ts";

/** `$XDG_CACHE_HOME/oh-my-statusline`, else `~/.cache/oh-my-statusline`. */
export function defaultCacheDir(env: Record<string, string | undefined>): string {
	const base = env.XDG_CACHE_HOME || path.join(env.HOME || homedir(), ".cache");
	return path.join(base, "oh-my-statusline");
}

function sanitize(key: string): string {
	const safe = key.replace(/[^A-Za-z0-9._-]/g, "_");
	return safe.length > 180 ? safe.slice(-180) : safe;
}

let tmpCounter = 0;

export class FileCache implements CachePort {
	constructor(
		private readonly dir: string,
		private readonly clock: ClockPort,
	) {}

	private ensureDir(): void {
		mkdirSync(this.dir, { recursive: true, mode: 0o700 });
	}

	private file(key: string): string {
		return path.join(this.dir, `${sanitize(key)}.json`);
	}

	private lockDir(key: string): string {
		return path.join(this.dir, `${sanitize(key)}.lock`);
	}

	read<T>(key: string): CacheEntry<T> | null {
		try {
			const parsed = JSON.parse(readFileSync(this.file(key), "utf8")) as { storedAtMs?: unknown; value?: T };
			if (typeof parsed.storedAtMs !== "number" || !("value" in parsed)) return null;
			return { value: parsed.value as T, storedAtMs: parsed.storedAtMs };
		} catch {
			return null;
		}
	}

	write<T>(key: string, value: T): void {
		this.ensureDir();
		const target = this.file(key);
		const tmp = `${target}.${process.pid}.${tmpCounter++}.tmp`;
		writeFileSync(tmp, JSON.stringify({ storedAtMs: this.clock.now(), value }));
		renameSync(tmp, target);
	}

	lock(key: string, staleAfterMs: number): boolean {
		this.ensureDir();
		const dir = this.lockDir(key);
		const stamp = path.join(dir, "at");
		for (let attempt = 0; attempt < 2; attempt++) {
			try {
				mkdirSync(dir);
				writeFileSync(stamp, String(this.clock.now()));
				return true;
			} catch {
				if (!existsSync(dir)) return false;
			}
			let heldAt: number;
			try {
				heldAt = Number(readFileSync(stamp, "utf8"));
			} catch {
				// The holder is between mkdir and writing its stamp: fall back to the directory's mtime.
				try {
					heldAt = statSync(dir).mtimeMs;
				} catch {
					continue;
				}
			}
			if (!(this.clock.now() - heldAt > staleAfterMs)) return false;
			rmSync(dir, { recursive: true, force: true });
		}
		return false;
	}

	unlock(key: string): void {
		rmSync(this.lockDir(key), { recursive: true, force: true });
	}
}
