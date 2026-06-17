// Digest + secret-scrub for L0 capture (§2). Runs in the hot path, so it is pure and cheap.
// Scrubbing happens BEFORE anything is persisted — never store raw tool payloads.

// Patterns ordered most-specific first. Each replaces the secret with «redacted».
const SECRET_PATTERNS = [
  /sk-ant-[A-Za-z0-9_-]{8,}/g,                 // Anthropic keys
  /sk-[A-Za-z0-9]{16,}/g,                      // OpenAI-style keys
  /gh[pousr]_[A-Za-z0-9]{20,}/g,               // GitHub tokens
  /AKIA[0-9A-Z]{16}/g,                         // AWS access key id
  /xox[baprs]-[A-Za-z0-9-]{10,}/g,             // Slack tokens
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, // JWT
  /\bBearer\s+[A-Za-z0-9._-]{12,}/gi,          // Authorization: Bearer ...
  // key-ish assignment: token/secret/password/api[_-]?key = <value>
  /\b(?:api[_-]?key|apikey|secret|password|passwd|token|access[_-]?token)\b\s*[:=]\s*["']?[^\s"',]{6,}/gi,
];

const REDACTED = '«redacted»';

export function scrubSecrets(text) {
  if (!text) return '';
  let out = String(text);
  for (const re of SECRET_PATTERNS) {
    out = out.replace(re, (m) => {
      // For key=value matches, keep the key name, redact only the value.
      const sep = m.match(/[:=]/);
      if (sep) {
        const idx = m.indexOf(sep[0]);
        return `${m.slice(0, idx + 1)} ${REDACTED}`;
      }
      return REDACTED;
    });
  }
  return out;
}

// Bound a string to head + tail with a length marker, so records stay small.
export function digest(text, { head = 120, tail = 40 } = {}) {
  const s = String(text ?? '');
  if (s.length <= head + tail + 16) return s;
  return `${s.slice(0, head)} …(${s.length} chars)… ${s.slice(-tail)}`;
}

// Convenience: scrub then digest any value (objects are JSON-stringified first).
export function scrubAndDigest(value, opts) {
  const text = typeof value === 'string' ? value : safeStringify(value);
  return digest(scrubSecrets(text), opts);
}

function safeStringify(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
