// Shared rating logic for the Claude and Gemini raters (DRY). Prompt + event formatting +
// defensive parsing + normalization — provider-agnostic.

export const RATING_SYSTEM = `You rate a batch of an AI agent's activity events for a long-term memory system.
For EACH event return an object with:
- nl_description: ONE concise past-tense sentence of what happened (no IDs, no raw digests).
- importance: integer 0-10. Failures and task-completions are high (7-10); routine reads/searches
  are low (1-4). Condition importance on the outcome.
- outcome: one of "success", "fail", "neutral".
Return ONLY a JSON array with one object per event, in the same order. No prose, no markdown fences.`;

export function userPrompt(events) {
  return `Rate these ${events.length} events:\n\n${formatEvents(events)}`;
}

function formatEvents(events) {
  return events
    .map((e, i) => `${i + 1}. tool=${e.tool_name ?? e.act_type} status=${e.status ?? 'ok'} ` +
      `input=${truncate(e.input_digest)} obs=${truncate(e.obs_digest)}`)
    .join('\n');
}

function truncate(s, n = 160) {
  if (!s) return '';
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

// Strip optional markdown fences, then parse the first [...] block defensively.
export function parseJsonArray(text) {
  const fenced = String(text ?? '').replace(/```(?:json)?/gi, '').trim();
  const start = fenced.indexOf('[');
  const end = fenced.lastIndexOf(']');
  if (start === -1 || end === -1 || end < start) return [];
  try {
    const arr = JSON.parse(fenced.slice(start, end + 1));
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

// Align parsed ratings to events by index — a malformed/missing item never drops an episode.
export function alignRatings(events, parsed) {
  return events.map((_, i) => normalizeRating(parsed[i]));
}

function normalizeRating(r) {
  const importance = Math.max(0, Math.min(10, Number(r?.importance) || 0));
  const outcome = ['success', 'fail', 'neutral'].includes(r?.outcome) ? r.outcome : 'neutral';
  const nl_description = typeof r?.nl_description === 'string' ? r.nl_description : '';
  return { nl_description, importance, outcome };
}
