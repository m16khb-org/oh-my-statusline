-- Subset of ~/.codex/state_5.sqlite `threads` (columns the stats reader uses).
CREATE TABLE threads (id TEXT PRIMARY KEY, rollout_path TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, tokens_used INTEGER NOT NULL DEFAULT 0, model TEXT, created_at_ms INTEGER, updated_at_ms INTEGER);
-- Covered by the rollout fixture: its rollout token data wins, this row is ignored.
INSERT INTO threads VALUES ('0a000000-0000-4000-8000-00000000c0de', '/redacted/rollout-a.jsonl', 1791626400, 1791712800, 3300, 'gpt-astra-test', 1791626400000, 1791712800000);
-- Rollout deleted: only the lifetime total survives (2026-10-14T12:00:00Z).
INSERT INTO threads VALUES ('0a000000-0000-4000-8000-00000000dead', '/redacted/rollout-z.jsonl', 1791950000, 1791979200, 5000, 'gpt-test-mini', 1791950000000, 1791979200000);
-- No model recorded.
INSERT INTO threads VALUES ('0a000000-0000-4000-8000-00000000beef', '/redacted/rollout-y.jsonl', 1791979200, 1791979260, 700, NULL, 1791979200000, 1791979260000);
-- No tokens at all: not usage.
INSERT INTO threads VALUES ('0a000000-0000-4000-8000-00000000f00d', '/redacted/rollout-x.jsonl', 1791979200, 1791979260, 0, 'gpt-test-mini', 1791979200000, 1791979260000);
