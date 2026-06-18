// D13 rating adapter — Gemini (gemini-2.5-flash). Same injected interface and shared rating
// logic as the Claude rater; uses the @google/generative-ai SDK already in the project.
// Selected by the factory when there's a Google key but no Anthropic credits/key.

import { GoogleGenerativeAI } from '@google/generative-ai';
import { RATING_SYSTEM, userPrompt, parseJsonArray, alignRatings } from './rating-util.mjs';

export const GEMINI_RATER_MODEL = 'gemini-2.5-flash';

export function createGeminiRater({
  apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY,
  model = GEMINI_RATER_MODEL,
  client,
} = {}) {
  const genModel = client ?? buildClient(apiKey, model);

  return {
    model,
    live: true,
    async rateBatch(events) {
      if (events.length === 0) return [];
      let res;
      try {
        res = await genModel.generateContent(userPrompt(events));
      } catch (err) {
        throw new Error(`EchoLayer Gemini rater failed (${model}): ${err?.message ?? err}. Check GOOGLE_API_KEY and quota.`);
      }
      return alignRatings(events, parseJsonArray(res.response.text()));
    },
  };
}

function buildClient(apiKey, model) {
  if (!apiKey) throw new Error('EchoLayer: no GOOGLE_API_KEY / GEMINI_API_KEY set — cannot create the Gemini rater.');
  return new GoogleGenerativeAI(apiKey).getGenerativeModel({
    model,
    systemInstruction: RATING_SYSTEM,
    generationConfig: { responseMimeType: 'application/json' }, // force structured JSON output
  });
}
