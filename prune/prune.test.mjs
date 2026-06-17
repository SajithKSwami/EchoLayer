// Forgetting-job tests. Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from '../store/repo.mjs';
import { prune } from './prune.mjs';

const cfg = { prune: { importanceFloor: 3, ageDays: 30 } };
const NOW = new Date('2026-06-17T12:00:00.000Z');
const OLD = '2026-01-01T00:00:00.000Z'; // > 30 days before NOW
const RECENT = '2026-06-16T12:00:00.000Z'; // < 30 days before NOW

function addEpisode(repo, { importance, created, accessed, text = 'x' }) {
  return repo.insertEpisode({
    session_id: 's1', act_type: 'external', text, importance,
    embedding: [1, 0], created_at: created, last_accessed_at: accessed, source_event_ids: [],
  });
}

test('prunes a cold episode: low importance, old, never re-accessed', () => {
  // Arrange
  const repo = openStore(':memory:');
  addEpisode(repo, { importance: 2, created: OLD, accessed: OLD });
  // Act
  const { pruned } = prune(repo, cfg, { now: NOW });
  // Assert
  assert.equal(pruned, 1);
  assert.equal(repo.db.prepare('SELECT COUNT(*) AS n FROM episodes').get().n, 0);
  repo.close();
});

test('keeps an old episode that is still important', () => {
  const repo = openStore(':memory:');
  addEpisode(repo, { importance: 8, created: OLD, accessed: OLD });
  const { pruned } = prune(repo, cfg, { now: NOW });
  assert.equal(pruned, 0);
  repo.close();
});

test('keeps a low-importance episode that was accessed recently', () => {
  const repo = openStore(':memory:');
  addEpisode(repo, { importance: 1, created: OLD, accessed: RECENT }); // re-accessed
  const { pruned } = prune(repo, cfg, { now: NOW });
  assert.equal(pruned, 0);
  repo.close();
});

test('keeps a recent low-importance episode', () => {
  const repo = openStore(':memory:');
  addEpisode(repo, { importance: 1, created: RECENT, accessed: RECENT });
  const { pruned } = prune(repo, cfg, { now: NOW });
  assert.equal(pruned, 0);
  repo.close();
});

test('never prunes reflections, even old low-importance ones', () => {
  // Arrange
  const repo = openStore(':memory:');
  repo.insertReflection({
    kind: 'corrective', text: 'old lesson', importance: 1, embedding: [1, 0],
    created_at: OLD, last_accessed_at: OLD, evidence_ids: [],
  });
  // Act
  prune(repo, cfg, { now: NOW });
  // Assert
  assert.equal(repo.db.prepare('SELECT COUNT(*) AS n FROM reflections').get().n, 1);
  repo.close();
});

test('prune writes an audit entry', () => {
  const repo = openStore(':memory:');
  addEpisode(repo, { importance: 2, created: OLD, accessed: OLD });
  prune(repo, cfg, { now: NOW });
  const row = repo.db.prepare("SELECT operation FROM audit WHERE operation='prune'").get();
  assert.equal(row.operation, 'prune');
  repo.close();
});
