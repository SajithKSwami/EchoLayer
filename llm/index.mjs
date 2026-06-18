// Rater selection (D13). Live Claude rater when an Anthropic key is present, else the fake.
//
//   const { llm, live, why } = getRater();
//
// Mirrors the embedder factory. The returned `llm` satisfies the interface flush expects
// (rateBatch). Reflect's reflectThematic/reflectCorrective will be added to the live adapter
// when reflect is wired to live models.

import { createClaudeRater } from './claude.mjs';
import { fakeRater } from './fake-rater.mjs';

export function getRater(env = process.env) {
  if (!env.ANTHROPIC_API_KEY) {
    return { llm: fakeRater, live: false, why: 'no ANTHROPIC_API_KEY' };
  }
  try {
    return { llm: createClaudeRater({ apiKey: env.ANTHROPIC_API_KEY }), live: true, why: 'claude-haiku-4-5' };
  } catch (e) {
    return { llm: fakeRater, live: false, why: `claude init failed: ${e.message}` };
  }
}
