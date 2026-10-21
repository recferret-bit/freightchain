import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import bs58 from 'bs58';
import { apiTest, session, signInPlayer } from '../harness/api.mjs';
import { signAndSend } from '../harness/wallet.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const require = createRequire(join(root, 'backend/server/package.json'));
const { PrismaClient } = require('@prisma/client');
const RPC = process.env.SOLANA_RPC || 'http://127.0.0.1:8898';

function database() {
  const url = process.env.DATABASE_URL || '';
  assert.doesNotMatch(url, /\/freightchain(_test)?(\?|$)/);
  return new PrismaClient({ datasources: { db: { url } } });
}

function split(lamports) {
  const treasury = Math.floor((lamports * 500) / 10_000);
  return { driver: lamports - treasury, treasury };
}

async function rpc(method, params) {
  const res = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || method);
  return json.result;
}

async function balance(address) {
  const result = await rpc('getBalance', [address, { commitment: 'confirmed' }]);
  return result.value;
}

const mockRpc = /:8898(\/|$)/.test(RPC) && !!process.env.TREASURY_PUBKEY;
apiTest(test, 'RPL-T-70..90 replay tips: bounds, 95/5 split, no gameplay, expiry, and donation history', async () => {
  const db = database();
  const driverApi = session();
  const driver = await signInPlayer(driverApi);
  const fanApi = session();
  const fan = await signInPlayer(fanApi);
  const now = new Date();
  const id = randomUUID();
  try {
    await db.ride.create({
      data: {
        id, wallet: driver.wallet, tier: '1h', seed: 9, minSeconds: 3600, completeDist: 1000, status: 'completed',
        createdAt: now, startedAt: now, endedAt: now, lastHbAt: now, lastS: 1000, driveSeconds: 3600,
      },
    });
    await db.rideVerdict.create({ data: { rideId: id, status: 'verified', reasons: [], scores: {}, rulesVersion: 1, judgedAt: now } });
    await fetch(`${RPC.replace(/\/$/, '')}/__mock/airdrop`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ wallet: fan.wallet, lamports: 5_000_000_000 }) });

    const small = await fanApi.call(`/api/watch/${id}/donation-orders`, { body: { effect: 'tip', lamports: 999_999 } });
    assert.equal(small.status, 400);
    assert.equal(small.json.code, 'donation_too_small');
    const large = await fanApi.call(`/api/watch/${id}/donation-orders`, { body: { effect: 'tip', lamports: 1_000_000_001 } });
    assert.equal(large.status, 400);
    assert.equal(large.json.code, 'donation_too_large');
    for (const effect of ['night', 'day', 'potholes', 'trench', 'sinkhole']) {
      const refused = await fanApi.call(`/api/watch/${id}/donation-orders`, { body: { effect, lamports: 10_000_000 } });
      assert.equal(refused.status, 400, effect);
      assert.equal(refused.json.code, 'donation_effect');
    }
    assert.equal((await fanApi.call(`/api/rides/${id}/effects/1/applied`, { body: { t: 1, s: 1, lat: 0 } })).status, 404);
    assert.equal((await fanApi.call(`/api/watch/${id}/honk/time`, { body: { phase: 'night' } })).status, 404);
    assert.equal((await fanApi.call(`/api/watch/${id}/honk/weather`, { body: { weather: 'snow' } })).status, 404);
    const self = await driverApi.call(`/api/watch/${id}/donation-orders`, { body: { effect: 'tip', lamports: 10_000_000 } });
    assert.equal(self.status, 400, JSON.stringify(self.json));
    assert.equal(self.json.code, 'own_ride');

    const amount = 10_000_000;
    const parts = split(amount);
    const beforeFan = await balance(fan.wallet);
    const beforeDriver = await balance(driver.wallet);
    const beforeTreasury = await balance(process.env.TREASURY_PUBKEY);
    const order = await fanApi.call(`/api/watch/${id}/donation-orders`, { body: { effect: 'tip', lamports: amount, note: 'nice haul' } });
    assert.equal(order.status, 200, JSON.stringify(order.json));
    assert.equal(order.json.order.lamports, amount);
    const sent = await signAndSend(fan, order.json.transaction.transaction, RPC);
    const chain = await rpc('getTransaction', [sent.signature, { encoding: 'jsonParsed', commitment: 'confirmed', maxSupportedTransactionVersion: 0 }]);
    const transfers = chain.transaction.message.instructions.filter((ix) => ix.parsed?.type === 'transfer').map((ix) => ix.parsed.info);
    assert.equal(transfers.length, 2);
    assert.deepEqual(transfers.map((row) => row.destination).sort(), [driver.wallet, process.env.TREASURY_PUBKEY].sort());
    assert.equal(transfers.find((row) => row.destination === driver.wallet).lamports, parts.driver);
    assert.equal(transfers.find((row) => row.destination === process.env.TREASURY_PUBKEY).lamports, parts.treasury);
    const paid = await fanApi.call(`/api/watch/${id}/donation-orders/${order.json.order.id}/confirm`, { body: { signature: sent.signature } });
    assert.equal(paid.status, 200, JSON.stringify(paid.json));
    assert.equal(paid.json.status, 'paid');
    assert.equal(await balance(driver.wallet), beforeDriver + parts.driver);
    assert.equal(await balance(process.env.TREASURY_PUBKEY), beforeTreasury + parts.treasury);
    assert.equal(await balance(fan.wallet), beforeFan - amount - 5000);
    const feed = await session().call(`/api/watch/${id}`);
    assert.equal(feed.json.events.some((event) => event.kind === 'donation' && event.lamports === amount), true);
    const sentList = await fanApi.call('/api/me/donations');
    const gotList = await driverApi.call('/api/me/donations');
    assert.equal(sentList.json.sent.some((row) => row.rideId === id && row.lamports === amount), true);
    assert.equal(gotList.json.received.some((row) => row.rideId === id && row.fromWallet === fan.wallet), true);

    for (const lamports of [50_000_000, 100_000_000, 2_000_000]) {
      const preset = await fanApi.call(`/api/watch/${id}/donation-orders`, { body: { effect: 'tip', lamports } });
      assert.equal(preset.status, 200, JSON.stringify(preset.json));
      assert.equal(preset.json.order.lamports, lamports);
    }
    const fourth = await fanApi.call(`/api/watch/${id}/donation-orders`, { body: { effect: 'tip', lamports: 1_000_000 } });
    assert.equal(fourth.status, 429, JSON.stringify(fourth.json));
    assert.equal(fourth.json.code, 'too_many_open_orders');
    const pending = await db.donationOrder.findFirst({ where: { rideId: id, wallet: fan.wallet, status: 'pending' } });
    assert.ok(pending);
    await db.donationOrder.update({ where: { id: pending.id }, data: { createdAt: new Date(Date.now() - 16 * 60 * 1000) } });
    const expired = await fanApi.call(`/api/watch/${id}/donation-orders/${pending.id}/confirm`, { body: { signature: bs58.encode(Buffer.alloc(64, 9)) } });
    assert.equal(expired.status, 409, JSON.stringify(expired.json));
    assert.equal(expired.json.code, 'donation_expired');
  } finally {
    await db.ride.deleteMany({ where: { id } }).catch(() => undefined);
    await db.$disconnect();
  }
}, { skip: mockRpc ? false : 'replay tips need SOLANA_RPC on :8898 and TREASURY_PUBKEY' });
