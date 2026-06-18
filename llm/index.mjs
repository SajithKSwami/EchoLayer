// Rater selection (D13). Order: explicit ECHOLAYER_RATER override, else Claude (Anthropic key)
// > Gemini (Google key) > fake.
//
//   const { llm, live, provider, why } = getRater();
//
// NOTE: construction is offline and does NOT detect Anthropic credit balance — Claude failures
// surface at call time. If your Anthropic account has no credits, set ECHOLAYER_RATER=gemini to
// force the (working) Gemini rater; remove it once Claude has credits to auto-prefer Claude.

import { createClaudeRater } from './claude.mjs';
import { createGeminiRater } from './gemini.mjs';
import { fakeRater } from './fake-rater.mjs';

export function getRater(env = process.env) {
  const forced = (env.ECHOLAYER_RATER || '').toLowerCase();
  const gkey = env.GOOGLE_API_KEY || env.GEMINI_API_KEY;

  const claude = () =>
    env.ANTHROPIC_API_KEY
      ? attempt(() => createClaudeRater({ apiKey: env.ANTHROPIC_API_KEY }), 'claude', 'claude-haiku-4-5')
      : null;
  const gemini = () =>
    gkey ? attempt(() => createGeminiRater({ apiKey: gkey }), 'gemini', 'gemini-2.5-flash') : null;
  const fake = (why) => ({ llm: fakeRater, live: false, provider: 'fake', why });

  if (forced === 'fake') return fake('forced fake');
  if (forced === 'claude') return claude() ?? fake('forced claude but no/invalid key');
  if (forced === 'gemini') return gemini() ?? fake('forced gemini but no/invalid key');
  return claude() ?? gemini() ?? fake('no ANTHROPIC_API_KEY / GOOGLE_API_KEY');
}

function attempt(make, provider, why) {
  try {
    return { llm: make(), live: true, provider, why };
  } catch {
    return null;
  }
}
