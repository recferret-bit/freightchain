import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { apiTest, session, signInPlayer } from '../harness/api.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const require = createRequire(join(root, 'backend/server/package.json'));
const { PrismaClient } = require('@prisma/client');

const POOL = 880051;

apiTest(test, 'POOL-T-01..16 pool schedule, last start, burn checkbox, mismatch and appeals', async () => {
  const schedule = await import(pathToFileURL(join(root, 'backend/server/dist/domain/economy/pool-schedule.js')).href);
  const { defaultWeeklySchedule, finishWindowFits, MAX_MIN_FINISH_SECS, commitBlockReason } = schedule;
  const url = process.env.DATABASE_URL || '';
  assert.match(url, /freightchain_e2e/);
  const db = new PrismaClient({ datasources: { db: { url } } });
  const api = session();
  const keys = await signInPlayer(api);
  const agreed = await api.call('/api/profile/agreements', { method: 'PUT', body: { age18: true, loss: true } });
  assert.equal(agreed.status, 200, JSON.stringify(agreed.json));
  const now = new Date();
  const play = new Date(now.getTime() + 3 * 3600_000);
  const last = new Date(play.getTime() - 75 * 60_000);
  const prep = new Date(play.getTime() - 2 * 3600_000);
  const validation = new Date(play.getTime() + 36 * 3600_000);
  const weekly = defaultWeeklySchedule(new Date('2026-10-21T12:00:00.000Z'));
  assert.equal(weekly.opensAt.getUTCDay(), 2);
  assert.equal(weekly.playCloseAt.getUTCDay(), 0);
  assert.equal(weekly.salesCloseAt.getTime(), weekly.playCloseAt.getTime() - 2 * 3600_000);
  assert.equal(weekly.lastStartAt.getTime(), weekly.playCloseAt.getTime() - 75 * 60_000);
  assert.equal(finishWindowFits(weekly.salesCloseAt, weekly.playCloseAt, MAX_MIN_FINISH_SECS), true);
  assert.equal(finishWindowFits(weekly.salesCloseAt, weekly.playCloseAt, 10_800), false);
  assert.match(commitBlockReason(new Date(weekly.validationUntil.getTime() - 1), weekly.validationUntil, 0, 0) || '', /validation/);
  assert.equal(commitBlockReason(weekly.validationUntil, weekly.validationUntil, 1, 0)?.includes('appeal'), true);
  const dialog = readFileSync(join(root, 'frontend/client/site/ticket-dialog.js'), 'utf8');
  assert.match(dialog, /id: 'burn-warning'/);
  assert.match(dialog, /burns with no refund/);
  assert.match(dialog, /сгорает без возврата/);
  const rules = readFileSync(join(root, 'backend/programs/freightchain_pools/src/constants.rs'), 'utf8');
  assert.match(rules, /7_200/);
  assert.equal(readFileSync(join(root, 'backend/server/src/presentation/admin/admin-appeals.http.controller.ts'), 'utf8').includes('set_pool_rules'), true);
  try {
    await db.rideAppeal.deleteMany({ where: { poolId: POOL } });
    await db.ride.deleteMany({ where: { poolId: POOL } });
    await db.pool.upsert({
      where: { id: POOL },
      update: {
        prepDeadline: prep, playDeadline: play, payoutAt: validation, createdAt: now, status: 'active',
        opensAt: null, salesCloseAt: null, lastStartAt: null, playCloseAt: null, validationUntil: null,
      },
      create: {
        id: POOL, address: `lane3schedule${POOL}`, tier: '1h', label: '1h', priceLamports: 50_000_000n, minTickets: 1, maxTickets: 0, maxPerWallet: 5,
        prepDeadline: prep, playDeadline: play, payoutAt: validation, prizeBps: 8500, seedBps: 500, feeBps: 1000,
        feeTreasury: 'FeeTreasury11111111111111111111111111111111', seedTreasury: 'SeedTreasury1111111111111111111111111111111',
        status: 'active', rideSeed: 11, createdAt: now, ticketsSold: 1, buyers: 1,
      },
    });
    const current = await session().call('/api/pools/current');
    assert.equal(current.status, 200, JSON.stringify(current.json));
    const detail = await session().call(`/api/pools/${POOL}`);
    assert.equal(detail.status, 200, JSON.stringify(detail.json));
    assert.equal(detail.json.lastStartAt, last.getTime());
    assert.equal(detail.json.playCloseAt, play.getTime());
    assert.equal(detail.json.salesCloseAt, prep.getTime());
    assert.equal(detail.json.validationUntil, validation.getTime());
    assert.equal(detail.json.opensAt, now.getTime());
    assert.ok(['upcoming', 'open', 'finishing', 'validating', 'paid', 'closed'].includes(detail.json.phase));

    const missingFlag = await api.call('/api/tickets', { body: { poolId: POOL, qty: 1 } });
    assert.equal(missingFlag.status, 400, JSON.stringify(missingFlag.json));
    const unchecked = await api.call('/api/tickets', { body: { poolId: POOL, qty: 1, burnWarningAccepted: false } });
    assert.equal(unchecked.status, 400);

    await db.pool.update({ where: { id: POOL }, data: { lastStartAt: new Date(play.getTime() - 1000) } });
    const drifted = await api.call('/api/tickets', { body: { poolId: POOL, qty: 1, burnWarningAccepted: true } });
    assert.equal(drifted.status, 409, JSON.stringify(drifted.json));
    assert.equal(drifted.json.code, 'pool_schedule_mismatch');
    const alerts = await db.alertOutbox.count({ where: { kind: 'pool_schedule_mismatch' } });
    assert.ok(alerts >= 1);

    await db.pool.update({ where: { id: POOL }, data: { lastStartAt: null, playDeadline: new Date(now.getTime() + 30_000) } });
    const rideId = randomUUID();
    await db.ride.create({
      data: {
        id: rideId, wallet: keys.wallet, tier: '1h', seed: 11, minSeconds: 3600, completeDist: 50_000, status: 'created',
        createdAt: now, poolId: POOL, priceUsd: 5, lamports: 50_000_000n,
      },
    });
    const late = await api.call(`/api/rides/${rideId}/start`, { body: {} });
    assert.equal(late.status, 409, JSON.stringify(late.json));
    assert.equal(late.json.code, 'pool_last_start_passed');

    const appealRide = randomUUID();
    const appealPlay = new Date(now.getTime() - 60_000);
    await db.pool.update({
      where: { id: POOL },
      data: { playDeadline: appealPlay, prepDeadline: new Date(appealPlay.getTime() - 2 * 3600_000), payoutAt: validation, lastStartAt: null, playCloseAt: null },
    });
    await db.ride.create({
      data: {
        id: appealRide, wallet: keys.wallet, tier: '1h', seed: 11, minSeconds: 3600, completeDist: 50_000, status: 'completed',
        createdAt: now, endedAt: appealPlay, startedAt: new Date(appealPlay.getTime() - 3600_000), poolId: POOL, priceUsd: 5, lamports: 50_000_000n, lastS: 1000,
      },
    });
    await db.rideVerdict.create({ data: { rideId: appealRide, status: 'rejected', reasons: [], scores: {}, rulesVersion: 1, judgedAt: now } });
    const appeal = await api.call(`/api/rides/${appealRide}/appeal`, { body: { reason: 'the recording dropped a batch' } });
    assert.equal(appeal.status, 200, JSON.stringify(appeal.json));
    assert.equal(appeal.json.status, 'open');
    const again = await api.call(`/api/rides/${appealRide}/appeal`, { body: { reason: 'once more' } });
    assert.equal(again.status, 409);
    assert.equal(again.json.code, 'appeal_exists');
    const open = await db.rideAppeal.count({ where: { rideId: appealRide, status: 'open' } });
    assert.equal(open, 1);
    assert.match(commitBlockReason(now, validation, open, 0) || '', /validation/);
    assert.match(commitBlockReason(validation, validation, open, 0) || '', /appeal/);
  } finally {
    await db.$disconnect();
  }
});
