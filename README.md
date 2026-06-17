# EchoLayer

Long-term memory for Claude agents. EchoLayer captures **every tool call**, pages it through a
bounded working buffer, persists a date-indexed **episodic stream**, synthesizes **reflection
trees** that link back to their evidence, and serves it all back through a **tri-metric
retrieval engine** (recency · importance · relevance).

It is a synthesis of four works:

- **CoALA** — working/episodic/semantic memory split; internal vs. external actions.
- **Generative Agents** — the memory stream, reflection, and `recency · importance · relevance`.
- **ReAct** — the unit of activity is a `{thought, action, observation}` trajectory.
- **Reflexion** — short-term trajectory vs. long-term *corrective* reflections, bounded to Ω.

> Full design and decisions log: **[ARCHITECTURE.md](ARCHITECTURE.md)**

## Status

Building. **4 of 7 layers** implemented and tested — 33 tests, **zero dependencies**, zero API
cost so far (cognition is exercised with injected fakes).

| Layer | Module | Responsibility |
|-------|--------|----------------|
| L4 | `retrieval/` | tri-metric scorer + composed `{short_term, thematic, corrective≤Ω}` recall |
| L1–L3 | `store/` | `node:sqlite` schema, Float32 vector codec, repository |
| L0 | `capture/` | event build + **secret-scrub** + flush-trigger |
| L1→L2 | `flush/` | batched rate + embed → episodes (injected `llm`/`embedder`) |

Remaining: `reflect/`, `recall/` (the MCP/CLI surface), `prune/`, and the live model adapters.

## Requirements

Node **≥ 22.5** — uses the built-in `node:sqlite`. No external dependencies.

## Test

```sh
node --test
```

## License

MIT
