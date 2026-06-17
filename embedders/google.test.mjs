// Live-embedder adapter tests — offline, via an injected fake client. Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGoogleEmbedder, GOOGLE_EMBED_MODEL } from './google.mjs';
import { getEmbedder } from './index.mjs';

function makeClient() {
  return {
    reqs: [],
    async batchEmbedContents(req) {
      this.reqs.push(req);
      return { embeddings: req.requests.map((_, i) => ({ values: [i, i + 1, i + 2] })) };
    },
  };
}

test('embedBatch maps the Google response to number[][]', async () => {
  const emb = createGoogleEmbedder({ client: makeClient() });
  const out = await emb.embedBatch(['a', 'b']);
  assert.deepEqual(out, [[0, 1, 2], [1, 2, 3]]);
});

test('embedBatch passes taskType through to the request', async () => {
  const client = makeClient();
  const emb = createGoogleEmbedder({ client });
  await emb.embedBatch(['q'], { taskType: 'RETRIEVAL_QUERY' });
  assert.equal(client.reqs[0].requests[0].taskType, 'RETRIEVAL_QUERY');
});

test('embedBatch defaults taskType to RETRIEVAL_DOCUMENT', async () => {
  const client = makeClient();
  await createGoogleEmbedder({ client }).embedBatch(['doc']);
  assert.equal(client.reqs[0].requests[0].taskType, 'RETRIEVAL_DOCUMENT');
});

test('embedBatch on empty input makes no network call', async () => {
  let called = false;
  const client = { async batchEmbedContents() { called = true; return { embeddings: [] }; } };
  const out = await createGoogleEmbedder({ client }).embedBatch([]);
  assert.deepEqual(out, []);
  assert.equal(called, false);
});

test('embedBatch wraps client errors with an actionable message', async () => {
  const client = { async batchEmbedContents() { throw new Error('403 quota'); } };
  await assert.rejects(
    () => createGoogleEmbedder({ client }).embedBatch(['x']),
    /Google embedder failed.*GOOGLE_API_KEY/s,
  );
});

test('createGoogleEmbedder without key or client throws', () => {
  assert.throws(() => createGoogleEmbedder({ apiKey: '' }), /GOOGLE_API_KEY/);
});

test('getEmbedder falls back to fake when no key is present', () => {
  const sel = getEmbedder({});
  assert.equal(sel.live, false);
});

test('getEmbedder selects the live Google embedder when a key is present', () => {
  const sel = getEmbedder({ GOOGLE_API_KEY: 'test-key' }); // construction is offline; no call made
  assert.equal(sel.live, true);
  assert.equal(sel.embedder.model, GOOGLE_EMBED_MODEL);
});
