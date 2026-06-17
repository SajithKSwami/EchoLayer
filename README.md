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

**All 7 layers implemented and tested** — 50 tests, **zero dependencies**, zero API cost
(cognition is exercised with injected fakes).

| Layer | Module | Responsibility |
|-------|--------|----------------|
| L0 | `capture/` | event build + **secret-scrub** + flush-trigger |
| L1→L2 | `flush/` | batched rate + embed → episodes (injected `llm`/`embedder`) |
| L1–L3 | `store/` | `node:sqlite` schema, Float32 vector codec, repository |
| L3 | `reflect/` | thematic (Σ-importance) + corrective (loop/failure) reflections |
| L4 | `retrieval/` | tri-metric scorer + composed `{short_term, thematic, corrective≤Ω}` recall |
| L4 | `recall/` | query surface: embed → retrieve → bump last-accessed (CLI demo included) |
| — | `prune/` | forgetting: drop cold episodes, always keep reflections |

Try it: `node recall/cli.mjs "deploy error"`

Remaining: live model adapters (`claude-haiku-4-5` + Google `text-embedding-004`) and the
`PostToolUse`/`Stop` capture hooks. The **MCP server is built** (see below).

## Use in Claude Code

EchoLayer ships an MCP server (`mcp/server.mjs`) exposing three tools: `echolayer_recall`,
`echolayer_remember`, `echolayer_stats`. On first run it seeds a few demo memories so recall
returns something immediately. (It currently uses a local keyword fake embedder; swap in the
live embedder later without touching the server.)

```sh
npm install            # one-time: installs the MCP SDK
```

Register it (user scope, available in every session):

```sh
claude mcp add echolayer --scope user -- node C:\EchoLayer\mcp\server.mjs
```

Or add it manually to your MCP config:

```json
{
  "mcpServers": {
    "echolayer": { "command": "node", "args": ["C:\\EchoLayer\\mcp\\server.mjs"] }
  }
}
```

The DB defaults to `echolayer.db` in the repo; override with the `ECHOLAYER_DB` env var.

## Requirements

Node **≥ 22.5** — uses the built-in `node:sqlite`. No external dependencies.

## Test

```sh
node --test
```

## License

MIT
