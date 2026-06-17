// L3 reflection cycles (§5). Two kinds, two triggers, both behind injected deps (D13/D14):
//   llm.reflectThematic(episodes)  -> Promise<[{ text, importance, evidence_ids }]>
//   llm.reflectCorrective(slice)   -> Promise<{ text, importance, evidence_ids }>
//   embedder.embedBatch(texts)     -> Promise<number[][]>
//
// Thematic  = Generative Agents: fires when Σ importance since last reflection > θ.
// Corrective = Reflexion: fires on a CHEAP behavioral heuristic (loop / failure-run /
// inefficiency) detected over recent episodes — 0 LLM to decide, 1 LLM call to write the lesson.

import CONFIG from '../config.mjs';

const ACCUM_KEY = 'reflect_accum';

// ── corrective trigger (pure, 0 LLM) ─────────────────────────────────────────
// records: [{ id, signature, outcome }]. Returns { triggered, reason, slice }.
export function detectCorrectiveTrigger(records, config = CONFIG) {
  const { loopRepeat, actionCeiling } = config.reflection;

  // Loop: the same action+observation signature repeated more than loopRepeat times.
  const counts = new Map();
  for (const r of records) counts.set(r.signature, (counts.get(r.signature) ?? 0) + 1);
  for (const [sig, n] of counts) {
    if (n > loopRepeat) {
      return { triggered: true, reason: 'loop', slice: records.filter((r) => r.signature === sig) };
    }
  }

  // Failure run: two or more consecutive failures.
  for (let i = 1; i < records.length; i++) {
    if (records[i].outcome === 'fail' && records[i - 1].outcome === 'fail') {
      return { triggered: true, reason: 'failure-run', slice: [records[i - 1], records[i]] };
    }
  }

  // Inefficiency: too many actions with no resolution.
  if (records.length > actionCeiling) {
    return { triggered: true, reason: 'inefficiency', slice: records };
  }

  return { triggered: false, reason: null, slice: [] };
}

function signatureOf(ep) {
  return `${ep.act_type}:${ep.text}`;
}

// ── thematic reflection ──────────────────────────────────────────────────────
export async function reflectThematic(repo, { llm, embedder }, config = CONFIG) {
  const accum = Number.parseFloat(repo.metaGet(ACCUM_KEY) ?? '0') || 0;
  if (accum < config.reflection.thematicThreshold) return { ran: false, reason: 'below-threshold' };

  const episodes = repo.recentEpisodes(50);
  if (episodes.length === 0) return { ran: false, reason: 'no-episodes' };

  const insights = await llm.reflectThematic(episodes);
  const vectors = await embedder.embedBatch(insights.map((i) => i.text));

  insights.forEach((ins, i) => {
    repo.insertReflection({
      kind: 'thematic',
      text: ins.text,
      importance: ins.importance ?? 5,
      embedding: vectors[i] ?? [],
      evidence_ids: ins.evidence_ids ?? [],
      depth: 1,
    });
  });

  repo.metaSet(ACCUM_KEY, 0); // reset accumulator after reflecting
  repo.audit('reflect-thematic', `${insights.length} insights from ${episodes.length} episodes`);
  return { ran: true, count: insights.length };
}

// ── corrective reflection ────────────────────────────────────────────────────
export async function reflectCorrective(repo, { llm, embedder }, config = CONFIG) {
  const episodes = repo.recentEpisodes(config.reflection.actionCeiling + 5);
  const records = episodes
    .slice()
    .reverse() // chronological for run detection
    .map((e) => ({ id: e.id, signature: signatureOf(e), outcome: e.outcome }));

  const { triggered, reason, slice } = detectCorrectiveTrigger(records, config);
  if (!triggered) return { ran: false, reason: 'no-trigger' };

  const lesson = await llm.reflectCorrective(slice);
  const [vec] = await embedder.embedBatch([lesson.text]);
  repo.insertReflection({
    kind: 'corrective',
    text: lesson.text,
    importance: lesson.importance ?? 9,
    embedding: vec ?? [],
    evidence_ids: lesson.evidence_ids ?? slice.map((r) => r.id),
    depth: 1,
  });

  repo.audit('reflect-corrective', `reason=${reason}, ${slice.length} episodes`);
  return { ran: true, reason };
}
