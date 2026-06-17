// L4 recall surface (§6). The query interface Claude (or a CLI/MCP wrapper) calls.
// Embeds the task, runs the tri-metric scorer over all candidates, returns the composed
// { short_term, thematic_topk, corrective } bundle, and bumps last_accessed_at on what it
// surfaced (so retrieval keeps recently-used memory hot).
//
// Dependency injected (D14):  embedder.embedBatch(texts) -> Promise<number[][]>

import { retrieve } from '../retrieval/score.mjs';
import CONFIG from '../config.mjs';

export async function recall(repo, { embedder }, queryText, opts = {}) {
  const [queryEmbedding] = await embedder.embedBatch([queryText], { taskType: 'RETRIEVAL_QUERY' });
  const now = opts.now ?? new Date();

  const shortTerm = repo.peekBuffer(opts.shortTermLimit ?? 20);
  const candidates = repo.candidatesForRetrieval();

  const bundle = retrieve(
    shortTerm,
    candidates,
    { embedding: queryEmbedding, now },
    { ...CONFIG.retrieval, ...(opts.retrieval ?? {}) },
  );

  repo.bumpAccessed(bundle.touched, now.toISOString());
  return bundle;
}
