// EchoLayer retrieval benchmark. Compares three ways an agent could feed past context into a
// new session, at an equal context budget:
//   - full:      dump ALL past episodes (max recall, max tokens)
//   - recent-K:  dump the last K episodes (cheap, but blind to older memories)
//   - echolayer: tri-metric recall top-K (targeted)
// Metric per query: did the relevant memory make it into the context (hit), and at what token cost.
//
// Run:  node bench/run.mjs        (uses live embedder if a key is set, else the keyword fake)

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
try { process.loadEnvFile(join(ROOT, '.env')); } catch { /* fake embedder fallback */ }

const { openStore } = await import('../store/repo.mjs');
const { recall } = await import('../recall/recall.mjs');
const { getEmbedder } = await import('../embedders/index.mjs');
const { tokensOfItems } = await import('./tokens.mjs');
const { EPISODES, QUERIES } = await import('./fixtures.mjs');

const K = 8; // equal context budget for recent-K and echolayer

const { embedder, live } = getEmbedder();
const repo = openStore(':memory:');

// Insert episodes with increasing timestamps (session 1 oldest) and real embeddings.
const base = Date.parse('2026-06-01T00:00:00Z');
const vectors = await embedder.embedBatch(EPISODES.map((e) => e.text));
EPISODES.forEach((e, i) => {
  const ts = new Date(base + i * 3_600_000).toISOString();
  repo.insertEpisode({
    id: e.id, session_id: 's', act_type: 'external', text: e.text,
    importance: e.importance, outcome: e.outcome, embedding: vectors[i],
    created_at: ts, last_accessed_at: ts, source_event_ids: [],
  });
});

const now = new Date(base + EPISODES.length * 3_600_000 + 3_600_000);
const all = repo.recentEpisodes(1000);       // all, DESC by created_at
const recent = all.slice(0, K);              // last K
const hit = (items, relevant) => items.some((x) => relevant.includes(x.id));

const agg = { full: { hits: 0, tok: 0 }, recent: { hits: 0, tok: 0 }, echo: { hits: 0, tok: 0 } };
const rows = [];
for (const Q of QUERIES) {
  const bundle = await recall(repo, { embedder }, Q.q, { retrieval: { k: K }, touch: false, now });
  const echo = bundle.thematic_topk;

  const fHit = hit(all, Q.relevant);
  const rHit = hit(recent, Q.relevant);
  const eHit = hit(echo, Q.relevant);
  agg.full.hits += fHit; agg.recent.hits += rHit; agg.echo.hits += eHit;
  agg.full.tok += tokensOfItems(all); agg.recent.tok += tokensOfItems(recent); agg.echo.tok += tokensOfItems(echo);
  rows.push({ q: Q.q, full: fHit, recent: rHit, echo: eHit });
}

const N = QUERIES.length;
const pct = (n, d) => `${Math.round((n / d) * 100)}%`;
const mean = (x) => Math.round(x / N);
const tokFull = mean(agg.full.tok), tokRecent = mean(agg.recent.tok), tokEcho = mean(agg.echo.tok);
const reductionVsFull = Math.round((1 - tokEcho / tokFull) * 100);

const lines = [];
lines.push('# EchoLayer Retrieval Benchmark');
lines.push('');
lines.push(`- Corpus: ${EPISODES.length} episodes across 4 sessions · ${N} labeled queries`);
lines.push(`- Context budget (recent-K and echolayer): K = ${K}`);
lines.push(`- Embedder: **${live ? 'google gemini-embedding-001 (live)' : 'keyword fake (offline)'}**`);
lines.push(`- Token estimate: chars / 4 (ratios only)`);
lines.push('');
lines.push('| Strategy | Mean tokens / query | Relevant memory in context |');
lines.push('|---|---:|---:|');
lines.push(`| Dump all history | ${tokFull} | ${pct(agg.full.hits, N)} |`);
lines.push(`| Dump recent ${K} | ${tokRecent} | ${pct(agg.recent.hits, N)} |`);
lines.push(`| **EchoLayer recall (K=${K})** | **${tokEcho}** | **${pct(agg.echo.hits, N)}** |`);
lines.push('');
lines.push('## Headline');
lines.push('');
lines.push(`- vs **dump-all**: EchoLayer reached **${pct(agg.echo.hits, N)}** hit-rate using **${reductionVsFull}% fewer tokens** (${tokEcho} vs ${tokFull}).`);
lines.push(`- vs **dump-recent-${K}** (same token budget): **${pct(agg.echo.hits, N)}** vs **${pct(agg.recent.hits, N)}** hit-rate — recency-only is blind to older memories.`);
lines.push('');
lines.push('## Per-query (relevant memory retrieved?)');
lines.push('');
lines.push('| Query | dump-all | recent-' + K + ' | EchoLayer |');
lines.push('|---|:--:|:--:|:--:|');
for (const r of rows) lines.push(`| ${r.q} | ${r.full ? '✓' : '✗'} | ${r.recent ? '✓' : '✗'} | ${r.echo ? '✓' : '✗'} |`);
lines.push('');
lines.push('## Honest limitations');
lines.push('');
lines.push('- Measures **retrieval efficiency** on a synthetic (but realistic) corpus — not end-to-end agent token spend in a live loop. That requires a separate A/B with real sessions.');
lines.push('- Token counts are a chars/4 estimate; treat the **ratios**, not the absolute numbers, as the result.');
lines.push('- "Hit" = at least one ground-truth episode present in the injected context.');

const report = lines.join('\n') + '\n';
writeFileSync(join(ROOT, 'bench', 'REPORT.md'), report);
repo.close();

console.log(report);
console.error(`[bench] embedder=${live ? 'live' : 'fake'} · echo ${pct(agg.echo.hits, N)} hit @ ${tokEcho} tok · full ${tokFull} tok · recent ${pct(agg.recent.hits, N)} hit`);
