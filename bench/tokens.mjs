// Rough token estimate (chars / 4) — dependency-free and deterministic. It is NOT a real
// tokenizer, but the benchmark compares RATIOS between strategies, where a consistent estimator
// is sufficient. Swap in a real tokenizer if you want exact counts.

export function estimateTokens(text) {
  return Math.ceil(String(text ?? '').length / 4);
}

export function tokensOfItems(items) {
  return estimateTokens(items.map((x) => x.text).join('\n'));
}
