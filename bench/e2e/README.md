# EchoLayer End-to-End A/B

The retrieval benchmark ([../README.md](../README.md)) measures *retrieval efficiency* in
isolation. This one measures the thing people actually want to know: **does giving a real Claude
session its recalled memory make it spend fewer tokens?**

## How it works

For each scenario, the agent gets a small workspace and a task that depends on a **non-obvious
past decision** (e.g. "this project puts pgbouncer in front of Postgres"). We run it twice through
real headless Claude (`claude -p --output-format json`):

- **Cold** — task only. The agent must explore the workspace to recover the decision.
- **EchoLayer** — the recalled memory is prepended to the task. The agent already knows.

We parse `usage` + `total_cost_usd` + `num_turns` from each run and report the **delta**.

> **Why delta, not absolute?** Every `claude -p` run pays a fixed ~55K-token overhead for the
> Claude Code system prompt + tools (identical in both conditions). The delta cancels it and
> isolates the memory effect. Fewer **turns** is the cleanest signal — it means the agent didn't
> have to explore.

## Run it

```sh
node bench/e2e/run.mjs --dry-run          # verify wiring, $0
node bench/e2e/run.mjs --trials=3         # REAL runs — spends Claude usage
node bench/e2e/run.mjs --scenario=production-api-cors --trials=5
```

**⚠️ Real runs cost real money.** Each `claude -p` call is ~$0.2+. A 2-scenario × 3-trial run is
~12 calls. Start small. Writes `bench/e2e/REPORT.md`.

## What it does NOT claim

- **Non-deterministic.** Agent runs vary; use ≥3 trials and read the *trend*, not one number.
- **Scenarios are starter examples.** The size of the effect depends entirely on how much the
  cold agent would have to explore. Swap in your own projects in `scenarios.mjs` to test your
  reality — that's the number worth publishing.
- The harness **prepends** the recall bundle to isolate "having the memory." In production the
  `echolayer_recall` MCP tool provides this on demand instead — same memory, different delivery.

This is the instrument. The headline number is whatever *you* measure with it on real work.
