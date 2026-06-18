// Claude llm adapter (claude-haiku-4-5) — implements the full injected llm interface used by
// flush (rateBatch) and reflect (reflectThematic, reflectCorrective). One batched call each.
// Client is injectable for offline tests. Haiku is the deliberate D13 choice (cheap, frequent).

import Anthropic from '@anthropic-ai/sdk';
import { withRetry } from './retry.mjs';
import { RATING_SYSTEM, userPrompt, parseJsonArray, alignRatings } from './rating-util.mjs';
import {
  REFLECT_THEMATIC_SYSTEM, REFLECT_CORRECTIVE_SYSTEM,
  thematicPrompt, correctivePrompt, parseInsights, parseLesson,
} from './reflect-util.mjs';

export const CLAUDE_RATER_MODEL = 'claude-haiku-4-5';

export function createClaudeRater({ apiKey = process.env.ANTHROPIC_API_KEY, model = CLAUDE_RATER_MODEL, client } = {}) {
  const anthropic = client ?? buildClient(apiKey);

  const call = async (system, content) => {
    let res;
    try {
      res = await withRetry(() => anthropic.messages.create({ model, max_tokens: 4096, system, messages: [{ role: 'user', content }] }));
    } catch (err) {
      throw new Error(`EchoLayer Claude call failed (${model}): ${err?.message ?? err}. Check ANTHROPIC_API_KEY and quota.`);
    }
    return res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  };

  return {
    model,
    live: true,
    async rateBatch(events) {
      if (events.length === 0) return [];
      return alignRatings(events, parseJsonArray(await call(RATING_SYSTEM, userPrompt(events))));
    },
    async reflectThematic(episodes) {
      if (episodes.length === 0) return [];
      return parseInsights(await call(REFLECT_THEMATIC_SYSTEM, thematicPrompt(episodes)));
    },
    async reflectCorrective(slice) {
      const lesson = parseLesson(await call(REFLECT_CORRECTIVE_SYSTEM, correctivePrompt(slice)));
      return lesson ?? { text: '', importance: 9, evidence_ids: slice.map((r) => r.id) };
    },
  };
}

function buildClient(apiKey) {
  if (!apiKey) throw new Error('EchoLayer: no ANTHROPIC_API_KEY set — cannot create the Claude rater.');
  return new Anthropic({ apiKey });
}
