-- Claude Activity Memory — canonical schema (ARCHITECTURE.md §3–§5, §8).
-- Driver: node:sqlite (D2). One file, idempotent DDL.

-- L1 working buffer — raw events, pre-cognition, FIFO. `flushed` marks rows handed to the
-- cold path. `transcript_uuid` links to the ground-truth Claude Code transcript record.
CREATE TABLE IF NOT EXISTS working_buffer (
  id              TEXT PRIMARY KEY,
  ts              TEXT NOT NULL,
  session_id      TEXT NOT NULL,
  act_type        TEXT NOT NULL,        -- internal | external | observation
  thought_kind    TEXT,                 -- plan|extract|track|except|commonsense
  tool_name       TEXT,
  input_digest    TEXT,
  obs_digest      TEXT,
  status          TEXT,                 -- ok | error | denied
  transcript_uuid TEXT,
  flushed         INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_buffer_session ON working_buffer(session_id, flushed, ts);

-- L2 episodic stream — one memory object per meaningful event.
CREATE TABLE IF NOT EXISTS episodes (
  id               TEXT PRIMARY KEY,
  created_at       TEXT NOT NULL,
  last_accessed_at TEXT NOT NULL,
  session_id       TEXT NOT NULL,
  act_type         TEXT NOT NULL,       -- internal | external | observation
  thought_kind     TEXT,
  text             TEXT NOT NULL,       -- NL description (LLM-written at flush)
  importance       REAL,                -- 0..10, rated at flush
  outcome          TEXT,                -- success | fail | neutral
  embedding        BLOB,                -- Float32 vector
  source_event_ids TEXT NOT NULL        -- JSON array of transcript/buffer uuids
);
CREATE INDEX IF NOT EXISTS idx_episodes_created     ON episodes(created_at);
CREATE INDEX IF NOT EXISTS idx_episodes_importance  ON episodes(importance);
CREATE INDEX IF NOT EXISTS idx_episodes_outcome     ON episodes(outcome);

-- L3 reflections — thematic (Gen Agents) and corrective (Reflexion). `evidence_ids` are the
-- wiki-style pointers back to episodes and/or child reflections.
CREATE TABLE IF NOT EXISTS reflections (
  id               TEXT PRIMARY KEY,
  created_at       TEXT NOT NULL,
  last_accessed_at TEXT NOT NULL,
  kind             TEXT NOT NULL,       -- thematic | corrective
  text             TEXT NOT NULL,
  importance       REAL NOT NULL,
  embedding        BLOB,
  evidence_ids     TEXT NOT NULL,       -- JSON array
  depth            INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_reflections_kind ON reflections(kind);

-- Audit trail — every save/reflect/prune/delete with a reason.
CREATE TABLE IF NOT EXISTS audit (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  ts        TEXT NOT NULL,
  operation TEXT NOT NULL,
  detail    TEXT
);

-- Key/value state — reflection accumulator (Σ importance since last reflection), counters.
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);
