#!/usr/bin/env node
// Runnable recall demo on fakes — proves the L0→L4 path without any live API.
//   node recall/cli.mjs "cv summary"
//   node recall/cli.mjs "deploy error"
//
// Seeds an in-memory store with a handful of episodes + a corrective reflection, then runs a
// recall and pretty-prints the composed { short_term, thematic_topk, corrective } bundle.

import { openStore } from '../store/repo.mjs';
import { recall } from './recall.mjs';
import { keywordEmbedder, keywordEmbed } from './fake-embedder.mjs';

const query = process.argv.slice(2).join(' ') || 'cv summary';
const ts = new Date().toISOString();
const repo = openStore(':memory:');

const ep = (text, importance, outcome) =>
  repo.insertEpisode({
    session_id: 'demo', act_type: 'external', text, importance, outcome,
    embedding: keywordEmbed(text), created_at: ts, last_accessed_at: ts, source_event_ids: [],
  });

ep('rewrote cv summary to emphasize coaching impact', 6, 'success');
ep('ran the build, all tests green', 4, 'success');
ep('grep cv.md for quantified metrics', 3, 'success');
ep('deploy failed with a connection error', 9, 'fail');
repo.insertReflection({
  kind: 'corrective', text: 'edit on cv.md failed repeatedly — read the file before editing',
  importance: 9, embedding: keywordEmbed('edit cv read file'), created_at: ts, last_accessed_at: ts,
  evidence_ids: [],
});
// a live, unflushed event → short_term
repo.appendEvent({ session_id: 'demo', act_type: 'external', tool_name: 'Grep', obs_digest: '3 matches in cv.md' });

const bundle = await recall(repo, { embedder: keywordEmbedder }, query);

const pct = (n) => (n ?? 0).toFixed(2);
console.log(`\n  query: "${query}"\n`);
console.log('  short_term (live buffer):');
for (const e of bundle.short_term) console.log(`    · ${e.tool_name ?? e.act_type}: ${e.obs_digest ?? ''}`);
console.log('\n  thematic_topk (episodes ∪ thematic reflections):');
for (const c of bundle.thematic_topk) console.log(`    [${pct(c._score)}] ${c.text}`);
console.log('\n  corrective (≤Ω, failure lessons first):');
for (const c of bundle.corrective) console.log(`    [${pct(c._score)}] ${c.text}`);
console.log('');

repo.close();
