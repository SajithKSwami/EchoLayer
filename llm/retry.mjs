// Retry transient API failures (rate limits / overload / 5xx) with linear backoff.
// Permanent errors (auth, bad request) are thrown immediately.

export async function withRetry(fn, { attempts = 3, baseDelayMs = 600 } = {}) {
  let last;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      if (!isTransient(err) || i === attempts - 1) throw err;
      await sleep(baseDelayMs * (i + 1));
    }
  }
  throw last;
}

export function isTransient(err) {
  const status = err?.status ?? err?.response?.status;
  if (status === 429 || status === 503 || status === 529 || status === 500) return true;
  const m = String(err?.message ?? err).toLowerCase();
  return /high demand|overloaded|rate limit|unavailable|temporarily|503|429|529/.test(m);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
