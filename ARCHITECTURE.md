# Claude Activity Memory — Architecture

A long-term memory system that captures **every Claude tool call**, pages it through a
bounded working buffer, persists it as a date-indexed episodic stream, synthesizes
**reflection trees** that link back to their evidence, and serves it back through a
**tri-metric retrieval engine**.

Synthesis of four sources (the latter two are the primary papers CoALA generalizes):

- **CoALA** (Cognitive Architectures for Language Agents) — the working / episodic /
  semantic memory split, the **internal vs. external action** taxonomy, and the
  decide→act→observe loop.
- **Generative Agents** (Park et al., 2023) — the *memory stream*, *reflection*, and the
  `recency · importance · relevance` retrieval function.
- **ReAct** (Yao et al., 2023) — the unit of activity is a `{thought, action, observation}`
  trajectory, where a *thought* is an internal action in language space (`Â = A ∪ L`) that
  produces no observation. This is why §2 captures reasoning, not just tool calls.
- **Reflexion** (Shinn et al., 2023) — short-term memory = trajectory, long-term =
  *distilled, corrective* reflections bounded to the last Ω; cheap behavioral triggers for
  reflection; outcome/reward signals that inform salience. Drives §5 and §6.

Status: **building.** `retrieval/` and `store/` are implemented and tested. This document is
the contract; the Decisions Log below records choices made as architect.

---

## Decisions Log

Resolved as architect (B-path chosen; see §11). These are now defaults in
[`config.mjs`](config.mjs), not open questions.

| # | Decision | Value | Rationale |
|---|---|---|---|
| D1 | Storage path | **(B) standalone SQLite** | Full control over α/β/γ; `retrieval/` is the primary ranker. |
| D2 | SQLite driver | **`node:sqlite`** (built-in) | Node v24 here; zero deps, no native build on Windows. Min Node **22.5**. |
| D3 | Embedding storage | Float32 `BLOB` | Compact; cosine is precision-tolerant. |
| D4 | `K` (page size) | 50 | Flush at 50 events, on session-end, or idle. |
| D5 | Recency half-life | 24 h | `λ = ln2/24`. |
| D6 | Weights α/β/γ | 1 / 1 / 1 | Generative Agents default. |
| D7 | `k` thematic top-k | 8 | Fits a context budget after trimming. |
| D8 | `Ω` corrective cap | 3 | Reflexion bound (1–3). |
| D9 | `θ` thematic trigger | Σ importance > 30 | A few notable events per reflection. |
| D10 | Corrective triggers | loop >3× same {action,obs}; or run of `fail`; or >30 actions no-progress | Reflexion heuristics, 0 LLM. |
| D11 | Prune floor / age | importance < 3 **and** age > 30 d **and** never re-accessed | Forgetting; reflections always retained. |
| D12 | Capture scope | all tools (denylist configurable, default empty) | Honors "every tool call"; knob exists if volume bites. |
| D13 | Rating/NL model | **`claude-haiku-4-5`** (batched at flush) | Cheap, fast; batched once per page (§7). Behind an injected `llm` interface. |
| D14 | Embeddings | **Google `text-embedding-004`** | `@google/generative-ai` + key already in repo deps — no new dependency. Behind an injected `embedder` interface so it's swappable (Voyage/OpenAI) without touching flush logic. |

**Dependency-injection rule:** `flush/` and `reflect/` take `{ llm, embedder }` as parameters.
Core orchestration is tested with fakes; live adapters (D13/D14) are thin and swappable. No
model id is hardcoded in logic — only in the adapter.

---

## 0. The central tension (read this first)

The two binding constraints fight each other:

| Constraint | Consequence |
|---|---|
| Capture **every tool call** | High volume — hundreds of events per session. The capture path must be cheap and must never block the agent. |
| **LLM-rated** importance | An LLM call to score salience — but doing that *per event* is too slow and too expensive to sit in the capture path. |

**Resolution — split capture from cognition along a time axis:**

```
HOT PATH (synchronous, 0 LLM tokens)      COLD PATH (async, batched LLM)
─────────────────────────────────         ──────────────────────────────
PostToolUse hook fires                     Flush manager wakes
   → write raw event to working buffer        → 1 batched LLM call rates N events
   → return in <200ms                         → embed, write to episodic store
                                              → reflection job (threshold-triggered)
```

Importance stays **LLM-rated** (faithful to Generative Agents), but the rating happens
**at page-flush time over a batch of N events in a single call**, not once per event. This
is the design decision everything else depends on. Cost analysis is in §7.

---

## 1. Layer map

```
                         ┌─────────────────────────────────────────────┐
                         │  Claude (current interaction cycle)          │
                         └───────────────┬──────────────────┬──────────┘
                                  thought + tool call         │ recall query
                                         ▼                   ▼
   ┌─────────────────────────────────────────────┐   ┌──────────────────────────┐
   │ L0  CAPTURE  (PostToolUse + turn text,       │   │ L4  RETRIEVAL ENGINE     │
   │     internal/external/obs, <200ms, 0 LLM)    │   │  score = α·rec+β·imp+γ·rel│
   └───────────────┬─────────────────────────────┘   │  → {short,thematic,corr≤Ω}│
                   ▼                                  └──────────┬───────────────┘
   ┌─────────────────────────────────────────────┐              │ reads
   │ L1  WORKING BUFFER  (FIFO ring, K events)    │              │
   │     "the page" — newest trajectory only      │              │
   └───────────────┬─────────────────────────────┘              │
                   │ flush (buffer full OR session end)          │
                   ▼  ── batched LLM rating + embedding ──        │
   ┌─────────────────────────────────────────────┐              │
   │ L2  EPISODIC STREAM  (append-only, durable)  │◀─────────────┤
   │     date-indexed memory objects              │              │
   └───────────────┬─────────────────────────────┘              │
                   │ threshold: Σ importance > θ                 │
                   ▼                                             │
   ┌─────────────────────────────────────────────┐              │
   │ L3  REFLECTION TREES                         │◀─────────────┘
   │     insight nodes → pointers to evidence     │
   └─────────────────────────────────────────────┘
```

Each layer is its own module with a narrow interface. They share one SQLite file.

---

## 2. L0 — Capture (the hook)

**What is the unit of capture?** Per ReAct, the agent's action space is `Â = A ∪ L`:
**external actions** (tool calls — they hit the world and return an observation) and
**internal actions** (*thoughts* — reasoning traces in language space that produce no
observation). A faithful trajectory is the interleaving `… thoughtₜ, actionₜ, obsₜ …`.
**Capturing only tool calls discards every internal action** — and the reasoning trace is
the richest signal for later retrieval and for *corrective* reflection (§5). So L0 captures
both, tagged with an `act_type`.

**Mechanism — verified against the real Claude Code transcript format on this machine
(§2.1):**
- **External actions + observations** → the `PostToolUse` hook payload **already carries
  these directly** as `tool_input` and `tool_output`. The hot-path hook just appends them.
  0 LLM, no transcript read needed.
- **Internal actions (thoughts)** → the thought is the assistant's `text` block, which the
  PostToolUse event does **not** contain. It lives in the transcript at `transcript_path`,
  typically in a *separate* record from the `tool_use`. So thought-association is done in the
  **cold path** (at flush), by reading the transcript and walking the native record DAG —
  not in the hot hook. Still 0 LLM: we are *recording* reasoning that already happened.

This keeps the hot path trivially fast (append the external action and return) and moves the
slightly heavier transcript-walk to the async flush, which fits the §0 hot/cold split exactly.

**Hard rules** (per the harness's hook constraints):
- No network calls, no LLM calls. Target **<200ms**, always `exit 0` on error so a memory
  failure never blocks the agent.
- The hook only **appends a raw event** to the working buffer and returns.

**Event record** (raw, pre-cognition):

```jsonc
{
  "id": "evt_01H...",          // ULID — sortable by time
  "ts": "2026-06-17T15:06:33Z",
  "session_id": "sess_...",
  "act_type": "external",      // internal (thought) | external (tool) | observation
  "thought_kind": null,        // for internal: plan | extract | track | except | commonsense
  "tool_name": "Edit",         // null for internal actions
  "input_digest": "Edit cv.md: replace summary block (…)",   // truncated, no secrets
  "obs_digest": "ok, 1 replacement",                          // truncated tool result
  "status": "ok"              // ok | error | denied
}
```

`thought_kind` uses ReAct's observed taxonomy of useful thoughts (line 16083): **plan**
(decompose goal / create action plan), **extract** (pull key facts from an observation),
**track** (progress / re-plan), **except** (handle an error, adjust), **commonsense**
(inject world knowledge). It becomes a cheap retrieval filter ("show me where I re-planned").

**Digesting** keeps records bounded and is where **secret-scrubbing** happens (strip tokens,
keys, full file bodies) before anything is persisted. Digest = first/last N chars + length,
not the full payload.

### 2.1 Verified transcript format (empirical, this machine)

Inspected 102 real transcript JSONL files in
`~/.claude/projects/C--career-ops/`. Findings that the design now relies on:

- Every record carries `uuid`, `parentUuid`, `timestamp` (ISO), `sessionId`, `cwd`,
  `gitBranch`. The `parentUuid` chain is a DAG over the whole session.
- **Thought and action are usually separate records.** An assistant *text* block (the thought)
  and the `tool_use` block (the action) frequently arrive as two records linked by
  `parentUuid` — not one combined message. Triple reconstruction therefore walks the chain; it
  cannot assume one-record-per-step.
- **Observations carry a native back-pointer.** A tool result is a `user` record with
  `toolUseResult` **and `sourceToolAssistantUUID`** — an explicit pointer to the assistant
  record that produced the call, plus `tool_use_id` matching the action.
- The `PostToolUse` hook input is `{ tool_name, tool_input, tool_output, session_id,
  transcript_path, cwd }` (confirmed against the existing `governance-capture.js` hook).

**Consequence — we inherit linkage instead of inventing it.** The transcript's own
`uuid → parentUuid` chain and `sourceToolAssistantUUID` back-pointers *are* the
thought→action→observation graph. L0's `source_event_ids` should just store these transcript
UUIDs, so episodes and reflection evidence pointers trace straight back to ground-truth
records. This is the same hyperlink substrate §5 needs — for free.

---

## 3. L1 — Working buffer (paging)

A bounded **FIFO ring** of the last `K` events (default `K = 50`) — CoALA working memory,
the "page" of active context.

- Backed by a `working_buffer` table (durable across a crash) but conceptually a ring.
- **Flush triggers:** (a) buffer reaches `K`, or (b) session ends (`Stop` hook), or
  (c) idle timeout.
- On flush, the oldest page of events is handed to the cold path and **cleared** from the
  buffer. This is the "offload the oldest once the limit is reached" behavior.

The buffer is the only thing Claude's *immediate* cycle reads cheaply; everything older is
reached through retrieval (L4).

---

## 4. L2 — Episodic stream (date-indexed)

Append-only, durable. One **memory object** per meaningful event, carrying a natural-language
description plus the timestamps that make temporal reasoning ("what did I do last Tuesday?")
a simple indexed query.

```sql
CREATE TABLE episodes (
  id              TEXT PRIMARY KEY,        -- ULID
  created_at      TEXT NOT NULL,           -- ISO; indexed for date grouping
  last_accessed_at TEXT NOT NULL,          -- updated on every retrieval hit
  session_id      TEXT NOT NULL,
  act_type        TEXT NOT NULL,           -- internal | external | observation (CoALA/ReAct)
  thought_kind    TEXT,                    -- plan|extract|track|except|commonsense (if internal)
  text            TEXT NOT NULL,           -- NL description (LLM-written at flush)
  importance      REAL,                    -- 0..10, LLM-rated (nullable until rated)
  outcome         TEXT,                    -- success | fail | neutral (Reflexion Evaluator)
  embedding       BLOB,                    -- vector for relevance
  source_event_ids TEXT NOT NULL           -- JSON array → raw L0 events
);
CREATE INDEX idx_episodes_created ON episodes(created_at);
CREATE INDEX idx_episodes_importance ON episodes(importance);
CREATE INDEX idx_episodes_outcome ON episodes(outcome);
```

**`outcome` separates "what happened" from "how it went."** Reflexion's Evaluator (line 31920)
is a distinct signal from raw salience: a `fail` is highly *important* (you must learn from it)
even when it's a mundane action. So the flush rates importance **conditioned on outcome** —
failures and task-completions float to the top — and `outcome = fail` becomes the primary
fuel for corrective reflection (§5).

**Flush pipeline (cold path, async):**

1. Take the flushed page of raw events.
2. **One batched LLM call**: for the N events, return for each
   `{nl_description, importance_0_10, outcome}`. (NL description turns `Edit cv.md …` into
   "Rewrote the CV summary to emphasize coaching.")
3. **Embed** each description (small embedding model; batch the call).
4. Insert rows. Done. No agent-facing latency.

**Date grouping is free:** `WHERE created_at BETWEEN … AND …` — no special structure needed,
the timestamp *is* the index.

---

## 5. L3 — Reflection trees (wiki-style links)

Periodically compress raw episodes into higher-level insights that **point back to the exact
episodes that justify them**. Leaves = episodes; internal nodes = reflections; edges =
evidence pointers. Reading a summary and "clicking through" to the dated logs is just
traversing `evidence_ids`.

```sql
CREATE TABLE reflections (
  id           TEXT PRIMARY KEY,
  created_at   TEXT NOT NULL,
  kind         TEXT NOT NULL,           -- thematic (Gen Agents) | corrective (Reflexion)
  text         TEXT NOT NULL,           -- the synthesized insight or corrective lesson
  importance   REAL NOT NULL,           -- LLM-rated, like episodes
  embedding    BLOB,
  evidence_ids TEXT NOT NULL,           -- JSON: episode IDs AND/OR child reflection IDs
  depth        INTEGER NOT NULL DEFAULT 1   -- 1 = over raw episodes; >1 = over reflections
);
```

**Two reflection kinds — different triggers, different prompts:**

| Kind | Trigger | Cost | Output |
|---|---|---|---|
| **thematic** (Gen Agents) | `Σ importance > θ` since last reflection | LLM | "What patterns / insights emerge?" |
| **corrective** (Reflexion) | **cheap behavioral heuristic, 0 LLM**: same `{action, observation}` repeated >3× (loop), or a run of `outcome=fail`, or >30 actions with no progress (inefficiency) | LLM only once fired | "Action *a* caused the failure; *a′* would have been better. Next time, do X." |

The corrective path is the Reflexion contribution (lines 31991–31997): the *detection* that a
reflection is needed is a free heuristic over the buffer, so we don't pay an LLM to decide
*whether* to reflect — only to *produce* the lesson once a real failure/loop is detected.

**Reflection cycle (thematic):**
1. Pull the most recent / highest-importance episodes since last reflection.
2. LLM step 1 — "What are the 2–3 highest-level questions these raise?"
3. LLM step 2 — answer each, **citing the specific episode IDs used as evidence**.
4. Store each answer as a `thematic` reflection node with those IDs in `evidence_ids`.

**Reflection cycle (corrective):** feed the failing/looping trajectory slice + its `outcome`
signals; the LLM returns a **causal, prescriptive** lesson (not a summary), stored as a
`corrective` node citing the exact failing episodes. These are the highest-value memories to
surface when a *similar* task recurs — see the Ω cap in §6.

Because reflections can cite *other reflections*, depth grows naturally into a tree — the
non-leaf "wiki pages" summarizing dated, hyperlinked leaves.

Pointers are bidirectional in practice: an index over `evidence_ids` lets you go
reflection→episodes (drill down) and episode→reflections (what insights does this support?).

---

## 6. L4 — Tri-metric retrieval engine

Given the agent's current task, surface the smallest useful subset. **Pure math, 0 LLM tokens**
beyond embedding the query — this is the layer worth building first as a standalone,
unit-testable POC.

Candidates = episodes ∪ reflections. For each candidate:

| Metric | Definition |
|---|---|
| **Recency** | `exp(-λ · Δhours)` where `Δhours` is age from `last_accessed_at`. λ set from a half-life (e.g. 24h ⇒ λ ≈ 0.029). |
| **Importance** | stored `importance / 10`. |
| **Relevance** | `cosine(embed(query), embedding)`. |

Each metric is **min-max normalized to [0,1] across the candidate set**, then combined:

```
score = α·recency + β·importance + γ·relevance        (Gen Agents default: α=β=γ=1)
```

- Return **top-k**, then **trim to a token budget** so the result fits the context window.
- **Every returned memory gets `last_accessed_at = now`** — this is what keeps recently *used*
  memory hot (recency reflects access, not just creation), giving the FIFO-like "active page"
  effect at the long-term layer too.

α/β/γ and λ live in a config file so behavior is tunable without code changes.

**Composed recall, not a flat top-k (Reflexion).** The agent conditions on *both* short-term
and long-term memory (line 31947), so a recall returns a structured bundle, not one ranked list:

1. **Short-term** — the current working buffer (§1) verbatim, always included. This is the
   live trajectory; it is not subject to scoring.
2. **Long-term thematic** — tri-metric top-k over `episodes ∪ thematic reflections`.
3. **Long-term corrective** — `corrective` reflections matched by relevance to the current
   task, **hard-capped at the last Ω (default 1–3)**. Reflexion bounds injected reflections to
   `Ω≈1–3` (line 31972) precisely so the most recent, most relevant lessons don't get drowned
   out by stale ones. The cap is on the *corrective* slice specifically — a recurring failure
   should resurface its lesson first and loudly.

So the retrieval contract is `recall(task) → { short_term[], thematic_topk[], corrective[≤Ω] }`,
each independently budget-trimmed.

---

## 7. Cost & volume model

This is where the §0 resolution pays off.

| Operation | Frequency | LLM cost |
|---|---|---|
| Capture (L0 hook) | every tool call **and every thought** | **0** |
| Flush rating + NL + outcome (L2) | once per K events (≈1 per 50 calls) | 1 batched call |
| Embedding | per episode (batchable) | 1 small-model call (cheap) |
| Reflection trigger detection | every flush | **0** (heuristics over the buffer) |
| Thematic reflection (L3) | when `Σ imp > θ` (a few × / session) | 1–2 calls |
| Corrective reflection (L3) | only when a loop/failure heuristic fires | 1 call per real failure |
| Retrieval scoring (L4) | per recall | **0** (1 embed for the query) |

So "LLM-rated importance, every tool call" costs roughly **1 batched rating call per 50 tool
calls + occasional reflection** — not one call per call. Capturing thoughts adds **0** LLM
cost (we record reasoning that already happened), and deciding *whether* to reflect is also
**0** — we only pay to *produce* a lesson once a free heuristic confirms one is warranted.
Affordable and non-blocking.

---

## 8. Lifecycle / forgetting

Capturing every tool call grows unbounded, so forgetting is part of the design, not an
afterthought:

- **Episodes** with `importance < θ_keep`, older than `T`, and never re-accessed → archived
  (moved to a cold table) or deleted. This is the long-horizon generalization of "discard the
  oldest page."
- **Reflections are retained** — they are the compressed memory of what the pruned episodes
  meant.
- Pruning runs as a scheduled job (e.g. session-end or daily), logged to the audit trail.

---

## 9. Storage substrate

- **Single SQLite file.** Portable, no server, survives crashes, fits the volume with the
  indices above plus pruning.
- **Vectors:** start with `sqlite-vec` (or brute-force cosine in app code — fine up to
  ~10k–100k rows). No external vector DB until measured need.
- **Audit table** records every save / reflect / prune / delete with reason — debuggability and
  governance.

---

## 10. Module boundaries & build order

Build in this order; each is independently testable.

1. ✅ **`retrieval/`** — tri-metric scorer + composed recall (§6). 11 tests. **Done.**
2. ✅ **`store/`** — `node:sqlite` schema, `vec` codec, repository (L1/L2/L3 + audit/meta).
   6 tests incl. store→retrieval wiring. **Done.**
3. ✅ **`capture/`** — `buildEvent` + secret-scrub/digest + `appendAndMaybeFlush` (§2).
   11 tests incl. scrub coverage. **Done.** (Thin `PostToolUse`/`Stop` stdin wrappers still
   to add, but the testable core is complete.)
4. ✅ **`flush/`** — `flushPage` over injected `llm`/`embedder` (D13/D14): batched rate + NL +
   outcome + embed → episodes, advances the reflection accumulator. 5 tests; proves the full
   **L0→L2→L4** path with fakes. **Done** (live adapters deferred — see below).
5. ✅ **`reflect/`** — `detectCorrectiveTrigger` (pure heuristic) + `reflectThematic`
   (`Σ imp > θ`, resets accumulator) + `reflectCorrective` (loop/failure-run/inefficiency).
   7 tests. **Done.**
6. ⏳ **`recall/`** — the interface Claude queries (MCP tool or CLI) wrapping L4's composed
   bundle. **Next.**
7. **`prune/`** — forgetting job (§8).

**Live wiring deliberately deferred.** Everything above is proven with fakes and has spent
**zero API tokens**. The only outward-facing/cost step — the real D13/D14 adapters
(`claude-haiku-4-5` rating, Google `text-embedding-004`) — is isolated behind the injected
interfaces and will be wired last, after the cognition layers (reflect/recall/prune) are
complete and the model ids are confirmed against the claude-api reference.

---

## 11. Relationship to the existing `agentmemory` MCP

This environment already runs an `agentmemory` MCP server that overlaps L2–L4:
`memory_save` (episodic + `concepts`/`files` links), `memory_smart_search` (hybrid
semantic+keyword retrieval with progressive disclosure — i.e. drill-down), `memory_recall`,
`memory_sessions`, `memory_audit`, `memory_export`.

**Decision point (not yet made — flagged for review):** `agentmemory` operates at
*conversation/session* granularity. This design's distinctive layer is **L0/L1 — per-tool-call
capture and paging**, which `agentmemory` does not appear to do. Two viable paths:

- **(A) Backing store reuse** — keep L0/L1 here, but flush L2 episodes *into* `agentmemory`
  via `memory_save` and retrieve via `memory_smart_search`. Avoids duplicating storage and
  retrieval. Loses fine control over the exact `recency·importance·relevance` weights.
- **(B) Standalone** — own SQLite store as specified above; treat `agentmemory` as a separate,
  higher-altitude memory. Full control, some duplication.

**Do not double-store.** Resolve A-vs-B before building L2.

---

## 12. Open questions for sign-off

1. **`K` (page size)** and **flush triggers** — 50 events / session-end / idle. Acceptable?
2. **θ (thematic threshold)**, **Ω (corrective cap, 1–3)**, **θ_keep (prune floor)**, and the
   corrective heuristics (loop count >3, action ceiling 30) — need values; suggest tuning
   against a recorded session rather than guessing.
3. **agentmemory: path A or path B** (§11). This blocks the L2 build.
4. **Recall surface** — expose to Claude as an MCP tool, a CLI, or auto-injected context at
   session start? Note recall now returns a *composed bundle* (§6), not a flat list — the
   surface must represent the short-term / thematic / corrective split.
5. **Scope of "every tool call"** — literally all tools (incl. every `Read`/`Grep`), or
   exclude a denylist of high-noise read tools to cut volume before it reaches the buffer?
6. ~~**Thought capture fidelity**~~ — **RESOLVED (§2.1).** Verified against 102 real
   transcripts: ReAct-faithful capture is fully achievable. External action + observation come
   straight from the `PostToolUse` payload; the thought is recovered in the cold path from
   `transcript_path` via the native `parentUuid` / `sourceToolAssistantUUID` DAG. No degraded
   external-only fallback needed. Bonus: that same DAG gives us evidence-pointer linkage for
   free, so this no longer blocks anything.

---

## Appendix — provenance of each idea

| This doc | CoALA | Generative Agents | ReAct | Reflexion |
|---|---|---|---|---|
| L0 internal/external/observation capture | internal vs external actions | — | `Â = A ∪ L`, thought taxonomy | — |
| L1 working buffer (paging) | working memory | — | trajectory = context `cₜ` | short-term memory |
| L2 episodic stream + timestamps | episodic memory | memory stream, recency timestamps | — | — |
| L2 `outcome` informs importance | — | — | — | Evaluator / reward |
| L3 thematic reflection trees | semantic memory | reflection + evidence pointers | — | — |
| L3 corrective reflections + cheap triggers | — | — | — | self-reflection, loop/inefficiency heuristics |
| L4 recency·importance·relevance | retrieval | retrieval function | — | — |
| L4 composed recall + Ω cap | — | — | — | short+long-term conditioning, `Ω≈1–3` |
| decide→act→observe loop | agent decision loop | — | reason↔act synergy | trial→reflect→retry |
