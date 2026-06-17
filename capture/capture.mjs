// L0 capture orchestration (§2). Turns a Claude Code PostToolUse hook payload into a scrubbed
// working_buffer event and signals when a flush is due. No LLM, no transcript read — the
// thought (internal action) is associated later in the cold path (§2.1).

import { scrubAndDigest } from './digest.mjs';
import CONFIG from '../config.mjs';

// A tool result counts as an error if the harness flagged it or the text looks like one.
function deriveStatus(payload) {
  const out = payload.tool_output ?? payload.tool_response;
  if (out && typeof out === 'object' && (out.is_error || out.error)) return 'error';
  const text = typeof out === 'string' ? out : JSON.stringify(out ?? '');
  if (/^error\b|\berror:|denied|permission/i.test(text)) return 'error';
  return 'ok';
}

// Build a working_buffer event from a PostToolUse payload. Returns null if the tool is on the
// capture denylist (D12).
export function buildEvent(payload, config = CONFIG) {
  if (config.capture.toolDenylist.includes(payload.tool_name)) return null;
  return {
    session_id: payload.session_id ?? 'unknown',
    ts: new Date().toISOString(),
    act_type: 'external', // tool call; observation rides along in obs_digest
    thought_kind: null,
    tool_name: payload.tool_name ?? null,
    input_digest: scrubAndDigest(payload.tool_input),
    obs_digest: scrubAndDigest(payload.tool_output ?? payload.tool_response),
    status: deriveStatus(payload),
    transcript_uuid: null, // enriched at flush from transcript_path
  };
}

// Append the event and report whether the buffer has reached the page size (flush due).
// Pure orchestration over the repo — no I/O beyond the store.
export function appendAndMaybeFlush(repo, payload, config = CONFIG) {
  const event = buildEvent(payload, config);
  if (!event) return { appended: false, flushDue: false, eventId: null };

  const eventId = repo.appendEvent(event);
  const flushDue = repo.bufferSize(event.session_id) >= config.pageSize;
  return { appended: true, flushDue, eventId };
}
