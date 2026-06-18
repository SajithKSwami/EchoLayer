#!/usr/bin/env node
// EchoLayer Stop hook (cold path). At session end, drains the working buffer into rated,
// embedded episodes using the live rater + embedder (or fakes when no keys). Best-effort:
// always exits 0. May take a few seconds for a large buffer (rating + embedding API calls).

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
try {
  process.loadEnvFile(join(ROOT, '.env'));
} catch {
  /* no .env — rely on ambient environment */
}
const DB_PATH = process.env.ECHOLAYER_DB || join(ROOT, 'echolayer.db');

const { openStore } = await import('../store/repo.mjs');
const { flushPage } = await import('../flush/flush.mjs');
const { reflectThematic, reflectCorrective } = await import('../reflect/reflect.mjs');
const { getRater } = await import('../llm/index.mjs');
const { getEmbedder } = await import('../embedders/index.mjs');

process.stdin.resume(); // drain the Stop payload; we don't need its contents
process.stdin.on('data', () => {});

try {
  const repo = openStore(DB_PATH);
  const { llm, provider } = getRater();
  const { embedder, live } = getEmbedder();
  let total = 0;
  let res;
  do {
    res = await flushPage(repo, { llm, embedder });
    total += res.flushed;
  } while (res.flushed > 0);

  // Reflection (self-gating): corrective fires on a loop/failure-run/inefficiency heuristic;
  // thematic fires only when Σ importance since last reflection crossed θ.
  const corrective = await reflectCorrective(repo, { llm, embedder });
  const thematic = await reflectThematic(repo, { llm, embedder });

  repo.close();
  process.stderr.write(
    `[echolayer-flush] flushed ${total} (rater: ${provider}, embedder: ${live ? 'live' : 'fake'}); ` +
      `reflect thematic=${thematic.ran ?? false} corrective=${corrective.ran ?? false}\n`,
  );
} catch (e) {
  process.stderr.write(`[echolayer-flush] ${e?.stack ?? e}\n`);
}
process.exit(0);
