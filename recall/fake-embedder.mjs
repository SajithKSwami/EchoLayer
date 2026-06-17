// Deterministic fake embedder for proving recall without a live embeddings API.
// Bag-of-words counts over a small fixed vocab — enough that semantically related text scores
// higher under cosine, so demos/tests show real relevance ranking (not just string length).

const VOCAB = ['cv', 'resume', 'build', 'test', 'deploy', 'error', 'interview', 'grep', 'edit', 'summary'];

export function keywordEmbed(text) {
  const t = String(text ?? '').toLowerCase();
  return VOCAB.map((w) => t.split(w).length - 1); // occurrence count per vocab word
}

export const keywordEmbedder = {
  async embedBatch(texts) {
    return texts.map(keywordEmbed);
  },
};
