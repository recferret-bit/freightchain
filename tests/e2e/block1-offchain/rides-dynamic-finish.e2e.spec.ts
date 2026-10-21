import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { apiTest, session, signInPlayer } from '../harness/api.mjs';
import { FINISH_MIN_M, FINISH_MAX_M, FINISH_RULES_VERSION, finishBlocked, finishFor } from '../../../frontend/client/shared/finish-for.js';
import { TRIPS } from '../../../frontend/client/js/trips.js';
import { finishGantry } from '../../../frontend/client/js/world/finish-line.js';

const GEO = { 'x-fc-country': 'RS' };
const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const require = createRequire(join(root, 'backend/server/package.json'));
const { PrismaClient } = require('@prisma/client');

apiTest(test, 'RID-T-01 POST /api/rides rejects 4h and 8h with 400', async () => {
  const api = session();
  await signInPlayer(api);
  for (const tier of ['4h', '8h']) {
    const r = await api.call('/api/rides', { body: { tier } });
    assert.equal(r.status, 400, JSON.stringify(r.json));
    assert.equal(r.json.code, 'tier_retired');
  }
  const tiers = await api.call('/api/tiers');
  assert.equal(tiers.status, 200);
  assert.deepEqual(tiers.json.tiers.map((t) => t.id), ['free', '1h']);
});

apiTest(test, 'RID-T-01 POST /api/tickets/orders rejects a 4h or 8h pool with 400', async () => {
  const url = process.env.DATABASE_URL || '';
  assert.match(url, /freightchain_e2e/);
  assert.doesNotMatch(url, /\/freightchain(_test)?(\?|$)/);
  const db = new PrismaClient({ datasources: { db: { url } } });
  const api = session();
  await signInPlayer(api);
  const now = new Date();
  const later = new Date(now.getTime() + 86_400_000);
  try {
    for (const [id, tier] of [[910041, '4h'], [910081, '8h']]) {
      await db.pool.upsert({
        where: { id },
        update: { tier, payoutAt: later },
        create: {
          id, address: `lane2${tier}pool${id}`, tier, label: tier, priceLamports: 1n, minTickets: 1, maxTickets: 0, maxPerWallet: 5,
          prepDeadline: later, playDeadline: later, payoutAt: later, prizeBps: 8500, seedBps: 500, feeBps: 1000,
          feeTreasury: 'FeeTreasury11111111111111111111111111111111', seedTreasury: 'SeedTreasury1111111111111111111111111111111',
          status: 'open', rideSeed: 7, createdAt: now,
        },
      });
      const r = await api.call('/api/tickets/orders', { body: { poolId: id, qty: 1, burnWarningAccepted: true } });
      assert.equal(r.status, 400, JSON.stringify(r.json));
      assert.equal(r.json.code, 'tier_retired');
    }
  } finally {
    await db.pool.deleteMany({ where: { id: { in: [910041, 910081] } } }).catch(() => undefined);
    await db.$disconnect();
  }
});

test('RID-T-02..07 finishFor is one distance per seed, inside the band, and clear of forks', () => {
  const trips = Object.keys(TRIPS);
  assert.ok(trips.length >= 14, `expected at least 14 trips, got ${trips.length}`);
  for (const trip of trips) {
    const a = finishFor(123456, trip, FINISH_RULES_VERSION);
    const b = finishFor(123456, trip, FINISH_RULES_VERSION);
    assert.equal(a.finishS, b.finishS, trip);
    assert.equal(a.finishRulesVersion, 1);
    assert.ok(a.finishS >= FINISH_MIN_M && a.finishS <= FINISH_MAX_M, `${trip} ${a.finishS}`);
    assert.equal(finishBlocked(123456, trip, a.finishS), false, trip);
    assert.ok(a.rx > 0 && a.rx <= 1 && a.rz === 1 && a.rt > 0, trip);
  }
  assert.equal(finishFor(5, '1h', 1).finishS, finishFor(5, '1h', 1).finishS);
  assert.notEqual(finishFor(5, '1h', 1).finishS, finishFor(9, '1h', 1).finishS);
  const line = finishFor(5, '1h', 1).finishS;
  assert.deepEqual(finishGantry({ finish: true }, line, Math.floor(line / 32), 32), { s: line, chunk: Math.floor(line / 32), finish: true });
  assert.equal(finishGantry({ finish: false }, line, Math.floor(line / 32), 32), null);
  assert.equal(TRIPS['1h'].finish, true);
});

apiTest(test, 'RID-T-06 a new 1h ride stores finishFor(seed, trip) as completeDist', async () => {
  // Block 1 moves treasury.json aside. A 1h create then needs a live pool ticket, not a pay-per-ride order.
  const url = process.env.DATABASE_URL || '';
  assert.match(url, /freightchain_e2e/);
  assert.doesNotMatch(url, /\/freightchain(_test)?(\?|$)/);
  const db = new PrismaClient({ datasources: { db: { url } } });
  const api = session();
  const keys = await signInPlayer(api);
  const poolId = 910161;
  const now = new Date();
  const opened = new Date(now.getTime() - 60_000);
  const prep = new Date(now.getTime() + 2 * 3_600_000);
  const play = new Date(now.getTime() + 4 * 3_600_000); // last start is play close − 75 min, still ahead of now
  const payout = new Date(now.getTime() + 24 * 3_600_000);
  try {
    await db.pool.upsert({
      where: { id: poolId },
      update: { tier: '1h', status: 'active', minTickets: 1, prepDeadline: prep, playDeadline: play, payoutAt: payout, createdAt: opened },
      create: {
        id: poolId, address: `lane2finish${poolId}`, tier: '1h', label: '1h', priceLamports: 1n, minTickets: 1, maxTickets: 0, maxPerWallet: 5,
        prepDeadline: prep, playDeadline: play, payoutAt: payout, prizeBps: 8500, seedBps: 500, feeBps: 1000,
        feeTreasury: 'FeeTreasury11111111111111111111111111111111', seedTreasury: 'SeedTreasury1111111111111111111111111111111',
        status: 'active', rideSeed: 7, createdAt: opened, ticketsSold: 1,
      },
    });
    await db.rideTicket.deleteMany({ where: { wallet: keys.wallet, poolId } });
    await db.rideTicket.create({ data: { wallet: keys.wallet, poolId, balance: 2, bought: 2 } });
    const agreed = await api.call('/api/profile/agreements', { method: 'PUT', body: { age18: true, loss: true } });
    assert.equal(agreed.status, 200, JSON.stringify(agreed.json));
    const ride = await api.call('/api/rides', { body: { tier: '1h' }, headers: GEO });
    assert.equal(ride.status, 200, JSON.stringify(ride.json));
    assert.equal(ride.json.tier, '1h');
    assert.equal(ride.json.completeDist, finishFor(ride.json.seed, ride.json.trip, FINISH_RULES_VERSION).finishS);
    const again = await api.call('/api/rides', { body: { tier: '1h' }, headers: GEO });
    assert.equal(again.status, 200, JSON.stringify(again.json));
    assert.equal(again.json.id, ride.json.id);
    assert.equal(again.json.completeDist, ride.json.completeDist);
  } finally {
    await db.ride.deleteMany({ where: { poolId } });
    await db.ticketGrant.deleteMany({ where: { poolId } });
    await db.rideTicket.deleteMany({ where: { poolId } });
    await db.pool.deleteMany({ where: { id: poolId } });
    await db.$disconnect();
  }
});
