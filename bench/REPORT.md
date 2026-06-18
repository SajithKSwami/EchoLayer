# EchoLayer Retrieval Benchmark

- Corpus: 24 episodes across 4 sessions · 10 labeled queries
- Context budget (recent-K and echolayer): K = 8
- Embedder: **google gemini-embedding-001 (live)**
- Token estimate: chars / 4 (ratios only)

| Strategy | Mean tokens / query | Relevant memory in context |
|---|---:|---:|
| Dump all history | 399 | 100% |
| Dump recent 8 | 131 | 40% |
| **EchoLayer recall (K=8)** | **138** | **100%** |

## Headline

- vs **dump-all**: EchoLayer reached **100%** hit-rate using **65% fewer tokens** (138 vs 399).
- vs **dump-recent-8** (same token budget): **100%** vs **40%** hit-rate — recency-only is blind to older memories.

## Per-query (relevant memory retrieved?)

| Query | dump-all | recent-8 | EchoLayer |
|---|:--:|:--:|:--:|
| how did we handle user authentication and sign-in? | ✓ | ✗ | ✓ |
| where are the auth secrets stored? | ✓ | ✗ | ✓ |
| what caused the database performance problem and how was it fixed? | ✓ | ✗ | ✓ |
| how did we set up the ORM and run migrations? | ✓ | ✗ | ✓ |
| how did we fix the optimistic UI flicker on failed requests? | ✓ | ✗ | ✓ |
| the production deployment failure | ✓ | ✓ | ✓ |
| CORS errors calling the API in production | ✓ | ✓ | ✓ |
| how do we run tests automatically on pull requests? | ✓ | ✓ | ✓ |
| speeding up the application queries in the database | ✓ | ✗ | ✓ |
| preventing spam on the apply endpoint | ✓ | ✓ | ✓ |

## Honest limitations

- Measures **retrieval efficiency** on a synthetic (but realistic) corpus — not end-to-end agent token spend in a live loop. That requires a separate A/B with real sessions.
- Token counts are a chars/4 estimate; treat the **ratios**, not the absolute numbers, as the result.
- "Hit" = at least one ground-truth episode present in the injected context.
