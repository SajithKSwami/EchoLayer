// Gemini llm adapter (gemini-2.5-flash) — implements the full injected llm interface used by
// flush (rateBatch) and reflect (reflectThematic, reflectCorrective). System text is inlined into
// the prompt (robust across per-call task switches); responseMimeType forces JSON output.

import { GoogleGenerativeAI } from '@google/generative-ai';
import { withRetry } from './retry.mjs';
import { RATING_SYSTEM, userPrompt, parseJsonArray, alignRatings } from './rating-util.mjs';
import {
  REFLECT_THEMATIC_SYSTEM, REFLECT_CORRECTIVE_SYSTEM,
  thematicPrompt, correctivePrompt, parseInsights, parseLesson,
} from './reflect-util.mjs';

export const GEMINI_RATER_MODEL = 'gemini-2.5-flash';

export function createGeminiRater({
  apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY,
  model = GEMINI_RATER_MODEL,
  client,
} = {}) {
  const genModel = client ?? buildClient(apiKey, model);

  const call = async (system, content) => {
    let res;
    try {
      res = await withRetry(() => genModel.generateContent(`${system}\n\n${content}`));
    } catch (err) {
      throw new Error(`EchoLayer Gemini call failed (${model}): ${err?.message ?? err}. Check GOOGLE_API_KEY and quota.`);
    }
    return res.response.text();
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

function buildClient(apiKey, model) {
  if (!apiKey) throw new Error('EchoLayer: no GOOGLE_API_KEY / GEMINI_API_KEY set — cannot create the Gemini rater.');
  return new GoogleGenerativeAI(apiKey).getGenerativeModel({
    model,
    generationConfig: { responseMimeType: 'application/json' },
  });
}
