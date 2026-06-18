// D13 rating adapter — Claude (claude-haiku-4-5) for the flush importance/NL/outcome pass.
// Implements the injected llm interface: rateBatch(events) -> [{ nl_description, importance, outcome }].
// One batched call per page-flush (not per event). Client is injectable for offline tests.
//
// Model: Haiku is the deliberate choice (D13) — rating is cheap, high-volume, once-per-flush
// classification. Change CLAUDE_RATER_MODEL to use a different Claude model.

import Anthropic from '@anthropic-ai/sdk';

export const CLAUDE_RATER_MODEL = 'claude-haiku-4-5';

const SYSTEM = `You rate a batch of an AI agent's activity events for a long-term memory system.
For EACH event return an object with:
- nl_description: ONE concise past-tense sentence of what happened (no IDs, no raw digests).
- importance: integer 0-10. Failures and task-completions are high (7-10); routine reads/searches
  are low (1-4). Condition importance on the outcome.
- outcome: one of "success", "fail", "neutral".
Return ONLY a JSON array with one object per event, in the same order. No prose, no markdown fences.`;

export function createClaudeRater({ apiKey = process.env.ANTHROPIC_API_KEY, model = CLAUDE_RATER_MODEL, client } = {}) {
  const anthropic = client ?? buildClient(apiKey);

  return {
    model,
    live: true,
    async rateBatch(events) {
      if (events.length === 0) return [];
      const list = events
        .map((e, i) => `${i + 1}. tool=${e.tool_name ?? e.act_type} status=${e.status ?? 'ok'} ` +
          `input=${truncate(e.input_digest)} obs=${truncate(e.obs_digest)}`)
        .join('\n');

      let res;
      try {
        res = await anthropic.messages.create({
          model,
          max_tokens: 4096,
          system: SYSTEM,
          messages: [{ role: 'user', content: `Rate these ${events.length} events:\n\n${list}` }],
        });
      } catch (err) {
        throw new Error(`EchoLayer Claude rater failed (${model}): ${err?.message ?? err}. Check ANTHROPIC_API_KEY and quota.`);
      }

      const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
      const parsed = parseJsonArray(text);
      // Align to events by index; never let a malformed item drop an episode's rating.
      return events.map((_, i) => normalizeRating(parsed[i]));
    },
  };
}

function buildClient(apiKey) {
  if (!apiKey) throw new Error('EchoLayer: no ANTHROPIC_API_KEY set — cannot create the Claude rater.');
  return new Anthropic({ apiKey });
}

function truncate(s, n = 160) {
  if (!s) return '';
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

// Defensive: strip optional markdown fences, then parse the first [...] block.
function parseJsonArray(text) {
  const fenced = text.replace(/```(?:json)?/gi, '').trim();
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

function normalizeRating(r) {
  const importance = Math.max(0, Math.min(10, Number(r?.importance) || 0));
  const outcome = ['success', 'fail', 'neutral'].includes(r?.outcome) ? r.outcome : 'neutral';
  const nl_description = typeof r?.nl_description === 'string' ? r.nl_description : '';
  return { nl_description, importance, outcome };
}
