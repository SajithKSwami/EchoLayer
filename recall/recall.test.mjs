// Recall surface tests — proven on the fake keyword embedder. Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from '../store/repo.mjs';
import { recall } from './recall.mjs';
import { keywordEmbedder, keywordEmbed } from './fake-embedder.mjs';

const deps = { embedder: keywordEmbedder };

function seed(repo) {
  const ts = '2026-06-17T12:00:00.000Z';
  const ep = (text, importance, outcome) =>
    repo.insertEpisode({
      session_id: 'demo', act_type: 'external', text, importance, outcome,
      embedding: keywordEmbed(text), created_at: ts, last_accessed_at: ts, source_event_ids: [],
    });
  ep('rewrote cv summary to emphasize coaching', 6, 'success');
  ep('ran the build all green', 4, 'success');
  ep('deploy failed with error', 9, 'fail');
  repo.insertReflection({
    kind: 'corrective', text: 'edit cv failed repeatedly; read the file first',
    importance: 9, embedding: keywordEmbed('edit cv read file'),
    created_at: ts, last_accessed_at: ts, evidence_ids: [],
  });
}

test('recall returns a composed bundle and ranks the on-topic memory first', async () => {
  // Arrange
  const repo = openStore(':memory:');
  seed(repo);
  // Act
  const bundle = await recall(repo, deps, 'cv summary', { now: new Date('2026-06-17T12:00:00.000Z') });
  // Assert
  assert.ok('short_term' in bundle && 'thematic_topk' in bundle && 'corrective' in bundle);
  assert.match(bundle.thematic_topk[0].text, /cv summary/); // relevance won
  repo.close();
});

test('recall surfaces corrective reflections separately', async () => {
  const repo = openStore(':memory:');
  seed(repo);
  const bundle = await recall(repo, deps, 'edit cv', { now: new Date('2026-06-17T12:00:00.000Z') });
  assert.equal(bundle.corrective.length, 1);
  assert.match(bundle.corrective[0].text, /read the file first/);
  repo.close();
});

test('recall includes the live working buffer as short_term', async () => {
  // Arrange
  const repo = openStore(':memory:');
  seed(repo);
  repo.appendEvent({ session_id: 'demo', act_type: 'external', tool_name: 'Grep', obs_digest: 'live' });
  // Act
  const bundle = await recall(repo, deps, 'anything', { now: new Date() });
  // Assert
  assert.equal(bundle.short_term.length, 1);
  assert.equal(bundle.short_term[0].tool_name, 'Grep');
  repo.close();
});

test('recall bumps last_accessed_at on surfaced memories', async () => {
  // Arrange
  const repo = openStore(':memory:');
  const old = '2026-06-01T00:00:00.000Z';
  repo.insertEpisode({
    session_id: 'demo', act_type: 'external', text: 'cv summary edit', importance: 5,
    embedding: keywordEmbed('cv summary'), created_at: old, last_accessed_at: old, source_event_ids: [],
  });
  // Act
  const at = new Date('2026-06-17T12:00:00.000Z');
  await recall(repo, deps, 'cv summary', { now: at });
  // Assert — recency now reflects access, not creation
  const row = repo.db.prepare('SELECT last_accessed_at FROM episodes LIMIT 1').get();
  assert.equal(row.last_accessed_at, at.toISOString());
  repo.close();
});
