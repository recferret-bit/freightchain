import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { adminSign, apiTest, devAdmin, session, signInAdmin, signInPlayer } from '../harness/api.mjs';

/* PRM-T-01..14 against the running block-1 API and its PostgreSQL. Cosmetic create is refused at the
   challenge (409 visuals_are_honk). free_rides is not in the HTTP schema, so create is 400; a stored row still redeems as 409 promo_retired. */
const require = createRequire(join(dirname(fileURLToPath(import.meta.url)), '../../../backend/server/package.json'));
const { PrismaClient } = require('@prisma/client');

const blank = { description: null, maxRedemptions: 5, perWallet: 1, startsAt: null, expiresAt: null, note: null };
const stamp = () => Date.now().toString(36).toUpperCase();

async function admin() {
  const api = session();
  const keys = await signInAdmin(api, devAdmin());
  return { api, keys };
}

async function ask(a, promo) {
  return a.api.call('/api/admin/promos/challenge', { body: { action: 'promo_create', promo }, headers: { 'x-fc-admin': '1' } });
}

async function create(a, promo) {
  const signature = await adminSign(a.api, a.keys, '/api/admin/promos/challenge', { action: 'promo_create', promo });
  return a.api.call('/api/admin/promos', { body: { promo, signature }, headers: { 'x-fc-admin': '1' } });
}

apiTest(test, '[PRM-T-01] redeem accepts a trimmed mixed-case code and rejects a short or symbolic one', async () => {
  const a = await admin();
  const code = `RIDE${stamp()}`;
  const made = await create(a, { code: `  ${code.slice(0, 2)} ${code.slice(2)}  `, effect: { kind: 'ride', tier: '1h' }, ...blank });
  assert.equal(made.status, 200, JSON.stringify(made.json));
  const player = session();
  await signInPlayer(player);
  const ok = await player.call('/api/promo/redeem', { body: { code: code.toLowerCase() } });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(ok.json.code, code);
  const bad = await ask(a, { code: 'AB', effect: { kind: 'ride', tier: '1h' }, ...blank });
  assert.equal(bad.status, 400);
  assert.equal(bad.json.code, 'bad_promo_code');
  const symbol = await ask(a, { code: 'BAD CODE!', effect: { kind: 'ride', tier: '1h' }, ...blank });
  assert.equal(symbol.status, 400);
});

apiTest(test, '[PRM-T-02] cosmetic create is 409 visuals_are_honk and free_rides is not a creatable HTTP effect', async () => {
  const a = await admin();
  const cosmetic = { code: `VIS${stamp()}`, effect: { kind: 'cosmetic', slot: 'wheel', item: 'crimson' }, ...blank };
  const ch = await a.api.call('/api/admin/promos/challenge', { body: { action: 'promo_create', promo: cosmetic }, headers: { 'x-fc-admin': '1' } });
  assert.equal(ch.status, 409);
  assert.equal(ch.json.code, 'visuals_are_honk');
  const retired = await a.api.call('/api/admin/promos/challenge', {
    body: { action: 'promo_create', promo: { code: `OLD${stamp()}`, effect: { kind: 'free_rides', count: 1 }, ...blank } },
    headers: { 'x-fc-admin': '1' },
  });
  assert.equal(retired.status, 400);
});

apiTest(test, '[PRM-T-03] a ride code rejects an unknown tier and a ticket code rejects credits below 1', async () => {
  const a = await admin();
  const tier = await ask(a, { code: `BAD${stamp()}`, effect: { kind: 'ride', tier: 'free' }, ...blank });
  assert.equal(tier.status, 400);
  assert.equal(tier.json.code, 'validation_error');
  const credits = await ask(a, { code: `TK${stamp()}`, effect: { kind: 'tickets', tier: '1h', poolId: null, credits: 0 }, ...blank });
  assert.equal(credits.status, 400);
});

apiTest(test, '[PRM-T-04] a ride code with perWallet other than 1 is 400 bad_promo_code', async () => {
  const a = await admin();
  const r = await ask(a, { code: `ONCE${stamp()}`, effect: { kind: 'ride', tier: '1h' }, ...blank, perWallet: 2 });
  assert.equal(r.status, 400);
  assert.equal(r.json.code, 'bad_promo_code');
});

apiTest(test, '[PRM-T-05] description, note, perWallet and expiry bounds are enforced', async () => {
  const a = await admin();
  const effect = { kind: 'ride', tier: '4h' };
  const code = `LIM${stamp()}`;
  assert.equal((await ask(a, { code, effect, ...blank, description: 'x'.repeat(201) })).status, 400);
  assert.equal((await ask(a, { code, effect, ...blank, note: 'n'.repeat(501) })).status, 400);
  assert.equal((await ask(a, { code, effect, ...blank, perWallet: 0 })).status, 400);
  assert.equal((await ask(a, { code, effect, ...blank, expiresAt: Date.now() - 1000 })).status, 400);
  assert.equal((await ask(a, { code, effect, ...blank, startsAt: Date.now() + 60_000, expiresAt: Date.now() + 1000 })).status, 400);
});

apiTest(test, '[PRM-T-06] scheduled, ended, exhausted and disabled codes are not active', async () => {
  const a = await admin();
  const player = session();
  await signInPlayer(player);
  const later = `LAT${stamp()}`;
  assert.equal((await create(a, { code: later, effect: { kind: 'ride', tier: '1h' }, ...blank, startsAt: Date.now() + 3600_000 })).status, 200);
  const scheduled = await player.call('/api/promo/redeem', { body: { code: later } });
  assert.equal(scheduled.status, 409);
  assert.match(scheduled.json.detail, /not active yet/);
  const soon = `END${stamp()}`;
  assert.equal((await create(a, { code: soon, effect: { kind: 'ride', tier: '1h' }, ...blank, expiresAt: Date.now() + 1500 })).status, 200);
  await new Promise((r) => setTimeout(r, 1700));
  const ended = await player.call('/api/promo/redeem', { body: { code: soon } });
  assert.equal(ended.status, 409);
  assert.match(ended.json.detail, /expired/);
  const one = `ONE${stamp()}`;
  assert.equal((await create(a, { code: one, effect: { kind: 'ride', tier: '8h' }, ...blank, maxRedemptions: 1 })).status, 200);
  assert.equal((await player.call('/api/promo/redeem', { body: { code: one } })).status, 200);
  const other = session();
  await signInPlayer(other);
  const exhausted = await other.call('/api/promo/redeem', { body: { code: one } });
  assert.equal(exhausted.status, 409);
  assert.match(exhausted.json.detail, /fully redeemed/);
  const off = `OFF${stamp()}`;
  assert.equal((await create(a, { code: off, effect: { kind: 'ride', tier: '1h' }, ...blank })).status, 200);
  const disableSig = await adminSign(a.api, a.keys, '/api/admin/promos/challenge', { action: 'promo_disable', code: off });
  assert.equal((await a.api.call(`/api/admin/promos/${off}/disable`, { body: { signature: disableSig }, headers: { 'x-fc-admin': '1' } })).status, 200);
  const disabled = await other.call('/api/promo/redeem', { body: { code: off } });
  assert.equal(disabled.status, 409);
  assert.match(disabled.json.detail, /no longer valid/);
});

apiTest(test, '[PRM-T-07] unknown, disabled and repeat redemptions are refused', async () => {
  const player = session();
  await signInPlayer(player);
  const missing = await player.call('/api/promo/redeem', { body: { code: `NO${stamp()}` } });
  assert.equal(missing.status, 404);
  const a = await admin();
  const code = `REP${stamp()}`;
  assert.equal((await create(a, { code, effect: { kind: 'ride', tier: '1h' }, ...blank })).status, 200);
  assert.equal((await player.call('/api/promo/redeem', { body: { code } })).status, 200);
  const again = await player.call('/api/promo/redeem', { body: { code } });
  assert.equal(again.status, 409);
  assert.match(again.json.detail, /already redeemed/);
});

apiTest(test, '[PRM-T-08] a stored free_rides row is 409 promo_retired and a stored cosmetic row is 409 visuals_are_honk', async () => {
  const db = new PrismaClient();
  const free = `FR${stamp()}`;
  const cab = `CAB${stamp()}`;
  const now = new Date();
  try {
    await db.promoCode.create({ data: { code: free, kind: 'free_rides', freeRides: 2, perWallet: 1, startsAt: now, createdAt: now } });
    await db.promoCode.create({ data: { code: cab, kind: 'cosmetic', cosmeticSlot: 'wheel', cosmeticItem: 'crimson', perWallet: 1, startsAt: now, createdAt: now } });
  } finally { await db.$disconnect(); }
  const player = session();
  await signInPlayer(player);
  const retired = await player.call('/api/promo/redeem', { body: { code: free } });
  assert.equal(retired.status, 409);
  assert.equal(retired.json.code, 'promo_retired');
  const visual = await player.call('/api/promo/redeem', { body: { code: cab } });
  assert.equal(visual.status, 409);
  assert.equal(visual.json.code, 'visuals_are_honk');
});

apiTest(test, '[PRM-T-09] a ride promo is ordered before a weekly grant and quotes 0 TEN4', async () => {
  const a = await admin();
  const code = `SHIFT${stamp()}`;
  assert.equal((await create(a, { code, effect: { kind: 'ride', tier: '1h' }, ...blank })).status, 200);
  const player = session();
  await signInPlayer(player);
  const before = await player.call('/api/me');
  assert.equal((await player.call('/api/promo/redeem', { body: { code } })).status, 200);
  const ride = await player.call('/api/rides', { body: { tier: '1h' } });
  assert.equal(ride.status, 200, JSON.stringify(ride.json));
  assert.equal(ride.json.promo, true);
  assert.equal(ride.json.tier, '1h');
  assert.equal(ride.json.honk.state, 'none');
  assert.equal(ride.json.honk.pays, '0');
  assert.equal((await player.call('/api/me')).json.freeRides, before.json.freeRides);
});

apiTest(test, '[PRM-T-10] a ticket promo with no selling pool is 409 no_open_pool', async () => {
  const a = await admin();
  const code = `POOL${stamp()}`;
  const made = await create(a, { code, effect: { kind: 'tickets', tier: '1h', poolId: null, credits: 2 }, ...blank, maxRedemptions: null });
  assert.equal(made.status, 200, JSON.stringify(made.json));
  const player = session();
  await signInPlayer(player);
  const r = await player.call('/api/promo/redeem', { body: { code } });
  assert.equal(r.status, 409, JSON.stringify(r.json));
  assert.equal(r.json.code, 'no_open_pool');
  const pinned = `PIN${stamp()}`;
  const missing = await create(a, { code: pinned, effect: { kind: 'tickets', tier: '1h', poolId: 999_999, credits: 1 }, ...blank });
  assert.equal(missing.status, 400, JSON.stringify(missing.json));
  assert.equal(missing.json.code, 'bad_promo_code');
});

apiTest(test, '[PRM-T-11] wardrobe lists the nine slots and equip rejects an unknown or unowned item', async () => {
  const player = session();
  await signInPlayer(player);
  const wardrobe = await player.call('/api/wardrobe');
  assert.equal(wardrobe.status, 200, JSON.stringify(wardrobe.json));
  assert.equal(Object.keys(wardrobe.json.unlocked).length, 9);
  assert.equal(Object.keys(wardrobe.json.equipped).length, 9);
  const equipped = await player.call('/api/wardrobe/equip', { body: { slot: 'wheel', item: 'classic' } });
  assert.equal(equipped.status, 200, JSON.stringify(equipped.json));
  const unknown = await player.call('/api/wardrobe/equip', { body: { slot: 'wheel', item: 'no-such-wheel' } });
  assert.equal(unknown.status, 400);
  const unowned = await player.call('/api/wardrobe/equip', { body: { slot: 'wheel', item: 'gold' } });
  assert.equal(unowned.status, 409);
});

apiTest(test, '[PRM-T-12] a promo create without a matching signature is 401 and a duplicate code is 409', async () => {
  const a = await admin();
  const code = `DUP${stamp()}`;
  const promo = { code, effect: { kind: 'ride', tier: '1h' }, ...blank };
  const unsigned = await a.api.call('/api/admin/promos', { body: { promo, signature: 'aaaa' }, headers: { 'x-fc-admin': '1' } });
  assert.equal(unsigned.status, 401);
  assert.equal((await create(a, promo)).status, 200);
  assert.equal((await create(a, promo)).status, 409);
});

apiTest(test, '[PRM-T-13] admin lists the code, its redemption, and a disable', async () => {
  const a = await admin();
  const code = `LIST${stamp()}`;
  assert.equal((await create(a, { code, effect: { kind: 'ride', tier: '1h' }, ...blank })).status, 200);
  const player = session();
  await signInPlayer(player);
  assert.equal((await player.call('/api/promo/redeem', { body: { code } })).status, 200);
  const list = await a.api.call('/api/admin/promos');
  assert.equal(list.status, 200);
  assert.ok(JSON.stringify(list.json).includes(code));
  const redemptions = await a.api.call(`/api/admin/promos/redemptions?code=${code}`);
  assert.equal(redemptions.status, 200, JSON.stringify(redemptions.json));
  assert.ok(JSON.stringify(redemptions.json).includes(code));
  const signature = await adminSign(a.api, a.keys, '/api/admin/promos/challenge', { action: 'promo_disable', code });
  const off = await a.api.call(`/api/admin/promos/${code}/disable`, { body: { signature }, headers: { 'x-fc-admin': '1' } });
  assert.equal(off.status, 200, JSON.stringify(off.json));
});

apiTest(test, '[PRM-T-14] ten parallel redeems of maxUses 1 yield one 200 and nine 409', async () => {
  const a = await admin();
  const code = `RACE${stamp()}`;
  assert.equal((await create(a, { code, effect: { kind: 'ride', tier: '1h' }, ...blank, maxRedemptions: 1 })).status, 200);
  const players = await Promise.all(Array.from({ length: 10 }, async () => {
    const api = session();
    await signInPlayer(api);
    return api;
  }));
  const results = await Promise.all(players.map((api) => api.call('/api/promo/redeem', { body: { code } })));
  const ok = results.filter((r) => r.status === 200);
  const conflict = results.filter((r) => r.status === 409);
  assert.equal(ok.length, 1, JSON.stringify(results.map((r) => r.status)));
  assert.equal(conflict.length, 9);
});
