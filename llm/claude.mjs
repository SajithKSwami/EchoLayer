// D13 rating adapter — Claude (claude-haiku-4-5) for the flush importance/NL/outcome pass.
// Implements the injected llm interface: rateBatch(events) -> [{ nl_description, importance, outcome }].
// One batched call per page-flush (not per event). Client is injectable for offline tests.
//
// Model: Haiku is the deliberate choice (D13) — rating is cheap, high-volume, once-per-flush
// classification. Change CLAUDE_RATER_MODEL to use a different Claude model.

import Anthropic from '@anthropic-ai/sdk';
import { RATING_SYSTEM, userPrompt, parseJsonArray, alignRatings } from './rating-util.mjs';

export const CLAUDE_RATER_MODEL = 'claude-haiku-4-5';

export function createClaudeRater({ apiKey = process.env.ANTHROPIC_API_KEY, model = CLAUDE_RATER_MODEL, client } = {}) {
  const anthropic = client ?? buildClient(apiKey);

  return {
    model,
    live: true,
    async rateBatch(events) {
      if (events.length === 0) return [];
      let res;
      try {
        res = await anthropic.messages.create({
          model,
          max_tokens: 4096,
          system: RATING_SYSTEM,
          messages: [{ role: 'user', content: userPrompt(events) }],
        });
      } catch (err) {
        throw new Error(`EchoLayer Claude rater failed (${model}): ${err?.message ?? err}. Check ANTHROPIC_API_KEY and quota.`);
      }
      const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
      return alignRatings(events, parseJsonArray(text));
    },
  };
}

function buildClient(apiKey) {
  if (!apiKey) throw new Error('EchoLayer: no ANTHROPIC_API_KEY set — cannot create the Claude rater.');
  return new Anthropic({ apiKey });
}
