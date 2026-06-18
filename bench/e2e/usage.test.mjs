// Usage-parser tests, verified against a REAL `claude -p --output-format json` result captured
// from this machine. Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseUsage, mean, compare } from './usage.mjs';

// Trimmed but real sample (claude -p "reply OK" --output-format json).
const REAL_SAMPLE = {
  type: 'result', subtype: 'success', is_error: false, num_turns: 1, result: 'OK',
  total_cost_usd: 0.2103681,
  usage: {
    input_tokens: 2, cache_creation_input_tokens: 54870, cache_read_input_tokens: 15132, output_tokens: 4,
  },
};

test('parseUsage extracts the headline fields from a real result', () => {
  const u = parseUsage(REAL_SAMPLE);
  assert.equal(u.costUSD, 0.2103681);
  assert.equal(u.numTurns, 1);
  assert.equal(u.cacheCreationTokens, 54870);
  assert.equal(u.outputTokens, 4);
  assert.equal(u.isError, false);
});

test('parseUsage accepts a JSON string too', () => {
  const u = parseUsage(JSON.stringify(REAL_SAMPLE));
  assert.equal(u.result, 'OK');
});

test('mean averages a field across samples', () => {
  assert.equal(mean([{ numTurns: 2 }, { numTurns: 4 }], 'numTurns'), 3);
});

test('compare reports cold-vs-echolayer delta percentages', () => {
  const cold = [{ costUSD: 1.0, numTurns: 10, outputTokens: 1000 }];
  const echo = [{ costUSD: 0.6, numTurns: 4, outputTokens: 700 }];
  const c = compare(cold, echo);
  assert.equal(c.costUSD.deltaPct, 40); // 40% cheaper
  assert.equal(c.numTurns.deltaPct, 60); // 60% fewer turns
});
