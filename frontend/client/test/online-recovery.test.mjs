import test from 'node:test';
import assert from 'node:assert/strict';
import { online, beginOnline, endOnline } from '../js/online.js';
import { telemetry, startTelemetry, flushTelemetry } from '../js/telemetry.js';

const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

async function start(t, fetcher) {
  let beat;
  Object.assign(online, { ride: { id: 'recovery-ride', trip: 'classic' }, started: false, running: false, done: false, closed: false, serverEnded: null, onRide: null, onEnded: null });
  t.mock.method(globalThis, 'setInterval', fn => { beat = fn; return 42; });
  t.mock.method(globalThis, 'clearInterval', () => {});
  t.mock.method(globalThis, 'fetch', async (url, options) => String(url).endsWith('/start') ? reply(200, {}) : fetcher(url, options));
  await beginOnline();
  t.after(() => { telemetry.on = false; t.mock.restoreAll(); });
  return () => beat();
}

test('a lost heartbeat retains the ride and the next successful heartbeat recovers', async t => {
  let count = 0, updated = 0;
  const beat = await start(t, () => { if (++count === 1) throw new Error('offline'); return reply(200, {}); });
  online.onRide = () => updated++;
  online.onEnded = () => assert.fail('network failure must not end a ride');
  await beat(); await beat();
  assert.equal(online.running, true); assert.equal(updated, 1); assert.equal(online.serverEnded, null);
});

test('heartbeat conflict confirms the terminal ride once and returns its verdict without another end request', async t => {
  const ended = { id: 'recovery-ride', status: 'failed', reason: 'heartbeat lost', verdict: { status: 'rejected', reasons: [] } };
  const calls = [];
  const beat = await start(t, (url, options) => {
    calls.push([String(url), options.method]);
    return String(url).endsWith('/heartbeat') ? reply(409, { detail: 'ride is failed' }) : reply(200, ended);
  });
  let notified = 0;
  online.onEnded = r => { notified++; assert.deepEqual(r, ended); };
  await beat(); await beat();
  assert.equal(online.running, false); assert.equal(notified, 1);
  assert.deepEqual(await endOnline('failed'), ended);
  assert.equal(calls.some(([url]) => url.endsWith('/end')), false);
});

test('a failed confirmation read or still-running ride never invents a terminal result', async t => {
  let reads = 0;
  const beat = await start(t, url => {
    if (String(url).endsWith('/heartbeat')) return reply(409, {});
    return ++reads === 1 ? reply(503, {}) : reply(200, { status: 'running' });
  });
  online.onEnded = () => assert.fail('no terminal result');
  await beat(); await beat();
  assert.equal(online.running, true); assert.equal(online.serverEnded, null);
});

test('recording-window conflict is a refusal, stops uploads and preserves the first unsaved sequence', async t => {
  startTelemetry('closed-ride');
  telemetry.queue.push({ seq: 7 }, { seq: 8 });
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return reply(409, { detail: 'ride is abandoned' }); });
  await flushTelemetry();
  assert.equal(calls, 1); assert.equal(telemetry.on, false); assert.equal(telemetry.queue.length, 0);
  assert.deepEqual(telemetry.refused, { seq: 7, status: 409, detail: 'ride is abandoned' });
});

test('server outages retain queued telemetry and a later retry uploads it in order', async t => {
  startTelemetry('recovering-ride');
  telemetry.queue.push({ seq: 2 }, { seq: 3 });
  const attempts = [];
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    attempts.push(JSON.parse(options.body).seq);
    return attempts.length === 1 ? reply(503, {}) : reply(200, {});
  });
  await flushTelemetry();
  assert.deepEqual(attempts, [2, 2, 3]); assert.equal(telemetry.queue.length, 0); assert.equal(telemetry.refused, null);
});
