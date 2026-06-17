// Repository over the SQLite store (D1/D2). Encapsulates all data access behind a stable
// interface so capture/flush/reflect/recall/prune depend on methods, not SQL.
//
//   import { openStore } from './store/repo.mjs';
//   const repo = openStore('memory.db');   // or ':memory:'
//
// All timestamps are ISO strings. Embeddings are number[] at the boundary; BLOBs internally.

import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { encodeVec, decodeVec } from './vec.mjs';

const SCHEMA = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'schema.sql'), 'utf8');

let counter = 0;
export function newId(prefix = 'm') {
  // Time-sortable, dependency-free. Not a true ULID, but monotonic enough for ordering.
  return `${prefix}_${Date.now().toString(36)}${(counter++).toString(36).padStart(3, '0')}`;
}

export function openStore(path = ':memory:') {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);

  const stmts = {
    appendEvent: db.prepare(
      `INSERT INTO working_buffer
        (id, ts, session_id, act_type, thought_kind, tool_name, input_digest, obs_digest, status, transcript_uuid, flushed)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    ),
    bufferSize: db.prepare(
      `SELECT COUNT(*) AS n FROM working_buffer WHERE session_id = ? AND flushed = 0`,
    ),
    unflushed: db.prepare(
      `SELECT * FROM working_buffer WHERE flushed = 0 ORDER BY ts ASC LIMIT ?`,
    ),
    markFlushed: db.prepare(`UPDATE working_buffer SET flushed = 1 WHERE id = ?`),
    insertEpisode: db.prepare(
      `INSERT INTO episodes
        (id, created_at, last_accessed_at, session_id, act_type, thought_kind, text, importance, outcome, embedding, source_event_ids)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ),
    insertReflection: db.prepare(
      `INSERT INTO reflections
        (id, created_at, last_accessed_at, kind, text, importance, embedding, evidence_ids, depth)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ),
    candidates: db.prepare(
      `SELECT id, importance, embedding, last_accessed_at, text, 'episode' AS kind FROM episodes
       UNION ALL
       SELECT id, importance, embedding, last_accessed_at, text, kind FROM reflections`,
    ),
    bumpEpisode: db.prepare(`UPDATE episodes SET last_accessed_at = ? WHERE id = ?`),
    bumpReflection: db.prepare(`UPDATE reflections SET last_accessed_at = ? WHERE id = ?`),
    audit: db.prepare(`INSERT INTO audit (ts, operation, detail) VALUES (?, ?, ?)`),
    metaGet: db.prepare(`SELECT value FROM meta WHERE key = ?`),
    metaSet: db.prepare(
      `INSERT INTO meta (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ),
  };

  return {
    db,

    // ── L0 → L1 capture ──────────────────────────────────────────────────────
    appendEvent(e) {
      const id = e.id ?? newId('evt');
      stmts.appendEvent.run(
        id, e.ts ?? new Date().toISOString(), e.session_id,
        e.act_type, e.thought_kind ?? null, e.tool_name ?? null,
        e.input_digest ?? null, e.obs_digest ?? null, e.status ?? null,
        e.transcript_uuid ?? null,
      );
      return id;
    },
    bufferSize(sessionId) {
      return stmts.bufferSize.get(sessionId).n;
    },

    // ── L1 → L2 flush ────────────────────────────────────────────────────────
    // Returns the next page of unflushed events and marks them flushed (one transaction).
    takeFlushBatch(limit) {
      const rows = stmts.unflushed.all(limit);
      db.exec('BEGIN');
      try {
        for (const r of rows) stmts.markFlushed.run(r.id);
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
      return rows;
    },

    // ── L2 episodic write ────────────────────────────────────────────────────
    insertEpisode(ep) {
      const id = ep.id ?? newId('ep');
      const now = ep.created_at ?? new Date().toISOString();
      stmts.insertEpisode.run(
        id, now, ep.last_accessed_at ?? now, ep.session_id,
        ep.act_type, ep.thought_kind ?? null, ep.text,
        ep.importance ?? null, ep.outcome ?? null,
        ep.embedding ? encodeVec(ep.embedding) : null,
        JSON.stringify(ep.source_event_ids ?? []),
      );
      return id;
    },

    // ── L3 reflection write ──────────────────────────────────────────────────
    insertReflection(r) {
      const id = r.id ?? newId('ref');
      const now = r.created_at ?? new Date().toISOString();
      stmts.insertReflection.run(
        id, now, r.last_accessed_at ?? now, r.kind, r.text,
        r.importance, r.embedding ? encodeVec(r.embedding) : null,
        JSON.stringify(r.evidence_ids ?? []), r.depth ?? 1,
      );
      return id;
    },

    // ── L4 retrieval support ─────────────────────────────────────────────────
    // Rows shaped for retrieval/score.mjs: { id, kind, importance, embedding:number[], last_accessed_at }.
    candidatesForRetrieval() {
      return stmts.candidates.all().map((r) => ({
        id: r.id,
        kind: r.kind,
        importance: r.importance,
        last_accessed_at: r.last_accessed_at,
        text: r.text,
        embedding: decodeVec(r.embedding),
      }));
    },
    bumpAccessed(ids, nowISO = new Date().toISOString()) {
      for (const id of ids) {
        stmts.bumpEpisode.run(nowISO, id);
        stmts.bumpReflection.run(nowISO, id);
      }
    },

    // ── audit + meta ─────────────────────────────────────────────────────────
    audit(operation, detail = '') {
      stmts.audit.run(new Date().toISOString(), operation, detail);
    },
    metaGet(key) {
      return stmts.metaGet.get(key)?.value ?? null;
    },
    metaSet(key, value) {
      stmts.metaSet.run(key, String(value));
    },

    close() {
      db.close();
    },
  };
}
