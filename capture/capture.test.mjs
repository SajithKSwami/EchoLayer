// L0 capture + secret-scrub tests. Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scrubSecrets, digest, scrubAndDigest } from './digest.mjs';
import { buildEvent, appendAndMaybeFlush } from './capture.mjs';
import { openStore } from '../store/repo.mjs';

test('scrubSecrets redacts an Anthropic key but keeps surrounding text', () => {
  const out = scrubSecrets('using sk-ant-abcdEFGH12345678 to call the API');
  assert.ok(!out.includes('sk-ant-abcdEFGH12345678'));
  assert.ok(out.includes('using') && out.includes('to call the API'));
});

test('scrubSecrets redacts the value of a token assignment, keeps the key name', () => {
  const out = scrubSecrets('api_key="abc123def456ghi"');
  assert.ok(out.includes('api_key'));
  assert.ok(!out.includes('abc123def456ghi'));
});

test('scrubSecrets redacts a Bearer authorization header', () => {
  const out = scrubSecrets('Authorization: Bearer abcDEF123456ghiJKL');
  assert.ok(!out.includes('abcDEF123456ghiJKL'));
});

test('scrubSecrets leaves innocuous text untouched', () => {
  const text = 'Edit cv.md: replace the summary block';
  assert.equal(scrubSecrets(text), text);
});

test('digest bounds a long string with a length marker', () => {
  const long = 'x'.repeat(500);
  const d = digest(long, { head: 20, tail: 10 });
  assert.ok(d.length < 100);
  assert.ok(d.includes('(500 chars)'));
});

test('scrubAndDigest stringifies and scrubs an object payload', () => {
  const d = scrubAndDigest({ cmd: 'deploy', token: 'ghp_abcdefabcdefabcdefabcdef12' });
  assert.ok(!d.includes('ghp_abcdefabcdefabcdefabcdef12'));
});

test('buildEvent maps a PostToolUse payload to a scrubbed external-action event', () => {
  // Arrange
  const payload = {
    session_id: 's1', tool_name: 'Bash',
    tool_input: { command: 'curl -H "Authorization: Bearer secretTokenValue123"' },
    tool_output: 'ok',
  };
  // Act
  const e = buildEvent(payload);
  // Assert
  assert.equal(e.act_type, 'external');
  assert.equal(e.tool_name, 'Bash');
  assert.equal(e.status, 'ok');
  assert.ok(!e.input_digest.includes('secretTokenValue123')); // scrubbed before persistence
});

test('buildEvent returns null for a denylisted tool', () => {
  const config = { capture: { toolDenylist: ['Read'] }, pageSize: 50 };
  assert.equal(buildEvent({ tool_name: 'Read', session_id: 's1' }, config), null);
});

test('deriveStatus marks an errored tool result', () => {
  const e = buildEvent({ session_id: 's1', tool_name: 'Edit', tool_output: { is_error: true } });
  assert.equal(e.status, 'error');
});

test('appendAndMaybeFlush signals flushDue when the buffer reaches pageSize', () => {
  // Arrange — tiny page size so the test is fast
  const repo = openStore(':memory:');
  const config = { pageSize: 3, capture: { toolDenylist: [] } };
  const payload = { session_id: 's1', tool_name: 'Grep', tool_input: {}, tool_output: 'ok' };
  // Act
  const r1 = appendAndMaybeFlush(repo, payload, config);
  const r2 = appendAndMaybeFlush(repo, payload, config);
  const r3 = appendAndMaybeFlush(repo, payload, config);
  // Assert
  assert.equal(r1.flushDue, false);
  assert.equal(r2.flushDue, false);
  assert.equal(r3.flushDue, true); // 3rd event hits pageSize
  repo.close();
});

test('appendAndMaybeFlush skips denylisted tools without appending', () => {
  const repo = openStore(':memory:');
  const config = { pageSize: 50, capture: { toolDenylist: ['Read'] } };
  const r = appendAndMaybeFlush(repo, { session_id: 's1', tool_name: 'Read' }, config);
  assert.equal(r.appended, false);
  assert.equal(repo.bufferSize('s1'), 0);
  repo.close();
});
