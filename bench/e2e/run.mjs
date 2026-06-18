// End-to-end A/B harness: runs each scenario through real headless Claude (`claude -p`) twice —
// COLD (task only) vs ECHOLAYER (recall context prepended) — and reports the token/cost/turns
// delta. The fixed Claude Code overhead cancels in the delta.
//
//   node bench/e2e/run.mjs --dry-run            # verify wiring, no cost
//   node bench/e2e/run.mjs --trials=3           # real runs (spends Claude usage!)
//   node bench/e2e/run.mjs --scenario=production-api-cors
//
// WARNING: real runs cost real Claude usage (~$0.2+ per run, 2 conditions × trials × scenarios).

import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, dirname as pdir } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
try { process.loadEnvFile(join(ROOT, '.env')); } catch { /* fake embedder fallback */ }

const { openStore } = await import('../../store/repo.mjs');
const { recall } = await import('../../recall/recall.mjs');
const { getEmbedder } = await import('../../embedders/index.mjs');
const { parseUsage, compare } = await import('./usage.mjs');
const { SCENARIOS } = await import('./scenarios.mjs');

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const trials = Number((argv.find((a) => a.startsWith('--trials=')) ?? '').split('=')[1]) || 1;
const only = (argv.find((a) => a.startsWith('--scenario=')) ?? '').split('=')[1];
const CLAUDE = process.env.CLAUDE_BIN || 'claude';

async function recallContext(memory, query) {
  const { embedder } = getEmbedder();
  const repo = openStore(':memory:');
  const vecs = await embedder.embedBatch(memory.map((m) => m.text));
  memory.forEach((m, i) => repo.insertEpisode({
    id: m.id, session_id: 's', act_type: 'external', text: m.text,
    importance: m.importance, outcome: m.outcome, embedding: vecs[i], source_event_ids: [],
  }));
  const b = await recall(repo, { embedder }, query, { retrieval: { k: 6 }, touch: false });
  repo.close();
  const items = [...b.thematic_topk, ...b.corrective];
  return 'Relevant memory from earlier sessions (recalled by EchoLayer):\n' + items.map((i) => `- ${i.text}`).join('\n');
}

function makeWorkspace(files) {
  const dir = mkdtempSync(join(tmpdir(), 'echolayer-e2e-'));
  for (const [rel, content] of Object.entries(files ?? {})) {
    const p = join(dir, rel);
    mkdirSync(pdir(p), { recursive: true });
    writeFileSync(p, content);
  }
  return dir;
}

function runClaude(prompt, cwd) {
  if (dryRun) {
    return Promise.resolve({
      total_cost_usd: 0.21, num_turns: 1, is_error: false, result: '(dry-run)',
      usage: { input_tokens: 2, output_tokens: 4, cache_creation_input_tokens: 54870, cache_read_input_tokens: 15132 },
    });
  }
  return new Promise((resolve, reject) => {
    const cp = spawn(CLAUDE, ['-p', '--output-format', 'json'], { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    cp.stdout.on('data', (d) => { out += d; });
    cp.stderr.on('data', (d) => { err += d; });
    cp.on('close', () => {
      try { resolve(JSON.parse(out)); }
      catch { reject(new Error(`claude -p did not return JSON. stderr: ${err.slice(0, 300)}`)); }
    });
    cp.stdin.write(prompt);
    cp.stdin.end();
  });
}

const scenarios = SCENARIOS.filter((s) => !only || s.name === only);
const report = ['# EchoLayer End-to-End A/B', '', `- mode: ${dryRun ? 'DRY-RUN (no cost, wiring check)' : 'LIVE'} · trials/condition: ${trials}`, ''];
report.push('| Scenario | Metric | Cold | EchoLayer | Δ |');
report.push('|---|---|--:|--:|--:|');

for (const sc of scenarios) {
  const ctx = await recallContext(sc.memory, sc.query);
  const cold = [], echo = [];
  for (let t = 0; t < trials; t++) {
    const wc = makeWorkspace(sc.files);
    cold.push(parseUsage(await runClaude(sc.task, wc)));
    rmSync(wc, { recursive: true, force: true });
    const we = makeWorkspace(sc.files);
    echo.push(parseUsage(await runClaude(`${ctx}\n\n${sc.task}`, we)));
    rmSync(we, { recursive: true, force: true });
    process.stderr.write(`[e2e] ${sc.name} trial ${t + 1}/${trials} done\n`);
  }
  const cmp = compare(cold, echo);
  report.push(`| ${sc.name} | cost (USD) | ${cmp.costUSD.cold.toFixed(3)} | ${cmp.costUSD.echolayer.toFixed(3)} | ${cmp.costUSD.deltaPct}% |`);
  report.push(`| | turns | ${cmp.numTurns.cold.toFixed(1)} | ${cmp.numTurns.echolayer.toFixed(1)} | ${cmp.numTurns.deltaPct}% |`);
  report.push(`| | output tokens | ${Math.round(cmp.outputTokens.cold)} | ${Math.round(cmp.outputTokens.echolayer)} | ${cmp.outputTokens.deltaPct}% |`);
}

report.push('', '> Δ is the cold→echolayer reduction. Positive = EchoLayer cheaper/fewer.');
report.push('> Real runs are non-deterministic — use ≥3 trials and read the trend, not one number.');
const text = report.join('\n') + '\n';
writeFileSync(join(ROOT, 'bench', 'e2e', 'REPORT.md'), text);
console.log(text);
