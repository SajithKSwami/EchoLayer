// Unit tests for the tri-metric retrieval engine. Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cosine,
  recencyDecay,
  minMaxNormalize,
  scoreCandidates,
  retrieve,
} from './score.mjs';

test('cosine returns 1 for identical direction and 0 for orthogonal', () => {
  // Arrange
  const a = [1, 0, 0];
  const b = [2, 0, 0];
  const c = [0, 1, 0];
  // Act + Assert
  assert.equal(cosine(a, b), 1);
  assert.equal(cosine(a, c), 0);
});

test('cosine returns 0 for a zero vector instead of dividing by zero', () => {
  assert.equal(cosine([0, 0, 0], [1, 2, 3]), 0);
});

test('recencyDecay is 1 at age zero and falls to 0.5 at one half-life', () => {
  // Arrange
  const now = new Date('2026-06-17T12:00:00Z');
  const oneHalfLifeAgo = new Date('2026-06-16T12:00:00Z'); // 24h earlier
  // Act
  const fresh = recencyDecay(now.toISOString(), now, 24);
  const halved = recencyDecay(oneHalfLifeAgo.toISOString(), now, 24);
  // Assert
  assert.equal(fresh, 1);
  assert.ok(Math.abs(halved - 0.5) < 1e-9);
});

test('minMaxNormalize maps a range onto [0,1]', () => {
  assert.deepEqual(minMaxNormalize([10, 20, 30]), [0, 0.5, 1]);
});

test('minMaxNormalize ties all-equal values at 1 rather than NaN', () => {
  assert.deepEqual(minMaxNormalize([5, 5, 5]), [1, 1, 1]);
});

test('scoreCandidates does not mutate the input candidates', () => {
  // Arrange
  const now = new Date('2026-06-17T12:00:00Z');
  const candidates = [
    { id: 'a', importance: 5, embedding: [1, 0], last_accessed_at: now.toISOString() },
  ];
  const snapshot = JSON.parse(JSON.stringify(candidates));
  // Act
  scoreCandidates(candidates, { embedding: [1, 0], now });
  // Assert
  assert.deepEqual(candidates, snapshot);
});

test('relevance dominates: the on-topic memory outranks an off-topic one', () => {
  // Arrange — equal recency & importance, only relevance differs
  const now = new Date('2026-06-17T12:00:00Z');
  const ts = now.toISOString();
  const candidates = [
    { id: 'onTopic', kind: 'episode', importance: 5, embedding: [1, 0], last_accessed_at: ts },
    { id: 'offTopic', kind: 'episode', importance: 5, embedding: [0, 1], last_accessed_at: ts },
  ];
  // Act
  const { thematic_topk } = retrieve([], candidates, { embedding: [1, 0], now });
  // Assert
  assert.equal(thematic_topk[0].id, 'onTopic');
});

test('corrective reflections are capped at omega', () => {
  // Arrange
  const now = new Date('2026-06-17T12:00:00Z');
  const ts = now.toISOString();
  const candidates = Array.from({ length: 5 }, (_, i) => ({
    id: `corr${i}`,
    kind: 'corrective',
    importance: 9,
    embedding: [1, 0],
    last_accessed_at: ts,
  }));
  // Act
  const { corrective } = retrieve([], candidates, { embedding: [1, 0], now }, { omega: 2 });
  // Assert
  assert.equal(corrective.length, 2);
});

test('retrieve returns the working buffer verbatim as short_term', () => {
  // Arrange
  const buffer = [{ id: 'live1' }, { id: 'live2' }];
  // Act
  const out = retrieve(buffer, [], { embedding: [1, 0], now: new Date() });
  // Assert
  assert.deepEqual(out.short_term, buffer);
});

test('touched lists exactly the surfaced thematic + corrective ids', () => {
  // Arrange
  const now = new Date('2026-06-17T12:00:00Z');
  const ts = now.toISOString();
  const candidates = [
    { id: 'e1', kind: 'episode', importance: 5, embedding: [1, 0], last_accessed_at: ts },
    { id: 'c1', kind: 'corrective', importance: 9, embedding: [1, 0], last_accessed_at: ts },
  ];
  // Act
  const { touched } = retrieve([], candidates, { embedding: [1, 0], now });
  // Assert
  assert.deepEqual(touched.sort(), ['c1', 'e1']);
});

test('empty candidate set yields empty slices, no throw', () => {
  const out = retrieve([], [], { embedding: [1, 0], now: new Date() });
  assert.deepEqual(out.thematic_topk, []);
  assert.deepEqual(out.corrective, []);
  assert.deepEqual(out.touched, []);
});
