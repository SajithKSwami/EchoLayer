// Embedder selection. Returns the live Google embedder when an API key is present, otherwise
// falls back to the local keyword fake so the system never hard-fails without a key.
//
//   const { embedder, live, why } = getEmbedder();
//
// NOTE: live (768-dim) and fake (10-dim) vectors are NOT compatible. Cosine over mismatched
// lengths returns 0, so a DB built with one embedder degrades gracefully under the other rather
// than crashing — but for real recall quality, build and query with the same embedder (start a
// fresh DB when switching).

import { keywordEmbedder } from '../recall/fake-embedder.mjs';
import { createGoogleEmbedder } from './google.mjs';

export function getEmbedder(env = process.env) {
  const key = env.GOOGLE_API_KEY || env.GEMINI_API_KEY;
  if (!key) {
    return { embedder: keywordEmbedder, live: false, why: 'no GOOGLE_API_KEY / GEMINI_API_KEY' };
  }
  try {
    return { embedder: createGoogleEmbedder({ apiKey: key }), live: true, why: 'google gemini-embedding-001' };
  } catch (e) {
    return { embedder: keywordEmbedder, live: false, why: `google init failed: ${e.message}` };
  }
}
