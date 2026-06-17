// Single source of truth for tunable parameters. See ARCHITECTURE.md Decisions Log (D4–D12).
// Behavior changes here, never in code.

export const CONFIG = Object.freeze({
  // L1 working buffer / paging
  pageSize: 50, // D4 — flush when the buffer reaches this many events

  // L4 retrieval (consumed by retrieval/score.mjs)
  retrieval: Object.freeze({
    halfLifeHours: 24, // D5
    weights: Object.freeze({ recency: 1, importance: 1, relevance: 1 }), // D6
    k: 8, // D7 — thematic top-k
    omega: 3, // D8 — corrective cap (Reflexion)
  }),

  // L3 reflection triggers
  reflection: Object.freeze({
    thematicThreshold: 30, // D9 — Σ importance since last reflection
    loopRepeat: 3, // D10 — same {action,obs} repeated > this ⇒ corrective
    actionCeiling: 30, // D10 — actions with no progress ⇒ corrective
  }),

  // L2/lifecycle pruning (D11) — reflections are never pruned
  prune: Object.freeze({
    importanceFloor: 3,
    ageDays: 30,
  }),

  // L0 capture scope (D12)
  capture: Object.freeze({
    toolDenylist: Object.freeze([]), // empty = capture every tool call
  }),
});

export default CONFIG;
