// EchoLayer MCP server (stdio) — exposes the recall surface to Claude Code and other MCP
// clients. Wraps the tested core; adds no new logic. Currently uses the local keyword fake
// embedder (live embeddings are deferred), so relevance is approximate until D14 is wired.
//
// Protocol rule: stdout is the JSON-RPC channel — all logging goes to stderr.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { openStore } from '../store/repo.mjs';
import { recall } from '../recall/recall.mjs';
import { keywordEmbed } from '../recall/fake-embedder.mjs';
import { getEmbedder } from '../embedders/index.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DB_PATH = process.env.ECHOLAYER_DB || join(ROOT, 'echolayer.db');

// Load a repo-local .env (Node built-in; no dotenv dependency). Ignore if absent.
try {
  process.loadEnvFile(join(ROOT, '.env'));
} catch {
  /* no .env file — rely on the ambient environment */
}

function seedIfEmpty(repo) {
  if (repo.db.prepare('SELECT COUNT(*) AS n FROM episodes').get().n > 0) return;
  const ts = new Date().toISOString();
  const ep = (text, importance, outcome) =>
    repo.insertEpisode({
      session_id: 'seed', act_type: 'external', text, importance, outcome,
      embedding: keywordEmbed(text), created_at: ts, last_accessed_at: ts, source_event_ids: [],
    });
  ep('rewrote cv summary to emphasize coaching impact', 6, 'success');
  ep('ran the build, all tests green', 4, 'success');
  ep('deploy failed with a connection error', 9, 'fail');
  repo.insertReflection({
    kind: 'corrective', text: 'edit on cv.md failed repeatedly — read the file before editing',
    importance: 9, embedding: keywordEmbed('edit cv read file'),
    created_at: ts, last_accessed_at: ts, evidence_ids: [],
  });
  repo.audit('seed', 'demo memories (MCP first run)');
}

export function buildServer(repo, deps) {
  const server = new McpServer({ name: 'echolayer-mcp-server', version: '0.1.0' });

  server.registerTool(
    'echolayer_recall',
    {
      title: 'Recall memories',
      description:
        'Query EchoLayer long-term memory for the current task. Returns a composed bundle: ' +
        'short_term (live buffer), thematic (relevant episodes/insights), and corrective ' +
        '(failure lessons, capped). Uses Google gemini-embedding-001 for semantic relevance ' +
        'when a key is configured, else falls back to a local keyword approximation.',
      inputSchema: {
        query: z.string().min(1).describe('The current task or question to retrieve memories for'),
        k: z.number().int().positive().optional().describe('Max thematic results (default 8)'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ query, k }) => {
      const bundle = await recall(repo, deps, query, k ? { retrieval: { k } } : {});
      const shape = {
        query,
        short_term: bundle.short_term.map((e) => ({ tool: e.tool_name ?? e.act_type, obs: e.obs_digest ?? '' })),
        thematic: bundle.thematic_topk.map((c) => ({ id: c.id, text: c.text, score: round(c._score) })),
        corrective: bundle.corrective.map((c) => ({ id: c.id, text: c.text, score: round(c._score) })),
      };
      const lines = [`Recall for: "${query}"`];
      lines.push(shape.thematic.length ? '\nThematic:' : '\n(no thematic matches)');
      shape.thematic.forEach((t) => lines.push(`  [${t.score}] ${t.text}`));
      if (shape.corrective.length) {
        lines.push('\nCorrective lessons:');
        shape.corrective.forEach((c) => lines.push(`  [${c.score}] ${c.text}`));
      }
      return { content: [{ type: 'text', text: lines.join('\n') }], structuredContent: shape };
    },
  );

  server.registerTool(
    'echolayer_remember',
    {
      title: 'Store a memory',
      description:
        'Add a memory to EchoLayer. Stores an episode by default, or a reflection if kind is ' +
        "'thematic' or 'corrective'.",
      inputSchema: {
        text: z.string().min(1).describe('Natural-language description of the memory'),
        importance: z.number().min(0).max(10).optional().describe('0-10 salience (default 5)'),
        outcome: z.enum(['success', 'fail', 'neutral']).optional().describe('Episode outcome (default neutral)'),
        kind: z.enum(['episode', 'thematic', 'corrective']).optional().describe('Memory kind (default episode)'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ text, importance = 5, outcome = 'neutral', kind = 'episode' }) => {
      const [embedding] = await deps.embedder.embedBatch([text]);
      const id =
        kind === 'episode'
          ? repo.insertEpisode({ session_id: 'mcp', act_type: 'external', text, importance, outcome, embedding, source_event_ids: [] })
          : repo.insertReflection({ kind, text, importance, embedding, evidence_ids: [] });
      return { content: [{ type: 'text', text: `Stored ${kind} ${id}` }], structuredContent: { id, kind } };
    },
  );

  server.registerTool(
    'echolayer_stats',
    {
      title: 'Memory stats',
      description: 'Counts of stored episodes, reflections, and unflushed buffered events.',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      const stats = {
        episodes: repo.db.prepare('SELECT COUNT(*) AS n FROM episodes').get().n,
        reflections: repo.db.prepare('SELECT COUNT(*) AS n FROM reflections').get().n,
        buffered: repo.db.prepare('SELECT COUNT(*) AS n FROM working_buffer WHERE flushed = 0').get().n,
      };
      return { content: [{ type: 'text', text: JSON.stringify(stats) }], structuredContent: stats };
    },
  );

  return server;
}

function round(n) {
  return Number((n ?? 0).toFixed(3));
}

async function main() {
  const repo = openStore(DB_PATH);
  const { embedder, live, why } = getEmbedder();
  // Only seed demo data in fake mode — live mode starts clean (avoids spend + dim mismatch).
  if (!live) seedIfEmpty(repo);
  const server = buildServer(repo, { embedder });
  await server.connect(new StdioServerTransport());
  process.stderr.write(
    `echolayer-mcp-server ready (db: ${DB_PATH}; embedder: ${live ? 'google gemini-embedding-001' : 'fake keyword'} — ${why})\n`,
  );
}

main().catch((e) => {
  process.stderr.write(`echolayer-mcp-server fatal: ${e?.stack ?? e}\n`);
  process.exit(1);
});
