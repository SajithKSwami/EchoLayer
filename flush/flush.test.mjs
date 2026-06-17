// L0→L2 flush orchestration, end-to-end with fake llm/embedder. Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from '../store/repo.mjs';
import { appendAndMaybeFlush } from '../capture/capture.mjs';
import { flushPage } from './flush.mjs';
import { retrieve } from '../retrieval/score.mjs';

// Deterministic fakes — no network, no cost.
const fakeLlm = {
  async rateBatch(events) {
    return events.map((e) => ({
      nl_description: `did ${e.tool_name}`,
      importance: e.status === 'error' ? 9 : 4, // failures rate high (Reflexion)
      outcome: e.status === 'error' ? 'fail' : 'success',
    }));
  },
};
const fakeEmbedder = {
  async embedBatch(texts) {
    // 2-D vector keyed off text length — deterministic and distinct enough to rank.
    return texts.map((t) => [t.length, 1]);
  },
};

const cfg = {
  pageSize: 50,
  reflection: { thematicThreshold: 30 },
  capture: { toolDenylist: [] },
};

function seed(repo, n, overrides = {}) {
  for (let i = 0; i < n; i++) {
    appendAndMaybeFlush(
      repo,
      { session_id: 's1', tool_name: 'Grep', tool_input: { q: i }, tool_output: 'ok', ...overrides },
      cfg,
    );
  }
}

test('flushPage drains the buffer into episodes', async () => {
  // Arrange
  const repo = openStore(':memory:');
  seed(repo, 3);
  // Act
  const res = await flushPage(repo, { llm: fakeLlm, embedder: fakeEmbedder }, cfg);
  // Assert
  assert.equal(res.flushed, 3);
  assert.equal(repo.bufferSize('s1'), 0); // buffer drained
  const epCount = repo.db.prepare('SELECT COUNT(*) AS n FROM episodes').get().n;
  assert.equal(epCount, 3);
  repo.close();
});

test('flushPage on an empty buffer is a no-op', async () => {
  const repo = openStore(':memory:');
  const res = await flushPage(repo, { llm: fakeLlm, embedder: fakeEmbedder }, cfg);
  assert.equal(res.flushed, 0);
  assert.equal(res.reflectionDue, false);
  repo.close();
});

test('flushed episodes are immediately retrievable', async () => {
  // Arrange
  const repo = openStore(':memory:');
  seed(repo, 2);
  // Act
  await flushPage(repo, { llm: fakeLlm, embedder: fakeEmbedder }, cfg);
  const candidates = repo.candidatesForRetrieval();
  const bundle = retrieve([], candidates, { embedding: [8, 1], now: new Date() });
  // Assert — the L0→L2→L4 path is connected
  assert.equal(candidates.length, 2);
  assert.ok(bundle.thematic_topk.length > 0);
  repo.close();
});

test('reflectionDue trips once accumulated importance crosses θ', async () => {
  // Arrange — 8 success events × importance 4 = 32 ≥ θ(30)
  const repo = openStore(':memory:');
  seed(repo, 8);
  // Act
  const res = await flushPage(repo, { llm: fakeLlm, embedder: fakeEmbedder }, cfg);
  // Assert
  assert.equal(res.accum, 32);
  assert.equal(res.reflectionDue, true);
  repo.close();
});

test('error events are rated high and stored with outcome=fail', async () => {
  // Arrange
  const repo = openStore(':memory:');
  seed(repo, 1, { tool_output: { is_error: true } });
  // Act
  await flushPage(repo, { llm: fakeLlm, embedder: fakeEmbedder }, cfg);
  // Assert
  const row = repo.db.prepare('SELECT importance, outcome FROM episodes LIMIT 1').get();
  assert.equal(row.outcome, 'fail');
  assert.equal(row.importance, 9);
  repo.close();
});
