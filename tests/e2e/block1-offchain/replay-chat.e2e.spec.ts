import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { apiTest, devAdmin, session, sign, signInAdmin, signInPlayer } from '../harness/api.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const require = createRequire(join(root, 'backend/server/package.json'));
const { PrismaClient } = require('@prisma/client');

function database() {
  const url = process.env.DATABASE_URL || '';
  assert.doesNotMatch(url, /\/freightchain(_test)?(\?|$)/);
  return new PrismaClient({ datasources: { db: { url } } });
}

async function publicRide(db, wallet) {
  const id = randomUUID();
  const now = new Date();
  await db.ride.create({
    data: {
      id, wallet, tier: '1h', seed: 7, minSeconds: 3600, completeDist: 1000, status: 'completed',
      createdAt: now, startedAt: now, endedAt: now, lastHbAt: now, lastS: 1000, driveSeconds: 120,
    },
  });
  await db.rideVerdict.create({ data: { rideId: id, status: 'verified', reasons: [], scores: {}, rulesVersion: 1, judgedAt: now } });
  return id;
}

apiTest(test, 'RPL-T-61..69 replay chat binds replayT, filters, rate-limits, hides, bans, and keeps tips past 90 days', async () => {
  const db = database();
  const driverApi = session();
  const driver = await signInPlayer(driverApi);
  const fanApi = session();
  const fan = await signInPlayer(fanApi);
  const admin = session();
  const adminKeys = devAdmin();
  await signInAdmin(admin, adminKeys);
  const adminPost = (path, body) => {
    const nonce = randomUUID();
    const timestamp = String(Date.now());
    const canonical = body === undefined ? '' : JSON.stringify(body);
    const text = ['127.0.0.1', adminKeys.wallet, 'POST', path.toLowerCase(), createHash('sha256').update(canonical).digest('hex'), nonce, timestamp].join('\n');
    return admin.call(path, {
      method: 'POST',
      body,
      headers: { 'x-fc-admin': '1', 'x-fc-admin-sig': sign(adminKeys.secretKey, text), 'x-fc-admin-nonce': nonce, 'x-fc-admin-ts': timestamp },
    });
  };
  const ids = [];
  try {
    const id = await publicRide(db, driver.wallet);
    ids.push(id);
    const late = await fanApi.call(`/api/watch/${id}/messages`, { body: { text: 'at the end', replayT: 40 } });
    assert.equal(late.status, 200, JSON.stringify(late.json));
    assert.equal(late.json.replayT, 40);
    const early = await fanApi.call(`/api/watch/${id}/messages`, { body: { text: 'at the start', replayT: 10 } });
    assert.equal(early.status, 200, JSON.stringify(early.json));
    const watched = await session().call(`/api/watch/${id}`);
    assert.equal(watched.status, 200, JSON.stringify(watched.json));
    const lines = watched.json.events.filter((event) => event.kind === 'message').map((event) => event.replayT);
    assert.deepEqual(lines, [10, 40]);

    assert.equal((await fanApi.call(`/api/watch/${id}/messages`, { body: { text: 'x'.repeat(201), replayT: 1 } })).status, 400);
    for (const text of ['see http://evil.test', 'https://evil.test/a', 'buy.example.com', 't.me/freight']) {
      const refused = await fanApi.call(`/api/watch/${id}/messages`, { body: { text, replayT: 1 } });
      assert.equal(refused.status, 400, text);
      assert.equal(refused.json.code, 'chat_link_forbidden');
    }
    const word = await fanApi.call(`/api/watch/${id}/messages`, { body: { text: 'this is a scam', replayT: 1 } });
    assert.equal(word.status, 400);
    assert.equal(word.json.code, 'chat_word_forbidden');
    const ok = await fanApi.call(`/api/watch/${id}/messages`, { body: { text: 'a'.repeat(200), replayT: 2 } });
    assert.equal(ok.status, 200, JSON.stringify(ok.json));

    let limited = null;
    for (let n = 0; n < 4; n++) {
      const sent = await fanApi.call(`/api/watch/${id}/messages`, { body: { text: `more ${n}`, replayT: 3 } });
      if (sent.status === 429) limited = sent;
      else assert.equal(sent.status, 200, JSON.stringify(sent.json));
    }
    if (!limited) limited = await fanApi.call(`/api/watch/${id}/messages`, { body: { text: 'one too many', replayT: 3 } });
    assert.equal(limited.status, 429, JSON.stringify(limited.json));
    assert.equal(limited.json.code, 'live_rate_limited');

    const hidePath = `/api/admin/chat/${early.json.id}/hide`;
    const hide = await adminPost(hidePath);
    assert.equal(hide.status, 200, JSON.stringify(hide.json));
    const afterHide = await session().call(`/api/watch/${id}`);
    assert.equal(afterHide.json.events.some((event) => event.id === early.json.id), false);

    const other = session();
    const banned = await signInPlayer(other);
    const before = await other.call(`/api/watch/${id}/messages`, { body: { text: 'hello there', replayT: 4 } });
    assert.equal(before.status, 200, JSON.stringify(before.json));
    const ban = await adminPost(`/api/admin/wallets/${banned.wallet}/chat-ban`, { ban: true });
    assert.equal(ban.status, 200, JSON.stringify(ban.json));
    const blocked = await other.call(`/api/watch/${id}/messages`, { body: { text: 'still here', replayT: 4 } });
    assert.equal(blocked.status, 403, JSON.stringify(blocked.json));
    assert.equal(blocked.json.code, 'chat_banned');

    const old = new Date(Date.now() - 91 * 24 * 60 * 60 * 1000);
    await db.rideEvent.update({ where: { id: late.json.id }, data: { createdAt: old } });
    const tip = await db.rideEvent.create({
      data: { rideId: id, wallet: fan.wallet, kind: 'donation', effect: 'tip', text: 'kept', lamports: 1_000_000n, slotKey: `paid:keep-${id}`, slot: 0, createdAt: old },
    });
    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const purged = await db.rideEvent.deleteMany({ where: { rideId: id, kind: 'message', createdAt: { lt: cutoff } } });
    assert.ok(purged.count >= 1);
    assert.ok(await db.rideEvent.findUnique({ where: { id: tip.id } }));
    const left = await session().call(`/api/watch/${id}`);
    assert.equal(left.json.events.some((event) => event.id === late.json.id), false);
    assert.equal(left.json.events.some((event) => event.id === tip.id && event.kind === 'donation'), true);
  } finally {
    await db.ride.deleteMany({ where: { id: { in: ids } } }).catch(() => undefined);
    await db.$disconnect();
  }
});
