// Reads every harness's own session storage (read-only) into usage buckets, incrementally.
//
// JSONL sources keep a byte offset per file: a rerun parses only the complete lines after it, a
// trailing partial line is left for the next run, and a file that shrank or whose mtime went
// backwards is re-parsed from byte 0. SQLite sources are re-queried whenever the database (or its
// WAL) changes. Nothing here ever writes to a session file or database.

import { Database } from "bun:sqlite";
import { closeSync, fstatSync, openSync, readdirSync, readSync, statSync } from "node:fs";
import * as path from "node:path";
import { addEvent } from "../../application/stats/aggregate.ts";
import type { Bucket, BucketMap, LineParser, StatsAggregate, StatsHarness, UsageEvent } from "../../application/stats/model.ts";
import { claudeParser } from "../../application/stats/parse-claude.ts";
import { codexParser, codexThreadEvent } from "../../application/stats/parse-codex.ts";
import { ompParser } from "../../application/stats/parse-omp.ts";
import { opencodeEvent } from "../../application/stats/parse-opencode.ts";
import { parseObject } from "../../application/stats/parse-util.ts";
import type { DbState, FileState, StatsCache } from "./cache.ts";
import { emptyCache, loadCache, saveCache } from "./cache.ts";

export interface StatsRoots {
	/** `~/.claude/projects` */
	claude: string;
	/** Codex home: holds `sessions/`, `archived_sessions/` and `state_*.sqlite`. */
	codex: string;
	/** `~/.omp/agent/sessions` */
	omp: string;
	/** `~/.local/share/opencode/opencode.db` */
	opencodeDb: string;
}

export function defaultRoots(home: string, env: Record<string, string | undefined>): StatsRoots {
	return {
		claude: path.join(env.CLAUDE_CONFIG_DIR || path.join(home, ".claude"), "projects"),
		codex: env.CODEX_HOME || path.join(home, ".codex"),
		omp: path.join(home, ".omp", "agent", "sessions"),
		opencodeDb: path.join(env.XDG_DATA_HOME || path.join(home, ".local", "share"), "opencode", "opencode.db"),
	};
}

export interface CollectOptions {
	roots: StatsRoots;
	harnesses: readonly StatsHarness[];
	/** IANA timezone whose local days bucket the usage; a cache built for another zone is discarded. */
	tz: string;
	/** Cache file; null keeps everything in memory. */
	cacheFile: string | null;
}

export interface CollectCounters {
	filesSeen: number;
	/** Files of which at least one new byte was read. */
	filesParsed: number;
	bytesRead: number;
	/** Complete lines handed to a parser. */
	linesRead: number;
	dbsQueried: number;
}

export interface CollectResult {
	aggregate: StatsAggregate;
	counters: CollectCounters;
	warnings: string[];
}

interface Run {
	prior: StatsCache;
	next: StatsCache;
	tz: string;
	counters: CollectCounters;
	warnings: string[];
	out: Bucket[];
	/** Codex session ids that have rollout token data. */
	codexCovered: Set<string>;
}

const NEWLINE = 0x0a;

function readFrom(file: string, offset: number, size: number): Buffer {
	const fd = openSync(file, "r");
	try {
		const buf = Buffer.allocUnsafe(Math.max(0, size - offset));
		let got = 0;
		while (got < buf.length) {
			const n = readSync(fd, buf, got, buf.length - got, offset + got);
			if (n === 0) break;
			got += n;
		}
		return got === buf.length ? buf : buf.subarray(0, got);
	} finally {
		closeSync(fd);
	}
}

function fileHint(file: string): string {
	const name = path.basename(file).replace(/\.jsonl$/, "");
	const uuid = /^rollout-.*?-([0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12})$/.exec(name);
	return uuid?.[1] ?? name;
}

/** Bring one JSONL file's state up to date and return it, or null when it vanished. */
function syncFile<C>(run: Run, parser: LineParser<C>, key: string, file: string, harness: StatsHarness): FileState | null {
	let stat: { size: number; mtimeMs: number };
	try {
		stat = statSync(file);
	} catch {
		return null;
	}
	const prior = run.prior.files[key];
	const usable = prior && stat.size >= prior.size && stat.mtimeMs >= prior.mtimeMs && prior.offset <= stat.size;
	if (usable && stat.size === prior.size && stat.mtimeMs === prior.mtimeMs) return prior;

	const parse = (from: FileState | null): FileState => {
		const state: FileState = from ?? { size: 0, mtimeMs: 0, offset: 0, carry: parser.initial(fileHint(file)), buckets: {} };
		const buf = readFrom(file, state.offset, stat.size);
		run.counters.bytesRead += buf.length;
		const lastNewline = buf.lastIndexOf(NEWLINE);
		let end = lastNewline + 1;
		// An unterminated tail that is already a complete JSON object is a finished line, not a partial one.
		const tail = buf.toString("utf8", end);
		if (tail.trim() === "" || parseObject(tail) !== null) end = buf.length;
		const carry = state.carry as C;
		const emit = (e: UsageEvent): void => addEvent(state.buckets, harness, e, run.tz);
		for (const text of buf.toString("utf8", 0, end).split("\n")) {
			if (text === "") continue;
			run.counters.linesRead++;
			parser.line(carry, text, emit);
		}
		state.offset += end;
		state.size = stat.size;
		state.mtimeMs = stat.mtimeMs;
		return state;
	};
	const from = usable ? prior : null;
	if (stat.size > (from?.offset ?? 0)) run.counters.filesParsed++;
	try {
		return parse(from);
	} catch {
		// A cache entry whose carry no longer fits the parser: start the file over (null if it vanished).
		try {
			return parse(null);
		} catch {
			return null;
		}
	}
}

/** Buckets of `state` including events its parser is still holding back (never cached). */
function settledBuckets<C>(run: Run, parser: LineParser<C>, state: FileState, harness: StatsHarness): Bucket[] {
	const held = parser.pending(state.carry as C);
	if (held.length === 0) return Object.values(state.buckets);
	const copy: BucketMap = structuredClone(state.buckets);
	for (const e of held) addEvent(copy, harness, e, run.tz);
	return Object.values(copy);
}

function scanJsonl<C>(run: Run, harness: StatsHarness, parser: LineParser<C>, roots: readonly string[], match: RegExp): void {
	for (const root of roots) {
		let entries: string[];
		try {
			entries = readdirSync(root, { recursive: true, encoding: "utf8" });
		} catch {
			continue;
		}
		for (const rel of entries) {
			const base = path.basename(rel);
			if (!match.test(base) || base.startsWith(".")) continue;
			const file = path.join(root, rel);
			run.counters.filesSeen++;
			const key = `${harness}\u0000${file}`;
			const state = syncFile(run, parser, key, file, harness);
			if (!state) continue;
			run.next.files[key] = state;
			for (const b of settledBuckets(run, parser, state, harness)) {
				run.out.push(b);
				if (harness === "codex") run.codexCovered.add(b.sessionId);
			}
		}
	}
}

function dbSignature(file: string): string | null {
	try {
		const main = statSync(file);
		let wal = "0:0";
		try {
			const w = statSync(`${file}-wal`);
			wal = `${w.size}:${w.mtimeMs}`;
		} catch {
			// No WAL file: the main file alone is the signature.
		}
		return `${main.size}:${main.mtimeMs}:${wal}`;
	} catch {
		return null;
	}
}

function hasTable(db: Database, name: string): boolean {
	return db.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) !== null;
}

function readCodexThreads(db: Database): UsageEvent[] {
	if (!hasTable(db, "threads")) return [];
	const rows = db
		.query("SELECT id, model, created_at_ms AS createdMs, updated_at_ms AS updatedMs, tokens_used AS tokensUsed FROM threads WHERE tokens_used > 0")
		.all() as Parameters<typeof codexThreadEvent>[0][];
	return rows.flatMap((row) => codexThreadEvent(row) ?? []);
}

const opencodeFields = (model: string): string =>
	`id, session_id AS sessionId, json_extract(data, '${model}') AS model, json_extract(data, '$.time.created') AS createdMs,
	time_created AS rowMs, json_extract(data, '$.tokens.input') AS input, json_extract(data, '$.tokens.output') AS output,
	json_extract(data, '$.tokens.cache.read') AS cacheRead, json_extract(data, '$.tokens.cache.write') AS cacheWrite,
	json_extract(data, '$.cost') AS cost`;

function readOpenCode(db: Database, tz: string): BucketMap {
	const buckets: BucketMap = {};
	type Row = Parameters<typeof opencodeEvent>[0] & { id: string };
	const seen: Record<string, true> = {};
	if (hasTable(db, "session_message")) {
		const rows = db.query(`SELECT ${opencodeFields("$.model.id")} FROM session_message WHERE type = 'assistant'`).all() as Row[];
		for (const row of rows) {
			seen[row.id] = true;
			const e = opencodeEvent(row);
			if (e) addEvent(buckets, "opencode", e, tz);
		}
	}
	// Pre-v2 rows that were never copied into session_message.
	if (hasTable(db, "message")) {
		const rows = db.query(`SELECT ${opencodeFields("$.modelID")} FROM message WHERE json_extract(data, '$.role') = 'assistant'`).all() as Row[];
		for (const row of rows) {
			if (seen[row.id]) continue;
			const e = opencodeEvent(row);
			if (e) addEvent(buckets, "opencode", e, tz);
		}
	}
	return buckets;
}

/** Re-query a SQLite store when its signature changed; otherwise reuse the cached read. */
function syncDb(run: Run, file: string, harness: "codex" | "opencode"): DbState | null {
	const sig = dbSignature(file);
	if (sig === null) return null;
	const key = `${harness}\u0000${file}`;
	const prior = run.prior.dbs[key];
	if (prior && prior.sig === sig) return prior;
	let db: Database | null = null;
	try {
		db = new Database(file, { readonly: true });
		run.counters.dbsQueried++;
		const state: DbState = {
			sig,
			buckets: harness === "opencode" ? readOpenCode(db, run.tz) : {},
			threadEvents: harness === "codex" ? readCodexThreads(db) : [],
		};
		return state;
	} catch (error) {
		run.warnings.push(`${harness}: cannot read ${file}: ${(error as Error).message}`);
		return null;
	} finally {
		db?.close();
	}
}

/** `state_<N>.sqlite` of a Codex home with the highest N. */
function codexStateDb(codexHome: string): string | null {
	let best: { n: number; file: string } | null = null;
	let names: string[];
	try {
		names = readdirSync(codexHome);
	} catch {
		return null;
	}
	for (const name of names) {
		const m = /^state_(\d+)\.sqlite$/.exec(name);
		if (m && (!best || Number(m[1]) > best.n)) best = { n: Number(m[1]), file: path.join(codexHome, name) };
	}
	return best?.file ?? null;
}

export function collectStats(options: CollectOptions): CollectResult {
	const { roots, tz } = options;
	const want = (h: StatsHarness): boolean => options.harnesses.includes(h);
	const prior = options.cacheFile ? loadCache(options.cacheFile, tz) : emptyCache(tz);
	const next = emptyCache(tz);
	// Sources that are not requested keep their cached state untouched.
	for (const [key, state] of Object.entries(prior.files)) if (!want(key.split("\u0000")[0] as StatsHarness)) next.files[key] = state;
	for (const [key, state] of Object.entries(prior.dbs)) if (!want(key.split("\u0000")[0] as StatsHarness)) next.dbs[key] = state;
	const run: Run = {
		prior,
		next,
		tz,
		counters: { filesSeen: 0, filesParsed: 0, bytesRead: 0, linesRead: 0, dbsQueried: 0 },
		warnings: [],
		out: [],
		codexCovered: new Set(),
	};

	if (want("claude")) scanJsonl(run, "claude", claudeParser, [roots.claude], /\.jsonl$/);
	if (want("omp")) scanJsonl(run, "omp", ompParser, [roots.omp], /\.jsonl$/);
	if (want("codex")) {
		const rollouts = [path.join(roots.codex, "sessions"), path.join(roots.codex, "archived_sessions")];
		scanJsonl(run, "codex", codexParser, rollouts, /^rollout-.*\.jsonl$/);
		const dbFile = codexStateDb(roots.codex);
		const state = dbFile ? syncDb(run, dbFile, "codex") : null;
		if (dbFile && state) {
			next.dbs[`codex\u0000${dbFile}`] = state;
			const orphans: BucketMap = {};
			for (const e of state.threadEvents) if (!run.codexCovered.has(e.sessionId)) addEvent(orphans, "codex", e, tz);
			run.out.push(...Object.values(orphans));
		}
	}
	if (want("opencode")) {
		const state = syncDb(run, roots.opencodeDb, "opencode");
		if (state) {
			next.dbs[`opencode\u0000${roots.opencodeDb}`] = state;
			run.out.push(...Object.values(state.buckets));
		}
	}

	if (options.cacheFile) {
		try {
			saveCache(options.cacheFile, next);
		} catch (error) {
			run.warnings.push(`cannot write cache ${options.cacheFile}: ${(error as Error).message}`);
		}
	}
	return { aggregate: { buckets: run.out }, counters: run.counters, warnings: run.warnings };
}
