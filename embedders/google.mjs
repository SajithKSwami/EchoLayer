// Live embedder adapter (D14) — Google text-embedding-004 (768-dim).
// Implements the injected embedder interface: embedBatch(texts, { taskType }) -> number[][].
// The underlying client is injectable so the mapping logic is unit-testable offline.

import { GoogleGenerativeAI } from '@google/generative-ai';

export const GOOGLE_EMBED_MODEL = 'text-embedding-004';

export function createGoogleEmbedder({
  apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY,
  model = GOOGLE_EMBED_MODEL,
  client,
} = {}) {
  const embeddingModel = client ?? buildClient(apiKey, model);

  return {
    model,
    live: true,
    // taskType improves quality: stored memories are RETRIEVAL_DOCUMENT, the query is
    // RETRIEVAL_QUERY (recall passes that). The fake embedder ignores the option.
    async embedBatch(texts, { taskType = 'RETRIEVAL_DOCUMENT' } = {}) {
      if (texts.length === 0) return [];
      try {
        const res = await embeddingModel.batchEmbedContents({
          requests: texts.map((text) => ({ content: { parts: [{ text }] }, taskType })),
        });
        return res.embeddings.map((e) => e.values);
      } catch (err) {
        throw new Error(
          `EchoLayer Google embedder failed (${model}): ${err?.message ?? err}. ` +
            'Check GOOGLE_API_KEY validity, quota, and network.',
        );
      }
    },
  };
}

function buildClient(apiKey, model) {
  if (!apiKey) {
    throw new Error('EchoLayer: no GOOGLE_API_KEY / GEMINI_API_KEY set — cannot create the live embedder.');
  }
  return new GoogleGenerativeAI(apiKey).getGenerativeModel({ model });
}
