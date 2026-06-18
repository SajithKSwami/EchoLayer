// Gemini rater + provider-selection tests — offline via injected client. Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGeminiRater, GEMINI_RATER_MODEL } from './gemini.mjs';
import { getRater } from './index.mjs';

function mockModel(jsonText) {
  return { generateContent: async () => ({ response: { text: () => jsonText } }) };
}

test('Gemini rateBatch parses response.text() JSON into ratings', async () => {
  const client = mockModel('[{"nl_description":"deployed auth","importance":8,"outcome":"success"}]');
  const out = await createGeminiRater({ client }).rateBatch([{ tool_name: 'Bash', status: 'ok' }]);
  assert.deepEqual(out, [{ nl_description: 'deployed auth', importance: 8, outcome: 'success' }]);
});

test('Gemini rateBatch tolerates an object-wrapped array', async () => {
  const client = mockModel('{"ratings":[{"nl_description":"x","importance":2,"outcome":"neutral"}]}');
  const out = await createGeminiRater({ client }).rateBatch([{ tool_name: 'Read' }]);
  assert.equal(out[0].importance, 2);
});

test('Gemini rateBatch on empty input makes no call', async () => {
  let called = false;
  const client = { generateContent: async () => { called = true; return { response: { text: () => '[]' } }; } };
  assert.deepEqual(await createGeminiRater({ client }).rateBatch([]), []);
  assert.equal(called, false);
});

test('createGeminiRater without key or client throws', () => {
  assert.throws(() => createGeminiRater({ apiKey: '' }), /GOOGLE_API_KEY/);
});

test('getRater prefers Claude when both keys are present (default)', () => {
  const sel = getRater({ ANTHROPIC_API_KEY: 'a', GOOGLE_API_KEY: 'g' });
  assert.equal(sel.provider, 'claude');
});

test('getRater uses Gemini when only a Google key is present', () => {
  const sel = getRater({ GOOGLE_API_KEY: 'g' });
  assert.equal(sel.provider, 'gemini');
  assert.equal(sel.llm.model, GEMINI_RATER_MODEL);
});

test('ECHOLAYER_RATER=gemini forces Gemini even with an Anthropic key', () => {
  const sel = getRater({ ANTHROPIC_API_KEY: 'a', GOOGLE_API_KEY: 'g', ECHOLAYER_RATER: 'gemini' });
  assert.equal(sel.provider, 'gemini');
});

test('ECHOLAYER_RATER=fake forces the fake rater', () => {
  const sel = getRater({ ANTHROPIC_API_KEY: 'a', ECHOLAYER_RATER: 'fake' });
  assert.equal(sel.provider, 'fake');
  assert.equal(sel.live, false);
});
