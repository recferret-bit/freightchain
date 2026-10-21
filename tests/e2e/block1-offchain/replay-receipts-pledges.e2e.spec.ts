import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import bs58 from 'bs58';
import { apiTest, session, signInPlayer } from '../harness/api.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const require = createRequire(join(root, 'backend/server/package.json'));
const { PrismaClient } = require('@prisma/client');

function database() {
  const url = process.env.DATABASE_URL || '';
  assert.doesNotMatch(url, /\/freightchain(_test)?(\?|$)/);
  return new PrismaClient({ datasources: { db: { url } } });
}

async function raw(path) {
  const res = await fetch(`${process.env.E2E_BASE}${path}`);
  return { status: res.status, cache: res.headers.get('cache-control') || '', bytes: Buffer.from(await res.arrayBuffer()) };
}

apiTest(test, 'RPL-T-91..102 pledges stay off and receipts, cards, and blinks follow replay visibility', async () => {
  const db = database();
  const api = session();
  const driver = await signInPlayer(api);
  const now = new Date();
  const good = randomUUID();
  const training = randomUUID();
  const rejected = randomUUID();
  try {
    const pledge = await api.call(`/api/live/rides/${good}/pledge-intent`, { body: { lamportsPerKm: 1000, targetKm: 1 } });
    assert.equal(pledge.status, 403, JSON.stringify(pledge.json));
    assert.equal(pledge.json.code, 'pledges_disabled');
    const again = await api.call(`/api/live/rides/${good}/pledge-confirm`, { body: { pledgeId: 'none', signature: bs58.encode(Buffer.alloc(64, 4)) } });
    assert.equal(again.status, 403);
    assert.equal(again.json.code, 'pledges_disabled');

    const ride = (id, tier, status) => db.ride.create({
      data: {
        id, wallet: driver.wallet, tier, seed: 4, minSeconds: tier === '1h' ? 3600 : 180, completeDist: 1000, status,
        createdAt: now, startedAt: now, endedAt: now, lastHbAt: now, lastS: 1000, driveSeconds: tier === '1h' ? 3600 : 30,
      },
    });
    await ride(good, '1h', 'completed');
    await ride(training, 'free', 'completed');
    await ride(rejected, '1h', 'completed');
    await db.rideVerdict.create({ data: { rideId: good, status: 'verified', reasons: [], scores: {}, rulesVersion: 1, judgedAt: now } });
    await db.rideVerdict.create({ data: { rideId: rejected, status: 'rejected', reasons: [], scores: {}, rulesVersion: 1, judgedAt: now } });

    const page = await raw(`/r/${good}`);
    assert.equal(page.status, 200);
    assert.match(page.cache, /public,\s*max-age=86400/);
    assert.match(page.bytes.toString('utf8'), /og:title/);
    const card = await raw(`/api/rides/${good}/card.png`);
    assert.equal(card.status, 200);
    assert.match(card.cache, /public,\s*max-age=86400/);
    assert.equal(card.bytes[0], 0x89);
    const blink = await raw(`/api/actions/ride/${good}`);
    assert.equal(blink.status, 200);
    assert.match(blink.cache, /public,\s*max-age=86400/);
    assert.equal(JSON.parse(blink.bytes.toString('utf8')).type, 'action');

    for (const id of [training, rejected]) {
      assert.equal((await raw(`/r/${id}`)).status, 404);
      assert.equal((await raw(`/api/rides/${id}/card.png`)).status, 404);
      assert.equal((await raw(`/api/actions/ride/${id}`)).status, 404);
    }
  } finally {
    await db.ride.deleteMany({ where: { id: { in: [good, training, rejected] } } }).catch(() => undefined);
    await db.$disconnect();
  }
});
