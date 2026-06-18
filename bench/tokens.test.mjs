// Token-estimator tests. Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimateTokens, tokensOfItems } from './tokens.mjs';

test('estimateTokens is chars/4 rounded up', () => {
  assert.equal(estimateTokens(''), 0);
  assert.equal(estimateTokens('12345678'), 2);
  assert.equal(estimateTokens('123456789'), 3);
});

test('tokensOfItems sums item text joined by newlines', () => {
  const items = [{ text: 'aaaa' }, { text: 'bbbb' }]; // "aaaa\nbbbb" = 9 chars -> 3
  assert.equal(tokensOfItems(items), 3);
});
