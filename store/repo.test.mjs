// Store layer + store→retrieval wiring. Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from './repo.mjs';
import { encodeVec, decodeVec } from './vec.mjs';
import { retrieve } from '../retrieval/score.mjs';

test('vec codec round-trips an embedding (Float32-exact values)', () => {
  const v = [1, 0, -2, 0.5];
  assert.deepEqual(decodeVec(encodeVec(v)), v);
});

test('appendEvent then bufferSize counts only unflushed events for the session', () => {
  // Arrange
  const repo = openStore(':memory:');
  // Act
  repo.appendEvent({ session_id: 's1', act_type: 'external', tool_name: 'Grep' });
  repo.appendEvent({ session_id: 's1', act_type: 'observation', obs_digest: 'ok' });
  repo.appendEvent({ session_id: 's2', act_type: 'external', tool_name: 'Read' });
  // Assert
  assert.equal(repo.bufferSize('s1'), 2);
  assert.equal(repo.bufferSize('s2'), 1);
  repo.close();
});

test('takeFlushBatch returns the page and marks it flushed', () => {
  // Arrange
  const repo = openStore(':memory:');
  repo.appendEvent({ session_id: 's1', act_type: 'external', tool_name: 'Grep' });
  repo.appendEvent({ session_id: 's1', act_type: 'external', tool_name: 'Read' });
  // Act
  const batch = repo.takeFlushBatch(10);
  // Assert
  assert.equal(batch.length, 2);
  assert.equal(repo.bufferSize('s1'), 0); // nothing unflushed remains
  repo.close();
});

test('episodes and reflections round-trip and surface through retrieve()', () => {
  // Arrange
  const repo = openStore(':memory:');
  const now = new Date('2026-06-17T12:00:00Z');
  const ts = now.toISOString();
  repo.insertEpisode({
    id: 'onTopic', session_id: 's1', act_type: 'external', text: 'searched cv.md',
    importance: 5, outcome: 'success', embedding: [1, 0], created_at: ts, last_accessed_at: ts,
    source_event_ids: ['evt_1'],
  });
  repo.insertEpisode({
    id: 'offTopic', session_id: 's1', act_type: 'external', text: 'ran the build',
    importance: 5, outcome: 'success', embedding: [0, 1], created_at: ts, last_accessed_at: ts,
    source_event_ids: ['evt_2'],
  });
  repo.insertReflection({
    id: 'corr1', kind: 'corrective', text: 'edit failed; read the file first next time',
    importance: 9, embedding: [1, 0], created_at: ts, last_accessed_at: ts, evidence_ids: ['offTopic'],
  });
  // Act
  const candidates = repo.candidatesForRetrieval();
  const bundle = retrieve([], candidates, { embedding: [1, 0], now });
  // Assert — store→retrieval wiring works end to end
  assert.equal(candidates.length, 3);
  assert.equal(bundle.thematic_topk[0].id, 'onTopic'); // relevance ranks the on-topic episode first
  assert.equal(bundle.corrective[0].id, 'corr1');      // corrective reflection surfaced separately
  repo.close();
});

test('bumpAccessed updates last_accessed_at for surfaced ids', () => {
  // Arrange
  const repo = openStore(':memory:');
  const old = '2026-06-01T00:00:00.000Z';
  repo.insertEpisode({
    id: 'e1', session_id: 's1', act_type: 'external', text: 'x', importance: 5,
    embedding: [1, 0], created_at: old, last_accessed_at: old, source_event_ids: [],
  });
  // Act
  const bumped = '2026-06-17T12:00:00.000Z';
  repo.bumpAccessed(['e1'], bumped);
  // Assert
  const row = repo.db.prepare('SELECT last_accessed_at FROM episodes WHERE id = ?').get('e1');
  assert.equal(row.last_accessed_at, bumped);
  repo.close();
});

test('audit and meta persist', () => {
  // Arrange
  const repo = openStore(':memory:');
  // Act
  repo.audit('flush', '2 events');
  repo.metaSet('reflect_accum', 12.5);
  repo.metaSet('reflect_accum', 30); // upsert overwrites
  // Assert
  const n = repo.db.prepare('SELECT COUNT(*) AS n FROM audit').get().n;
  assert.equal(n, 1);
  assert.equal(repo.metaGet('reflect_accum'), '30');
  repo.close();
});
