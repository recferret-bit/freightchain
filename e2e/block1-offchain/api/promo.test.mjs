import assert from 'node:assert/strict';
import { test } from 'node:test';
import { adminSign, apiTest, devAdmin, session, signInAdmin, signInPlayer } from '../../harness/api.mjs';

const blank = { description: null, maxRedemptions: 5, perWallet: 1, startsAt: null, expiresAt: null, note: null };

apiTest(test, 'B1-PROMO-01 admin signs a free_rides code and B1-PROMO-02 a player redeems it', async () => {
  const code = `E2E${Date.now().toString(36).toUpperCase()}`;
  const promo = { code, effect: { kind: 'free_rides', count: 3 }, ...blank };
  const admin = session();
  const keys = await signInAdmin(admin, devAdmin());
  const signature = await adminSign(admin, keys, '/api/admin/promos/challenge', { action: 'promo_create', promo });
  const created = await admin.call('/api/admin/promos', { body: { promo, signature }, headers: { 'x-fc-admin': '1' } });
  assert.equal(created.status, 200, JSON.stringify(created.json));
  const list = await admin.call('/api/admin/promos', { method: 'GET' });
  assert.equal(list.status, 200);
  assert.ok(JSON.stringify(list.json).includes(code));
  const player = session();
  await signInPlayer(player);
  const before = await player.call('/api/me');
  const redeemed = await player.call('/api/promo/redeem', { body: { code } });
  assert.equal(redeemed.status, 200, JSON.stringify(redeemed.json));
  assert.equal(redeemed.json.kind, 'free_rides');
  const after = await player.call('/api/me');
  assert.equal(after.json.freeRides, before.json.freeRides + 3);
});

apiTest(test, 'B1-PROMO-03 creating a cosmetic code is refused visuals_are_honk', async () => {
  const promo = { code: `VIS${Date.now().toString(36).toUpperCase()}`, effect: { kind: 'cosmetic', slot: 'truck_color', item: 'red' }, ...blank };
  const admin = session();
  const keys = await signInAdmin(admin, devAdmin());
  const ch = await admin.call('/api/admin/promos/challenge', { body: { action: 'promo_create', promo }, headers: { 'x-fc-admin': '1' } });
  assert.equal(ch.status, 409);
  assert.equal(ch.json.code, 'visuals_are_honk');
});

apiTest(test, 'B1-PROMO-04 an unknown code does not redeem', async () => {
  const player = session();
  await signInPlayer(player);
  const r = await player.call('/api/promo/redeem', { body: { code: 'NOSUCHCODE' } });
  assert.ok(r.status === 404 || r.status === 409, JSON.stringify(r));
});
