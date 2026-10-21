import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { gzipSync } from 'node:zlib';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { apiTest, session, signInPlayer } from '../harness/api.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const require = createRequire(join(root, 'backend/server/package.json'));
const { PrismaClient } = require('@prisma/client');
const POOL = 940402;

function database() {
  const url = process.env.DATABASE_URL || '';
  assert.doesNotMatch(url, /\/freightchain(_test)?(\?|$)/);
  return new PrismaClient({ datasources: { db: { url } } });
}

apiTest(test, 'RPL-T-01..15 replay visibility: running, training, pool payout, and zeroed inputs', async () => {
  const db = database();
  const ownerApi = session();
  const owner = await signInPlayer(ownerApi);
  const otherApi = session();
  const other = await signInPlayer(otherApi);
  const anon = session();
  const now = new Date();
  const later = new Date(now.getTime() + 3_600_000);
  const earlier = new Date(now.getTime() - 60_000);
  const ids = [];
  try {
    const running = await ownerApi.call('/api/rides', { body: { tier: 'free', level: 1, tutorial: false, assist: false } });
    assert.equal(running.status, 200, JSON.stringify(running.json));
    const started = await ownerApi.call(`/api/rides/${running.json.id}/start`, { body: {} });
    assert.equal(started.status, 200, JSON.stringify(started.json));
    ids.push(running.json.id);
    assert.equal((await anon.call(`/api/watch/${running.json.id}`)).status, 404);
    assert.equal((await anon.call(`/api/watch/${running.json.id}`)).json.code, 'replay_not_available');
    assert.equal((await ownerApi.call(`/api/watch/${running.json.id}/road?from=0&to=6000`)).status, 404);
    assert.equal((await otherApi.call(`/api/watch/${running.json.id}`)).json.code, 'replay_not_available');

    await db.ride.update({ where: { id: running.json.id }, data: { status: 'completed', endedAt: now, driveSeconds: 30, lastS: 100 } });
    const listed = await anon.call(`/api/replays?wallet=${owner.wallet}&limit=50`);
    assert.equal(listed.status, 200, JSON.stringify(listed.json));
    assert.equal(listed.json.rows.some((row) => row.id === running.json.id), false);
    assert.equal((await anon.call(`/api/watch/${running.json.id}`)).status, 404);
    assert.equal((await fetch(`${process.env.E2E_BASE}/r/${running.json.id}`)).status, 404);
    assert.equal((await anon.call(`/api/actions/ride/${running.json.id}`)).status, 404);

    await db.pool.upsert({
      where: { id: POOL },
      update: { payoutAt: later, status: 'active' },
      create: {
        id: POOL, address: `lane2replay${POOL}`, tier: '1h', label: '1h', priceLamports: 1n, minTickets: 1, maxTickets: 0, maxPerWallet: 5,
        prepDeadline: later, playDeadline: later, payoutAt: later, prizeBps: 8500, seedBps: 500, feeBps: 1000,
        feeTreasury: 'FeeTreasury11111111111111111111111111111111', seedTreasury: 'SeedTreasury1111111111111111111111111111111',
        status: 'active', rideSeed: 11, createdAt: now,
      },
    });
    const poolId = randomUUID();
    ids.push(poolId);
    await db.ride.create({
      data: {
        id: poolId, wallet: owner.wallet, tier: '1h', seed: 11, minSeconds: 3600, completeDist: 50_000, status: 'completed',
        createdAt: now, startedAt: earlier, endedAt: now, lastHbAt: now, poolId: POOL, lastS: 50_000, driveSeconds: 3600,
      },
    });
    await db.rideVerdict.create({ data: { rideId: poolId, status: 'verified', reasons: [], scores: {}, rulesVersion: 1, judgedAt: now } });
    const sample = [0, 0, 2.4, 0, 8, 900, 2, 100, 0.1, 0, 0, 0, 12, 0, 7];
    const body = JSON.stringify({ samples: [sample], inputs: [] });
    await db.rideBatch.create({
      data: {
        rideId: poolId, seq: 0, prevHash: poolId, hash: 'vis', hashOk: true, t0: 0, t1: 1, samples: 1, inputs: 0, bytes: body.length,
        payload: gzipSync(body), receivedAt: now,
      },
    });

    assert.equal((await ownerApi.call(`/api/watch/${poolId}`)).status, 200);
    assert.equal((await anon.call(`/api/watch/${poolId}`)).status, 404);
    assert.equal((await anon.call(`/api/watch/${poolId}`)).json.code, 'replay_locked_until_payout');
    assert.equal((await otherApi.call(`/api/watch/${poolId}`)).status, 404);
    const hiddenList = await anon.call(`/api/replays?wallet=${owner.wallet}&limit=50`);
    assert.equal(hiddenList.json.rows.some((row) => row.id === poolId), false);
    const ownerList = await ownerApi.call(`/api/replays?wallet=${owner.wallet}&limit=50`);
    assert.equal(ownerList.json.rows.some((row) => row.id === poolId), true);

    await db.pool.update({ where: { id: POOL }, data: { payoutAt: earlier } });
    const open = await anon.call(`/api/watch/${poolId}`);
    assert.equal(open.status, 200, JSON.stringify(open.json));
    const row = open.json.batches[0].samples[0];
    assert.equal(row.length > 14, true);
    assert.equal(row[14], 0);
    assert.equal(JSON.stringify(open.json).includes('"inputs"'), false);
    const after = await anon.call(`/api/replays?wallet=${owner.wallet}&limit=50`);
    assert.equal(after.json.rows.some((item) => item.id === poolId), true);
  } finally {
    await db.ride.deleteMany({ where: { id: { in: ids } } }).catch(() => undefined);
    await db.pool.deleteMany({ where: { id: POOL } }).catch(() => undefined);
    await db.$disconnect();
  }
});
