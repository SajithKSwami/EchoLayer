// Claude rater tests — offline via an injected Anthropic client. Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClaudeRater, CLAUDE_RATER_MODEL } from './claude.mjs';
import { getRater } from './index.mjs';

// Fake Anthropic client: returns whatever text we set, records the request.
function mockClient(text) {
  return {
    calls: [],
    messages: {
      create: async (req) => {
        mockClient._last = req;
        return { content: [{ type: 'text', text }] };
      },
    },
  };
}

test('rateBatch parses a clean JSON array into ratings', async () => {
  const client = mockClient('[{"nl_description":"deployed auth","importance":7,"outcome":"success"}]');
  const rater = createClaudeRater({ client });
  const out = await rater.rateBatch([{ tool_name: 'Bash', status: 'ok' }]);
  assert.deepEqual(out, [{ nl_description: 'deployed auth', importance: 7, outcome: 'success' }]);
});

test('rateBatch strips markdown fences before parsing', async () => {
  const client = mockClient('```json\n[{"nl_description":"x","importance":3,"outcome":"neutral"}]\n```');
  const out = await createClaudeRater({ client }).rateBatch([{ tool_name: 'Read' }]);
  assert.equal(out[0].importance, 3);
});

test('rateBatch clamps out-of-range importance and defaults bad fields', async () => {
  const client = mockClient('[{"nl_description":42,"importance":99,"outcome":"weird"}]');
  const out = await createClaudeRater({ client }).rateBatch([{ tool_name: 'Edit' }]);
  assert.equal(out[0].importance, 10); // clamped
  assert.equal(out[0].outcome, 'neutral'); // invalid -> neutral
  assert.equal(out[0].nl_description, ''); // non-string -> ''
});

test('rateBatch aligns output to events even if the model returns too few', async () => {
  const client = mockClient('[{"nl_description":"one","importance":5,"outcome":"success"}]');
  const out = await createClaudeRater({ client }).rateBatch([{ tool_name: 'A' }, { tool_name: 'B' }]);
  assert.equal(out.length, 2);
  assert.equal(out[1].outcome, 'neutral'); // missing second -> safe default
});

test('rateBatch on empty input makes no API call', async () => {
  let called = false;
  const client = { messages: { create: async () => { called = true; return { content: [] }; } } };
  const out = await createClaudeRater({ client }).rateBatch([]);
  assert.deepEqual(out, []);
  assert.equal(called, false);
});

test('rateBatch sends the configured model', async () => {
  const client = mockClient('[]');
  await createClaudeRater({ client }).rateBatch([{ tool_name: 'X' }]);
  assert.equal(mockClient._last.model, CLAUDE_RATER_MODEL);
});

test('createClaudeRater without key or client throws', () => {
  assert.throws(() => createClaudeRater({ apiKey: '' }), /ANTHROPIC_API_KEY/);
});

test('getRater falls back to fake when no key is present', () => {
  assert.equal(getRater({}).live, false);
});

test('getRater selects the live Claude rater when a key is present', () => {
  const sel = getRater({ ANTHROPIC_API_KEY: 'test-key' });
  assert.equal(sel.live, true);
  assert.equal(sel.llm.model, CLAUDE_RATER_MODEL);
});
