import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { apiTest, session, signInPlayer } from '../harness/api.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const require = createRequire(join(root, 'backend/server/package.json'));
const { PrismaClient } = require('@prisma/client');
const POOL = 910203;
const DAMAGE_MS = 1000;
const RED_MS = 15_000;

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

const DDL = [
  `DROP TABLE IF EXISTS stats."RideResult"`,
  `CREATE TABLE IF NOT EXISTS stats."RideResult" (
    "rideId" text PRIMARY KEY REFERENCES ride."Ride"(id) ON DELETE CASCADE,
    "poolId" integer, "wallet" text NOT NULL, "finishRulesVersion" integer, "scoreFormulaVersion" integer NOT NULL,
    "durationMs" double precision NOT NULL, "effectiveDurationMs" double precision NOT NULL, "damageTotal" double precision NOT NULL,
    "damageHoles" double precision NOT NULL, "damageVehicles" double precision NOT NULL, "damageProps" double precision NOT NULL,
    "damageCold" double precision NOT NULL, "damageOther" double precision NOT NULL, "redLights" integer NOT NULL,
    "offRoadSeconds" double precision NOT NULL, "mgTotal" integer NOT NULL, "mgPassed" integer NOT NULL, "mgWrong" integer NOT NULL,
    "mgMissed" integer NOT NULL, "mgPenaltySeconds" double precision NOT NULL, "humannessScore" double precision,
    "compositeScore" double precision, "finished" boolean NOT NULL, "computedAt" timestamptz, "distanceM" double precision NOT NULL,
    "verdictTier" text, "createdAt" timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS "RideResult_pool_score_idx" ON stats."RideResult" ("poolId", "compositeScore")`,
  `CREATE INDEX IF NOT EXISTS "RideResult_wallet_created_idx" ON stats."RideResult" ("wallet", "createdAt")`,
];

function effective(row) {
  return row.durationMs + row.mgPenaltySeconds * 1000 + row.damageTotal * DAMAGE_MS + row.redLights * RED_MS;
}

apiTest(test, 'RID-T-08..12 a verified ride writes RideResult and the pool results follow payoutAt', async () => {
  const url = process.env.DATABASE_URL || '';
  assert.match(url, /freightchain_e2e/);
  assert.doesNotMatch(url, /\/freightchain(_test)?(\?|$)/);
  const db = new PrismaClient({ datasources: { db: { url } } });
  const api = session();
  const keys = await signInPlayer(api);
  const other = session();
  const otherKeys = await signInPlayer(other);
  const now = new Date();
  const later = new Date(now.getTime() + 3_600_000);
  const earlier = new Date(now.getTime() - 3_600_000);
  try {
    for (const sql of DDL) await db.$executeRawUnsafe(sql);
    const made = await api.call('/api/rides', { body: { tier: 'free', level: 1 } });
    assert.equal(made.status, 200, JSON.stringify(made.json));
    const id = made.json.id;
    const started = await api.call(`/api/rides/${id}/start`, { body: {} });
    assert.equal(started.status, 200, JSON.stringify(started.json));
    await db.ride.update({ where: { id }, data: { completeDist: 80 } });
    await sleep(4000);
    const beat = await api.call(`/api/rides/${id}/heartbeat`, { body: { s: 80, t: 4, hull: 90 } });
    assert.equal(beat.status, 200, JSON.stringify(beat.json));
    const end = await api.call(`/api/rides/${id}/end`, { body: { outcome: 'shift', s: 80, t: 4, hull: 90 } });
    assert.equal(end.status, 200, JSON.stringify(end.json));
    let row = null;
    for (let i = 0; i < 20 && !row; i++) {
      await sleep(250);
      const found = await db.$queryRawUnsafe('SELECT * FROM stats."RideResult" WHERE "rideId" = $1', id);
      row = found[0] ?? null;
    }
    assert.ok(row, 'verified ride did not write stats.RideResult');
    assert.equal(Number(row.damageHoles), 0);
    assert.equal(Number(row.damageVehicles), 0);
    assert.equal(Number(row.damageProps), 0);
    assert.equal(Number(row.damageCold), 0);
    assert.equal(Number(row.redLights), 0);
    assert.equal(Number(row.mgWrong), 0);
    assert.equal(Number(row.mgMissed), 0);
    assert.equal(Number(row.mgPenaltySeconds), 0);
    assert.equal(Number(row.scoreFormulaVersion), 1);
    assert.equal(Number(row.effectiveDurationMs), effective({ durationMs: Number(row.durationMs), mgPenaltySeconds: 0, damageTotal: Number(row.damageTotal), redLights: 0 }));

    await db.pool.upsert({
      where: { id: POOL },
      update: { payoutAt: later, tier: '1h' },
      create: {
        id: POOL, address: `lane2results${POOL}`, tier: '1h', label: '1h', priceLamports: 1n, minTickets: 1, maxTickets: 0, maxPerWallet: 5,
        prepDeadline: later, playDeadline: later, payoutAt: later, prizeBps: 8500, seedBps: 500, feeBps: 1000,
        feeTreasury: 'FeeTreasury11111111111111111111111111111111', seedTreasury: 'SeedTreasury1111111111111111111111111111111',
        status: 'active', rideSeed: 11, createdAt: now,
      },
    });
    const slowId = randomUUID();
    const fastId = randomUUID();
    const tieId = randomUUID();
    const rideRow = (rideId, wallet, at) => ({
      id: rideId, wallet, tier: '1h', seed: 11, minSeconds: 3600, completeDist: 50_000, status: 'completed',
      createdAt: now, startedAt: now, endedAt: at, lastHbAt: at, poolId: POOL, lastS: 50_000, driveSeconds: 3600,
    });
    await db.ride.create({ data: rideRow(fastId, keys.wallet, earlier) });
    await db.ride.create({ data: rideRow(tieId, otherKeys.wallet, now) });
    await db.ride.create({ data: rideRow(slowId, otherKeys.wallet, now) });
    const insert = async (rideId, wallet, at, extra) => {
      const durationMs = 3_600_000;
      const mgPenaltySeconds = 20 * extra.mgWrong + 45 * extra.mgMissed;
      const damageTotal = extra.damageHoles + extra.damageVehicles + extra.damageProps + extra.damageCold + extra.damageOther;
      const value = effective({ durationMs, mgPenaltySeconds, damageTotal, redLights: extra.redLights });
      await db.$executeRawUnsafe(
        `INSERT INTO stats."RideResult" (
          "rideId","poolId","wallet","finishRulesVersion","scoreFormulaVersion","durationMs","effectiveDurationMs",
          "damageTotal","damageHoles","damageVehicles","damageProps","damageCold","damageOther","redLights","offRoadSeconds",
          "mgTotal","mgPassed","mgWrong","mgMissed","mgPenaltySeconds","humannessScore","compositeScore",
          "finished","computedAt","distanceM","verdictTier","createdAt"
        ) VALUES ($1,$2,$3,1,1,$4,$5,$6,$7,$8,$9,$10,$11,$12,0,3,3,$13,$14,$15,0.9,$5,true,$16,50000,'verified',$17)`,
        rideId, POOL, wallet, durationMs, value, damageTotal,
        extra.damageHoles, extra.damageVehicles, extra.damageProps, extra.damageCold, extra.damageOther, extra.redLights,
        extra.mgWrong, extra.mgMissed, mgPenaltySeconds, at, now,
      );
    };
    const clean = { damageHoles: 0, damageVehicles: 0, damageProps: 0, damageCold: 0, damageOther: 0, redLights: 0, mgWrong: 0, mgMissed: 0 };
    await insert(fastId, keys.wallet, earlier, clean);
    await insert(tieId, otherKeys.wallet, now, { ...clean, damageOther: 0 });
    await insert(slowId, otherKeys.wallet, now, { damageHoles: 4, damageVehicles: 3, damageProps: 2, damageCold: 1, damageOther: 0, redLights: 1, mgWrong: 1, mgMissed: 1 });

    const hidden = await session().call(`/api/pools/${POOL}/results`);
    assert.equal(hidden.status, 200, JSON.stringify(hidden.json));
    assert.equal(hidden.json.revealed, false);
    assert.equal(hidden.json.ranks.length, 0);
    assert.ok(hidden.json.participants >= 3);
    assert.equal(hidden.json.mine, null);
    const own = await api.call(`/api/pools/${POOL}/results`);
    assert.equal(own.status, 200, JSON.stringify(own.json));
    assert.equal(own.json.mine.rideId, fastId);
    assert.equal(own.json.mine.damageHoles, undefined);

    await db.pool.update({ where: { id: POOL }, data: { payoutAt: new Date(now.getTime() - 1000) } });
    const open = await api.call(`/api/pools/${POOL}/results`);
    assert.equal(open.status, 200, JSON.stringify(open.json));
    assert.equal(open.json.revealed, true);
    assert.equal(open.json.scoreFormulaVersion, 1);
    assert.deepEqual(open.json.ranks.map((r) => r.rideId), [fastId, tieId, slowId]);
    assert.equal(open.json.ranks[2].damageHoles, 4);
    assert.equal(open.json.ranks[2].damageVehicles, 3);
    assert.equal(open.json.ranks[2].damageProps, 2);
    assert.equal(open.json.ranks[2].damageCold, 1);
    assert.equal(open.json.ranks[2].redLights, 1);
    assert.equal(open.json.ranks[2].mgWrong, 1);
    assert.equal(open.json.ranks[2].mgMissed, 1);
    assert.equal(open.json.ranks[2].mgPenaltySeconds, 65);
    assert.equal(open.json.ranks[0].humannessScore, undefined);
    assert.ok(open.json.ranks[0].effectiveDurationMs < open.json.ranks[2].effectiveDurationMs);
    assert.ok(open.json.ranks[0].effectiveDurationMs === open.json.ranks[1].effectiveDurationMs);
  } finally {
    await db.ride.deleteMany({ where: { poolId: POOL } }).catch(() => undefined);
    await db.pool.deleteMany({ where: { id: POOL } }).catch(() => undefined);
    await db.$disconnect();
  }
});
