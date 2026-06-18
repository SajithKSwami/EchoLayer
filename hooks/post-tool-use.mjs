#!/usr/bin/env node
// EchoLayer PostToolUse hook (L0 capture). Reads the hook payload on stdin, scrubs + digests
// it, and appends one event to the working buffer. Hot path: no LLM, no network. Always exits 0
// so a memory failure never blocks the tool. Filtering by tool is done by the settings matcher.

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStore } from '../store/repo.mjs';
import { appendAndMaybeFlush } from '../capture/capture.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DB_PATH = process.env.ECHOLAYER_DB || join(ROOT, 'echolayer.db');

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { raw += c; });
process.stdin.on('end', () => {
  try {
    const payload = JSON.parse(raw || '{}');
    const repo = openStore(DB_PATH);
    appendAndMaybeFlush(repo, payload); // append only — flush happens at Stop
    repo.close();
  } catch (e) {
    process.stderr.write(`[echolayer-capture] ${e?.message ?? e}\n`);
  }
  process.exit(0);
});
