# Usage statistics: where each harness stores its numbers

`bun src/cli/stats.ts [--harness claude|codex|omp|opencode|all] [--since 7d|30d|today|all] [--json]`
reads each harness's own session storage, read-only, and reports per harness and per model:
sessions, stored cost (USD), tokens (input / output / cache read / cache write), first and last
activity. This file records what was found on a real machine (Claude Code 2.1.x, Codex CLI 0.160,
omp 18.x, OpenCode with the v2 session store, observed 2026-10-17) and what each reader does with it.

Rules that hold for every harness:

- **Cost is only what the source stored.** Nothing is priced here. A harness (or a slice of one)
  without stored cost prints `–` in the table and `null` in JSON.
- **A gap is a gap.** Data that does not exist is `–`/`null`, never `0`.
- Session files and databases are opened read-only and never written.
- Day boundaries (`today`, `--since Nd`) are local calendar days of `$TZ` (else the system zone).
  `Nd` means the last N calendar days **including today**; `today` is `1d`.

| Harness | Source | Format | Stored cost | Token split |
| --- | --- | --- | --- | --- |
| claude | `~/.claude/projects/**/*.jsonl` | JSONL | partial: session `cost-state` records | input, output, cache read, cache write |
| codex | `~/.codex/sessions/**/rollout-*.jsonl` + `~/.codex/state_<N>.sqlite` | JSONL + SQLite | none | split from rollouts; thread rows have a lifetime total only |
| omp | `~/.omp/agent/sessions/**/*.jsonl` | JSONL | yes, per response | input, output, cache read, cache write |
| opencode | `~/.local/share/opencode/opencode.db` | SQLite | field exists but always `0` | input, output (incl. reasoning), cache read, cache write |

Environment overrides honored: `CLAUDE_CONFIG_DIR` (Claude), `CODEX_HOME` (Codex),
`XDG_DATA_HOME` (OpenCode), `XDG_CACHE_HOME` (the stats cache). omp's root is `$HOME/.omp/agent/sessions`.

## Claude Code

- **Path**: `~/.claude/projects/<cwd-slug>/<sessionId>.jsonl`, plus subagent transcripts at
  `~/.claude/projects/<cwd-slug>/<sessionId>/subagents/agent-*.jsonl`. Subagent lines carry the
  parent's `sessionId`, so they count toward the parent session.
- **Usage record**: `{"type":"assistant","timestamp":ISO,"sessionId","requestId","message":{"id","model","usage":{...}}}`.
  Fields used: `message.usage.input_tokens`, `output_tokens`, `cache_read_input_tokens`,
  `cache_creation_input_tokens` (= cache write), `message.model`, `timestamp`. `input_tokens`
  excludes cache tokens.
- **Duplicates**: a response is streamed as several consecutive `assistant` lines (one per content
  block) sharing `message.id` + `requestId`. `output_tokens` grows across them (observed
  `21 -> 272`); input and cache counts repeat. In the sampled data 9121 of 12033 distinct keys
  repeat (280 files), 591 of them with different usage, **always adjacent, never across files**. The last line of a run
  is the final usage, so a run of equal keys is one event (the parser holds it back until the key
  changes; at report time the held event is folded in without being cached).
- **Synthetic lines**: `message.model == "<synthetic>"` (API error placeholders, all-zero usage)
  are skipped.
- **Cost**: assistant lines carry **no** `costUSD`. The only stored cost is the
  `{"type":"cost-state","sessionId","totalCostUSD","modelUsage":{"<model>":{"costUSD",...}}}`
  record, which is **cumulative per session and model** and has **no timestamp**. Each record is
  turned into the delta since the previous one for that model and dated by the latest assistant
  timestamp seen before it (a total that goes backwards restarts the counter). Its token fields
  (`inputTokens` etc.) use a different accounting from `usage` and are ignored.
- **GAP**: 213 of 280 sampled files contain `cost-state`; sessions without one show tokens but no
  cost, so a harness cost can be partial. The table marks it with `*` and JSON exposes
  `costSessions` (sessions that carried a stored cost) next to `sessions`.
- Other record types (`user`, `attachment`, `system`, `last-prompt`, ...) are ignored.

## Codex

- **Path (rollouts)**: `~/.codex/sessions/YYYY/MM/DD/rollout-<ISO>-<threadId>.jsonl`; also
  `~/.codex/archived_sessions/` when present. Real rollouts are pruned aggressively on this
  machine (1 file for 2867 threads), so most history is only in SQLite.
- **Rollout records** (`{"timestamp":ISO,"ordinal":N,"type":...,"payload":{...}}`):
  - `session_meta.payload.id` = thread/session id.
  - `turn_context.payload.model` = model in effect (also `event_msg` `thread_settings_applied`
    -> `payload.thread_settings.model`). Before the first one the model is `unknown`.
  - `event_msg` / `payload.type == "token_count"`, `payload.info.total_token_usage` =
    `{input_tokens, cached_input_tokens, cache_write_input_tokens, output_tokens, reasoning_output_tokens, total_tokens}`,
    **cumulative for the thread**; `last_token_usage` is the same shape for the last turn.
    Codex re-emits `token_count` with an unchanged total (and `info: null` for rate-limit-only
    updates), so the reader diffs successive **totals** (not `last_token_usage`) and skips zero
    deltas. A component that goes backwards restarts the counter.
  - `input_tokens` **includes** `cached_input_tokens`, so fresh input = input - cached,
    cache read = cached, cache write = `cache_write_input_tokens`, output = `output_tokens`
    (reasoning tokens are already inside it).
- **Path (threads)**: `~/.codex/state_<N>.sqlite` (highest N), table `threads`:
  `id, model, created_at_ms, updated_at_ms, tokens_used` (`archived` is ignored). `tokens_used` is
  one lifetime total with no split. It is used **only for threads no rollout covers** (rollout
  token data wins by session id), counted as `unsplit` tokens dated at `updated_at_ms`, under
  `model` (`unknown` when NULL). The table shows `–` for input/output/cache of such rows.
- **GAP**: Codex stores no cost anywhere (no field in rollouts or SQLite) -> always `–`/`null`.
  The split and the real per-day distribution are unavailable for threads whose rollout is gone.

## omp

- **Path**: `~/.omp/agent/sessions/<cwd-slug>/<ISO>_<sessionId>.jsonl`; subagent runs are separate
  files `.../<ISO>_<parentId>/<AgentName>.jsonl` (depth 2-3) with their own `session` id and a
  `parentSession` path. Each file is one session. `.*.lock.os` and `*.log` siblings are ignored.
- **Records**: line 1 is usually `{"type":"title",...,"pad":"..."}` (fixed-width header rewritten in
  place), then `{"type":"session","version":3,"id","timestamp","cwd"}`.
  - Responses: `{"type":"message","timestamp":ISO,"message":{"role":"assistant","model","provider","usage":{"input","output","cacheRead","cacheWrite","totalTokens","cost":{"input","output","cacheRead","cacheWrite","total"}},"responseId",...}}`.
  - Auxiliary calls (auto-thinking judge): `{"type":"model_usage","timestamp","model","usage":{...same shape...}}`.
    These are real spend and are counted under their own model.
  - Fields used: `usage.input/output/cacheRead/cacheWrite`, `usage.cost.total` (USD, stored per
    response), `model`, record `timestamp`. `responseId`s were unique in the sample (no dedupe needed).
- **Cost**: stored on every response (43698 of 43698 usage records in the sample, none negative).
- **Alternative not used**: `~/.omp/stats.db` (`messages` table with `cost_total`, token columns,
  `UNIQUE(session_file, entry_id)`) is omp's own derived cache of these same files; it lags behind
  the JSONL, so the JSONL is the source of truth here.
- **GAP**: a stored cost of `0` cannot be told apart from an unpriced model (the JSONL has no
  `cost_unpriced` flag; only `stats.db` does), so it is summed as stored.

## OpenCode

- **Path**: `~/.local/share/opencode/opencode.db` (SQLite, WAL). The pre-SQLite
  `~/.local/share/opencode/storage/message/<session>/msg_*.json` files are the old on-disk form
  and are not read (the sampled DB already holds their rows).
- **Tables**:
  - `session_message` (v2): `id, session_id, type, seq, time_created, time_updated, data`.
    Rows with `type = 'assistant'` hold usage in `data`: `$.model.id`, `$.time.created` (ms),
    `$.tokens.input`, `$.tokens.output`, `$.tokens.reasoning`, `$.tokens.cache.read`,
    `$.tokens.cache.write`, `$.cost`, `$.finish`.
  - `message` (legacy): `data` has `$.role = 'assistant'`, `$.modelID`, `$.providerID`,
    `$.time.created`, same `tokens`/`cost`. 104 legacy assistant rows had no `session_message`
    twin; rows with an id already in `session_message` are skipped, the rest are counted.
  - `session` also has `cost`/`tokens_*` aggregates; unused (always `0` cost, no per-model split).
- **Tokens**: `tokens.output` already includes reasoning (`tokens.total` = input + output +
  cache read + cache write on 4483 of 4483 legacy rows), so `tokens.reasoning` is not added again.
  Aborted responses have no `tokens` and are dropped (they do not count as a session).
- **GAP (cost)**: `cost` is present but **`0` on every one of the 5497 sampled assistant messages**,
  including Anthropic ones, because OpenCode did not price them. Only a **positive** stored cost is
  counted; zero means "no cost data", so such models print `–`.
- Everything is read with `json_extract` inside SQLite (no full `data` blobs cross into JS).

## Incremental cache

`~/.cache/oh-my-statusline/stats-cache.json` (`$XDG_CACHE_HOME/oh-my-statusline/` when set).

- Keyed per source file: `{size, mtimeMs, offset, carry, buckets}`. `buckets` are the per
  session x model x local-day sums; `carry` is the parser's JSON state (e.g. the previous Codex
  cumulative total, the previous Claude `cost-state` totals, the held streamed message).
- A rerun reads only bytes after `offset`, and only **complete lines**. A trailing line without
  `\n` is left for the next run unless it already parses as a complete JSON object (then it is
  taken once and a later bare `\n` adds nothing). A file with unchanged size and mtime is not read.
- A file that **shrank**, or whose **mtime went backwards**, is re-parsed from byte 0. A cache entry
  that no longer fits the parser is rebuilt for that file. Files that disappeared drop out of
  both the totals and the cache. Sources not selected by `--harness` keep their cached state.
- SQLite stores (Codex `state_<N>.sqlite`, OpenCode `opencode.db`) are re-queried in full (about
  0.1 s) whenever the database or its `-wal` file changes size or mtime; there is no row offset.
- The cache records its version and timezone; a corrupt file, another version, or another timezone
  is discarded and rebuilt (buckets are keyed by local day, so a new zone needs a re-parse).

## Output

Human: an aligned table (harness row, then one row per model, `TOTAL` when several harnesses).
`--json` schema (`schema: 1`):

```json
{
  "schema": 1,
  "generatedAt": "ISO-8601 UTC",
  "timezone": "IANA zone",
  "since": { "spec": "7d", "day": "YYYY-MM-DD" },
  "harnesses": [
    {
      "harness": "claude",
      "sessions": 0, "costSessions": 0, "costUsd": null,
      "tokens": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "unsplit": 0, "total": 0 },
      "firstActivity": null, "lastActivity": null,
      "models": [{ "model": "...", "sessions": 0, "costSessions": 0, "costUsd": null, "tokens": {}, "firstActivity": null, "lastActivity": null }]
    }
  ],
  "total": { "sessions": 0, "costSessions": 0, "costUsd": null, "tokens": {}, "firstActivity": null, "lastActivity": null }
}
```

`unsplit` counts tokens whose input/output split the source does not record (Codex thread rows).
`todayCost(aggregate, nowMs, tz, harness?)` in `src/application/stats/aggregate.ts` is the pure
function the optional status-line chip will call: stored cost of the local day, `null` when no
bucket of that day carries one.

## Fixtures

`test/fixtures/stats/` holds synthetic, redacted files in the shapes above (no real prompts, ids,
paths or secrets): `claude/projects`, `codex/sessions`, `omp/agent/sessions`, and SQL seeds
(`codex/state-seed.sql`, `opencode/opencode-seed.sql`) that the tests load into temp databases.
