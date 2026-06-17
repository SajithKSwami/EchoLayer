// L3 reflection tests — thematic + corrective, with fakes. Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from '../store/repo.mjs';
import { detectCorrectiveTrigger, reflectThematic, reflectCorrective } from './reflect.mjs';
import { retrieve } from '../retrieval/score.mjs';

const cfg = {
  reflection: { thematicThreshold: 30, loopRepeat: 3, actionCeiling: 30 },
};

const fakeLlm = {
  async reflectThematic(episodes) {
    return [{ text: 'pattern: lots of grepping cv.md', importance: 6, evidence_ids: episodes.map((e) => e.id) }];
  },
  async reflectCorrective(slice) {
    return { text: 'edit failed repeatedly; read the file first', importance: 9, evidence_ids: slice.map((r) => r.id) };
  },
};
const fakeEmbedder = { async embedBatch(texts) { return texts.map((t) => [t.length, 1]); } };

function addEpisode(repo, over = {}) {
  return repo.insertEpisode({
    session_id: 's1', act_type: 'external', text: 'grep cv.md', importance: 4,
    outcome: 'success', embedding: [1, 0], source_event_ids: [], ...over,
  });
}

// ── corrective trigger (pure) ────────────────────────────────────────────────
test('detectCorrectiveTrigger fires on a repeated-action loop', () => {
  const records = Array.from({ length: 4 }, (_, i) => ({ id: `r${i}`, signature: 'Edit:x', outcome: 'fail' }));
  const out = detectCorrectiveTrigger(records, cfg);
  assert.equal(out.triggered, true);
  assert.equal(out.reason, 'loop');
});

test('detectCorrectiveTrigger fires on two consecutive failures', () => {
  const records = [
    { id: 'a', signature: 's1', outcome: 'success' },
    { id: 'b', signature: 's2', outcome: 'fail' },
    { id: 'c', signature: 's3', outcome: 'fail' },
  ];
  const out = detectCorrectiveTrigger(records, cfg);
  assert.equal(out.reason, 'failure-run');
  assert.deepEqual(out.slice.map((r) => r.id), ['b', 'c']);
});

test('detectCorrectiveTrigger stays quiet on a clean run', () => {
  const records = [
    { id: 'a', signature: 's1', outcome: 'success' },
    { id: 'b', signature: 's2', outcome: 'success' },
  ];
  assert.equal(detectCorrectiveTrigger(records, cfg).triggered, false);
});

// ── thematic ─────────────────────────────────────────────────────────────────
test('reflectThematic does nothing below threshold', async () => {
  const repo = openStore(':memory:');
  repo.metaSet('reflect_accum', 10);
  const res = await reflectThematic(repo, { llm: fakeLlm, embedder: fakeEmbedder }, cfg);
  assert.equal(res.ran, false);
  repo.close();
});

test('reflectThematic synthesizes, resets accumulator, and is retrievable', async () => {
  // Arrange
  const repo = openStore(':memory:');
  addEpisode(repo);
  addEpisode(repo);
  repo.metaSet('reflect_accum', 35); // over θ
  // Act
  const res = await reflectThematic(repo, { llm: fakeLlm, embedder: fakeEmbedder }, cfg);
  // Assert
  assert.equal(res.ran, true);
  assert.equal(repo.metaGet('reflect_accum'), '0'); // reset
  const refl = repo.db.prepare("SELECT COUNT(*) AS n FROM reflections WHERE kind='thematic'").get().n;
  assert.equal(refl, 1);
  // surfaces through retrieval
  const bundle = retrieve([], repo.candidatesForRetrieval(), { embedding: [30, 1], now: new Date() });
  assert.ok(bundle.thematic_topk.some((c) => c.kind === 'thematic'));
  repo.close();
});

// ── corrective ───────────────────────────────────────────────────────────────
test('reflectCorrective writes a corrective node when a loop is present', async () => {
  // Arrange — 4 identical failing edits = a loop
  const repo = openStore(':memory:');
  for (let i = 0; i < 4; i++) addEpisode(repo, { text: 'edit cv.md', outcome: 'fail', importance: 9 });
  // Act
  const res = await reflectCorrective(repo, { llm: fakeLlm, embedder: fakeEmbedder }, cfg);
  // Assert
  assert.equal(res.ran, true);
  assert.equal(res.reason, 'loop');
  const row = repo.db.prepare("SELECT kind, importance FROM reflections WHERE kind='corrective'").get();
  assert.equal(row.kind, 'corrective');
  assert.equal(row.importance, 9);
  repo.close();
});

test('reflectCorrective is a no-op on a healthy session', async () => {
  const repo = openStore(':memory:');
  addEpisode(repo, { text: 'a' });
  addEpisode(repo, { text: 'b' });
  const res = await reflectCorrective(repo, { llm: fakeLlm, embedder: fakeEmbedder }, cfg);
  assert.equal(res.ran, false);
  repo.close();
});
