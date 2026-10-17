import assert from 'node:assert/strict';
import { test } from 'node:test';
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

test.todo('B1-REF-04 a verified MEDIUM ride grants the referrer free-ride credits (server/test referral.service.spec.ts already covers the rule; the HTTP path is not replayed here)');
