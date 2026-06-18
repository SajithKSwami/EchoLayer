// Parse `claude -p --output-format json` results into normalized token usage, and compare A/B
// conditions. The fixed Claude Code harness overhead (system prompt + tools, ~55K cached tokens)
// is identical across conditions, so the DELTA between cold and echolayer isolates the memory
// effect. We report cost, turns, and fresh (non-cache-read) input — turns especially, since
// fewer exploration turns is the clearest signal that the agent didn't have to reconstruct.

export function parseUsage(json) {
  const r = typeof json === 'string' ? JSON.parse(json) : json;
  const u = r.usage ?? {};
  return {
    costUSD: r.total_cost_usd ?? 0,
    numTurns: r.num_turns ?? 0,
    inputTokens: u.input_tokens ?? 0,
    outputTokens: u.output_tokens ?? 0,
    cacheCreationTokens: u.cache_creation_input_tokens ?? 0,
    cacheReadTokens: u.cache_read_input_tokens ?? 0,
    isError: !!r.is_error,
    result: r.result ?? '',
  };
}

// Mean of a numeric field across an array of parsed-usage objects.
export function mean(samples, field) {
  if (samples.length === 0) return 0;
  return samples.reduce((s, x) => s + (x[field] ?? 0), 0) / samples.length;
}

// Compare two arrays of samples (cold vs echolayer) on the headline fields.
export function compare(cold, echo) {
  const fields = ['costUSD', 'numTurns', 'outputTokens'];
  const out = {};
  for (const f of fields) {
    const c = mean(cold, f);
    const e = mean(echo, f);
    out[f] = { cold: c, echolayer: e, deltaPct: c === 0 ? 0 : Math.round(((c - e) / c) * 100) };
  }
  return out;
}
