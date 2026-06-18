// Shared reflection prompts + parsing for the Claude and Gemini llm adapters (DRY).
// Provider-agnostic, mirrors rating-util.mjs.

import { parseJsonArray } from './rating-util.mjs';

export const REFLECT_THEMATIC_SYSTEM = `You are the reflection module of an AI agent's long-term memory.
Given recent activity episodes (each with an id), synthesize 2-3 higher-level insights or patterns
about what the agent has been doing. Each insight MUST cite the ids of the episodes that support it.
Return ONLY a JSON array: [{ "text": "<insight>", "importance": <integer 0-10>, "evidence_ids": ["<id>", ...] }].
No prose, no markdown fences.`;

export const REFLECT_CORRECTIVE_SYSTEM = `You are the reflection module of an AI agent's long-term memory.
The agent just hit a problem — a repeated loop, a run of failures, or inefficiency. Given the failing
activity (each with an id), write ONE causal, corrective lesson: what went wrong and what to do
differently next time. Be specific and prescriptive.
Return ONLY a JSON object: { "text": "<lesson>", "importance": <integer 0-10>, "evidence_ids": ["<id>", ...] }.
No prose, no markdown fences.`;

export function thematicPrompt(episodes) {
  const lines = episodes.map((e) => `id=${e.id} [${e.outcome ?? 'neutral'}] ${e.text}`).join('\n');
  return `Recent episodes:\n${lines}\n\nSynthesize 2-3 higher-level insights, each citing the episode ids that support it.`;
}

export function correctivePrompt(slice) {
  const lines = slice.map((r) => `id=${r.id} [${r.outcome ?? 'neutral'}] ${stripSignature(r.signature)}`).join('\n');
  return `The agent just hit a problem. Failing activity:\n${lines}\n\nWrite one causal, corrective lesson.`;
}

function stripSignature(sig) {
  const i = String(sig ?? '').indexOf(':');
  return i >= 0 ? sig.slice(i + 1) : String(sig ?? '');
}

export function parseInsights(text) {
  return parseJsonArray(text).map(normalizeNode).filter((n) => n.text);
}

export function parseLesson(text) {
  const obj = parseJsonObject(text);
  return obj ? normalizeNode(obj) : null;
}

function normalizeNode(r) {
  return {
    text: typeof r?.text === 'string' ? r.text : '',
    importance: Math.max(0, Math.min(10, Number(r?.importance) || 5)),
    evidence_ids: Array.isArray(r?.evidence_ids) ? r.evidence_ids.filter((x) => typeof x === 'string') : [],
  };
}

function parseJsonObject(text) {
  const s = String(text ?? '').replace(/```(?:json)?/gi, '').trim();
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a === -1 || b === -1 || b < a) return null;
  try {
    return JSON.parse(s.slice(a, b + 1));
  } catch {
    return null;
  }
}
