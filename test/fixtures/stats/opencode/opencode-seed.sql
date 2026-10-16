-- Subset of ~/.local/share/opencode/opencode.db: v2 `session_message` plus the legacy `message` table.
CREATE TABLE session_message (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, type TEXT NOT NULL, seq INTEGER NOT NULL, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL);
CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL);

INSERT INTO session_message VALUES ('msg_o1', 'ses_o1', 'assistant', 1, 1792058400000, 1792058400000, '{"time":{"created":1792058400000,"completed":1792058401000},"agent":"build","model":{"id":"gpt-test","providerID":"openai"},"tokens":{"input":100,"output":50,"reasoning":10,"cache":{"read":1000,"write":0}},"cost":0,"finish":"stop","content":[]}');
INSERT INTO session_message VALUES ('msg_o2', 'ses_o1', 'assistant', 2, 1792058460000, 1792058460000, '{"time":{"created":1792058460000},"model":{"id":"claude-test","providerID":"anthropic"},"tokens":{"input":10,"output":5,"reasoning":0,"cache":{"read":20,"write":30}},"cost":0.05,"finish":"stop","content":[]}');
INSERT INTO session_message VALUES ('msg_o3', 'ses_o2', 'assistant', 1, 1792141200000, 1792141200000, '{"time":{"created":1792141200000},"model":{"id":"gpt-test","providerID":"openai"},"tokens":{"input":7,"output":8,"reasoning":0,"cache":{"read":0,"write":0}},"cost":0,"finish":"stop","content":[]}');
-- Aborted response: no usage recorded.
INSERT INTO session_message VALUES ('msg_o4', 'ses_o2', 'assistant', 2, 1792141260000, 1792141260000, '{"time":{"created":1792141260000},"model":{"id":"gpt-test","providerID":"openai"},"finish":"error","content":[]}');
INSERT INTO session_message VALUES ('msg_o5', 'ses_o2', 'user', 3, 1792141270000, 1792141270000, '{"time":{"created":1792141270000},"content":[]}');

-- Copied into session_message already: must not be counted twice.
INSERT INTO message VALUES ('msg_o1', 'ses_o1', 1792058400000, 1792058400000, '{"role":"assistant","modelID":"gpt-test","providerID":"openai","time":{"created":1792058400000},"tokens":{"input":999,"output":999,"reasoning":0,"cache":{"read":0,"write":0}},"cost":0}');
-- Legacy-only row (2026-10-14T12:00:00Z).
INSERT INTO message VALUES ('msg_l1', 'ses_l1', 1791979200000, 1791979200000, '{"role":"assistant","modelID":"gpt-test","providerID":"openai","time":{"created":1791979200000},"tokens":{"input":3,"output":4,"reasoning":0,"cache":{"read":0,"write":0}},"cost":0}');
INSERT INTO message VALUES ('msg_u1', 'ses_l1', 1791979100000, 1791979100000, '{"role":"user","time":{"created":1791979100000}}');
