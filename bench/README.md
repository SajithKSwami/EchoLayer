# EchoLayer Benchmark

A reproducible test of the one thing EchoLayer claims: **it delivers the *relevant* past context
to a new session in far fewer tokens than the naive alternatives.**

## What it measures

When an agent starts a fresh session, it has three ways to recover past context:

| Strategy | What it does | Failure mode |
|---|---|---|
| **Dump all history** | Paste every past episode into context | Accurate but expensive — token cost grows without bound |
| **Dump recent K** | Paste the last K episodes | Cheap, but blind to anything older than K |
| **EchoLayer recall** | Tri-metric (recency · importance · relevance) top-K | — |

For each labeled query we measure: **(1)** did at least one ground-truth episode end up in the
injected context (*hit*), and **(2)** how many tokens that context cost.

## Run it

```sh
node bench/run.mjs
```

Uses the live Google embedder when `GOOGLE_API_KEY` is set (the real test), otherwise the
offline keyword fake (lower quality, but reproducible with no key). Writes `bench/REPORT.md`.

## Latest result

See [`REPORT.md`](REPORT.md). Headline (live `gemini-embedding-001`, 24-episode corpus, K=8):

- **100% hit-rate at 65% fewer tokens** than dumping all history.
- **100% vs 40% hit-rate** against recency-only at the *same* token budget.

## What it does NOT measure (read this)

- It measures **retrieval efficiency**, not end-to-end agent token spend in a live loop. A
  real A/B (same tasks, real Claude Code sessions, with/without EchoLayer) is a separate, harder
  experiment — this benchmark is the controlled lower bound, not the whole story.
- Tokens are a `chars/4` estimate — the **ratios** are the result, not the absolute counts.
- The corpus is synthetic (but modeled on a real multi-session project). Swap in your own
  episodes + labeled queries in `fixtures.mjs` to test against your data.
