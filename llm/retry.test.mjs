// Retry helper tests. Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withRetry, isTransient } from './retry.mjs';

test('isTransient flags 503/429/overload, not auth errors', () => {
  assert.equal(isTransient({ status: 503 }), true);
  assert.equal(isTransient({ status: 429 }), true);
  assert.equal(isTransient(new Error('model is experiencing high demand')), true);
  assert.equal(isTransient({ status: 401 }), false);
  assert.equal(isTransient(new Error('invalid api key')), false);
});

test('withRetry retries a transient failure then succeeds', async () => {
  let calls = 0;
  const out = await withRetry(async () => {
    calls += 1;
    if (calls < 3) throw { status: 503 };
    return 'ok';
  }, { attempts: 3, baseDelayMs: 1 });
  assert.equal(out, 'ok');
  assert.equal(calls, 3);
});

test('withRetry throws a permanent error immediately (no retry)', async () => {
  let calls = 0;
  await assert.rejects(
    () => withRetry(async () => { calls += 1; throw { status: 400, message: 'bad request' }; }, { attempts: 3, baseDelayMs: 1 }),
  );
  assert.equal(calls, 1);
});

test('withRetry gives up after exhausting attempts', async () => {
  let calls = 0;
  await assert.rejects(
    () => withRetry(async () => { calls += 1; throw { status: 503 }; }, { attempts: 2, baseDelayMs: 1 }),
  );
  assert.equal(calls, 2);
});
