import test from 'node:test';
import assert from 'node:assert/strict';
import { api } from '../js/editor/api.js';

test('a throttle refusal retries safely; job caps and other failures are not retried', async t => {
  const originalFetch = globalThis.fetch, originalTimeout = globalThis.setTimeout;
  t.after(() => { globalThis.fetch = originalFetch; globalThis.setTimeout = originalTimeout; });
  globalThis.setTimeout = fn => { queueMicrotask(fn); return 0; };
  let calls = 0;
  globalThis.fetch = async (_url, options) => {
    assert.equal(options.credentials, 'include');
    assert.equal(options.headers['x-fc-editor'], '1');
    return ++calls < 3 ? new Response(JSON.stringify({ code: 'rate_limited' }), { status: 429, headers: { 'retry-after': '1' } }) : new Response('{"ok":true}');
  };
  assert.deepEqual(await api('entities/bush/drafts', { method: 'POST', body: { source: 'x' } }), { ok: true });
  assert.equal(calls, 3);
  calls = 0;
  globalThis.fetch = async () => { calls++; return new Response('{"code":"job_cap","detail":"daily limit"}', { status: 429 }); };
  await assert.rejects(api('jobs', { method: 'POST', body: {} }), { code: 'job_cap' });
  assert.equal(calls, 1);
});
