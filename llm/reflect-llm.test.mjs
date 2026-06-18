// Reflection methods on the llm adapters — offline via injected clients. Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGeminiRater } from './gemini.mjs';
import { createClaudeRater } from './claude.mjs';
import { fakeRater } from './fake-rater.mjs';

const geminiClient = (text) => ({ generateContent: async () => ({ response: { text: () => text } }) });
const claudeClient = (text) => ({ messages: { create: async () => ({ content: [{ type: 'text', text }] }) } });

const EPISODES = [{ id: 'e1', text: 'grep cv.md', outcome: 'success' }, { id: 'e2', text: 'deploy', outcome: 'success' }];
const SLICE = [{ id: 'e3', signature: 'external:edit cv.md', outcome: 'fail' }];

test('Gemini reflectThematic parses an insights array with evidence ids', async () => {
  const client = geminiClient('[{"text":"agent edits cv often","importance":6,"evidence_ids":["e1","e2"]}]');
  const out = await createGeminiRater({ client }).reflectThematic(EPISODES);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].evidence_ids, ['e1', 'e2']);
  assert.equal(out[0].importance, 6);
});

test('Gemini reflectCorrective parses a single lesson object', async () => {
  const client = geminiClient('{"text":"read before editing","importance":9,"evidence_ids":["e3"]}');
  const out = await createGeminiRater({ client }).reflectCorrective(SLICE);
  assert.match(out.text, /read before editing/);
  assert.deepEqual(out.evidence_ids, ['e3']);
});

test('Claude reflectThematic parses insights', async () => {
  const client = claudeClient('[{"text":"pattern","importance":5,"evidence_ids":["e1"]}]');
  const out = await createClaudeRater({ client }).reflectThematic(EPISODES);
  assert.equal(out[0].text, 'pattern');
});

test('Claude reflectCorrective falls back to a safe lesson on unparseable output', async () => {
  const client = claudeClient('not json at all');
  const out = await createClaudeRater({ client }).reflectCorrective(SLICE);
  assert.equal(out.evidence_ids[0], 'e3'); // safe fallback cites the slice
});

test('reflectThematic on no episodes makes no call and returns []', async () => {
  let called = false;
  const client = { generateContent: async () => { called = true; return { response: { text: () => '[]' } }; } };
  assert.deepEqual(await createGeminiRater({ client }).reflectThematic([]), []);
  assert.equal(called, false);
});

test('fake rater implements the full reflection interface', async () => {
  const insights = await fakeRater.reflectThematic(EPISODES);
  const lesson = await fakeRater.reflectCorrective(SLICE);
  assert.equal(insights[0].evidence_ids.length, 2);
  assert.equal(lesson.importance, 9);
});
