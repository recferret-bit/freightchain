import assert from 'node:assert/strict';
import { test } from 'node:test';
import { driveVerified } from '../../../../backend/server/scripts/honest-traffic.mjs';
import { apiTest, session, signInPlayer } from '../../harness/api.mjs';

apiTest(test, 'B1-REF-01 a second wallet binds the first wallet Convoy code', async () => {
  const a = session();
  const host = await signInPlayer(a);
  const mine = await a.call('/api/referrals');
  assert.equal(mine.status, 200);
  assert.match(mine.json.code, /^[A-Z0-9]+$/);
  const b = session();
  await signInPlayer(b);
  const bound = await b.call('/api/referrals/bind', { body: { code: mine.json.code } });
  assert.equal(bound.status, 200, JSON.stringify(bound.json));
  assert.equal(bound.json.referredBy, host.wallet);
});

apiTest(test, 'B1-REF-02 choosing the convoy gift posts the item', async () => {
  const api = session();
  await signInPlayer(api);
  const r = await api.call('/api/referrals/gift', { body: { item: 'convoy' } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.gift, 'convoy');
});

apiTest(test, 'B1-REF-03 choosing the signal gift posts the item', async () => {
  const api = session();
  await signInPlayer(api);
  const r = await api.call('/api/referrals/gift', { body: { item: 'signal' } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.gift, 'signal');
});

apiTest(test, 'B1-REF-04 a verified MEDIUM ride grants the referrer two free rides and the referee three', async () => {
  const host = session();
  await signInPlayer(host);
  const code = (await host.call('/api/referrals')).json.code;
  const before = (await host.call('/api/me')).json.freeRides;
  const pal = session();
  await signInPlayer(pal);
  const palBefore = (await pal.call('/api/me')).json.freeRides;
  const bound = await pal.call('/api/referrals/bind', { body: { code } });
  assert.equal(bound.status, 200, JSON.stringify(bound.json));
  const call = async (_method, path, body) => pal.call(`/api/${path}`, { method: 'POST', body: body ?? {} });
  const driven = await driveVerified(call, { tier: 'free', level: 2 });
  assert.equal(driven.end?.status, 200, driven.error || JSON.stringify(driven.end?.json).slice(0, 400));
  assert.equal(driven.end.json.status, 'completed');
  assert.equal(driven.end.json.level, 2);
  assert.equal(driven.end.json.verdict?.status, 'verified', JSON.stringify(driven.end.json.verdict?.reasons ?? driven.end.json.verdict));
  assert.equal((await host.call('/api/me')).json.freeRides, before + 2);
  assert.equal((await pal.call('/api/me')).json.freeRides, palBefore + 3);
}, { timeout: 420_000 });
