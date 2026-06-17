// Tri-metric retrieval engine (CoALA / Generative Agents / Reflexion).
//
// Pure math, zero LLM, zero I/O. The caller supplies already-embedded candidates and an
// already-embedded query; this module ranks them and returns the composed recall bundle
// described in ARCHITECTURE.md §6:  recall(task) -> { short_term, thematic_topk, corrective }.
//
// Functions are side-effect free: instead of mutating last_accessed_at, retrieve() returns the
// list of ids that were surfaced (`touched`) and leaves the DB write to the caller.

const DEFAULTS = Object.freeze({
  weights: Object.freeze({ recency: 1, importance: 1, relevance: 1 }), // Gen Agents: all 1
  halfLifeHours: 24, // recency decay half-life
  k: 8,              // thematic top-k
  omega: 3,          // Reflexion cap on corrective reflections (1-3)
});

const MS_PER_HOUR = 1000 * 60 * 60;

// ── primitive metrics ────────────────────────────────────────────────────────

export function cosine(a, b) {
  if (!a || !b || a.length !== b.length || a.length === 0) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// Exponential decay on age from `last_accessed_at` -> recency in (0, 1].
export function recencyDecay(lastAccessedAt, now, halfLifeHours) {
  const ageHours = (now.getTime() - new Date(lastAccessedAt).getTime()) / MS_PER_HOUR;
  if (!Number.isFinite(ageHours) || ageHours <= 0) return 1;
  const lambda = Math.LN2 / halfLifeHours;
  return Math.exp(-lambda * ageHours);
}

// Min-max normalize a list of numbers into [0, 1]. When every value is equal (range 0),
// they are tied — return 1 for all (top of the band) rather than dividing by zero.
export function minMaxNormalize(values) {
  if (values.length === 0) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;
  if (range === 0) return values.map(() => 1);
  return values.map((v) => (v - min) / range);
}

// ── scoring ──────────────────────────────────────────────────────────────────

// Score every candidate with normalized recency/importance/relevance, then combine.
// Returns a new array of { ...candidate, _score } — input is not mutated.
export function scoreCandidates(candidates, query, opts = {}) {
  const { weights, halfLifeHours } = { ...DEFAULTS, ...opts };
  const w = { ...DEFAULTS.weights, ...(opts.weights || {}) };
  const now = query.now instanceof Date ? query.now : new Date(query.now ?? Date.now());

  if (candidates.length === 0) return [];

  const rawRecency = candidates.map((c) => recencyDecay(c.last_accessed_at, now, halfLifeHours));
  const rawImportance = candidates.map((c) => (c.importance ?? 0) / 10);
  const rawRelevance = candidates.map((c) => cosine(query.embedding, c.embedding));

  const recN = minMaxNormalize(rawRecency);
  const impN = minMaxNormalize(rawImportance);
  const relN = minMaxNormalize(rawRelevance);

  return candidates.map((c, i) => ({
    ...c,
    _score: w.recency * recN[i] + w.importance * impN[i] + w.relevance * relN[i],
    _parts: { recency: recN[i], importance: impN[i], relevance: relN[i] },
  }));
}

function byScoreDesc(a, b) {
  return b._score - a._score;
}

// ── composed recall (ARCHITECTURE.md §6) ─────────────────────────────────────

// retrieve(workingBuffer, candidates, query, opts)
//   workingBuffer : short-term memory, returned verbatim (not scored)
//   candidates    : long-term memories, each { id, kind, importance, embedding,
//                   last_accessed_at, ... }  where kind ∈ 'episode'|'thematic'|'corrective'
//   query         : { embedding:number[], now?:Date }
// Returns: { short_term, thematic_topk, corrective, touched }
export function retrieve(workingBuffer, candidates, query, opts = {}) {
  const cfg = { ...DEFAULTS, ...opts };
  const scored = scoreCandidates(candidates, query, cfg);

  const thematicPool = scored
    .filter((c) => c.kind === 'episode' || c.kind === 'thematic')
    .sort(byScoreDesc)
    .slice(0, cfg.k);

  // Corrective reflections are capped at Ω so the freshest, most relevant lesson surfaces
  // first and stale ones don't crowd the context window (Reflexion).
  const corrective = scored
    .filter((c) => c.kind === 'corrective')
    .sort(byScoreDesc)
    .slice(0, cfg.omega);

  const touched = [...thematicPool, ...corrective].map((c) => c.id);

  return {
    short_term: workingBuffer ?? [],
    thematic_topk: thematicPool,
    corrective,
    touched, // caller bumps last_accessed_at = now for these ids
  };
}

export { DEFAULTS };
