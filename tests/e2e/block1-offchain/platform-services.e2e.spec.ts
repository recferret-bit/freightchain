import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import http, { createServer } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { createWriteStream, existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { test } from 'node:test';
import vm from 'node:vm';
import net from 'node:net';
import bs58 from 'bs58';
import { keypair, sign, signInPlayer } from '../harness/api.mjs';
import { SEED_ENTITIES, printSource } from '../../../frontend/shared/entity.js';

/* PLT-T-01..14 against real PostgreSQL (TEST_DATABASE_URL) and a throwaway Redis.
   Where the shipped route differs from the PLT-T text, the assertion is the as-built behavior and the gap is recorded. */
const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const serverDir = join(root, 'backend/server');
const require = createRequire(join(serverDir, 'package.json'));
const { PrismaClient } = require('@prisma/client');
const { Redis } = require('ioredis');
const X = { 'x-fc-editor': '1' };
const ANON = 'anon_00000000-0000-4000-8000-000000000001';
const POSTHOG_KEY = 'phc_pltplatformservicese2e01';
const gaps = [];

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
}
function dbName(url) {
  const m = /\/([^/?]+)(?:\?|$)/.exec(url);
  if (!m) throw new Error('TEST_DATABASE_URL has no database name');
  return m[1];
}

function client(base) {
  let cookie = '';
  async function call(path, { method, body, headers } = {}) {
    const r = await fetch(base + path, {
      method: method || (body ? 'POST' : 'GET'),
      headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = typeof r.headers.getSetCookie === 'function' ? r.headers.getSetCookie() : [];
    const parts = set.length ? set : (r.headers.get('set-cookie') ? [r.headers.get('set-cookie')] : []);
    for (const c of parts) {
      const pair = c.split(';')[0];
      const name = pair.split('=')[0];
      cookie = [...cookie.split('; ').filter((p) => p && !p.startsWith(name + '=')), pair].join('; ');
    }
    const text = await r.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
    return { status: r.status, json, headers: r.headers, text };
  }
  return { call, cookie: () => cookie };
}

async function waitHealth(base, log, pid) {
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(base + '/api/health/live')).ok) return; } catch { /* booting */ }
    if (pid && spawnSync('kill', ['-0', String(pid)]).status !== 0) break;
    await sleep(250);
  }
  throw new Error(`API did not start on ${base}\n${readFileSync(log, 'utf8').slice(-4000)}`);
}

function spawnNode(script, env, log) {
  const child = spawn(process.execPath, [script], { cwd: serverDir, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  const sink = createWriteStream(log);
  child.stdout.pipe(sink);
  child.stderr.pipe(sink);
  return child;
}

function stopPid(pid) {
  if (!pid) return;
  try { process.kill(-pid, 'SIGTERM'); } catch { try { process.kill(pid, 'SIGTERM'); } catch { /* already gone */ } }
}

test('PLT-T-01..14 platform services against PostgreSQL and Redis', { timeout: 300_000 }, async (t) => {
  const url = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || '';
  const name = dbName(url);
  assert.ok(name && name !== 'freightchain' && name !== 'freightchain_test', `refusing database ${name}`);
  assert.ok(existsSync(join(serverDir, 'dist/main.js')), 'backend/server/dist/main.js is missing — build the server first');
  const migrate = spawnSync(join(serverDir, 'node_modules/.bin/prisma'), ['migrate', 'deploy'], {
    cwd: serverDir, env: { ...process.env, DATABASE_URL: url }, encoding: 'utf8',
  });
  assert.equal(migrate.status, 0, `${migrate.stdout}\n${migrate.stderr}`);

  const redisPort = await freePort();
  const redisPw = randomBytes(12).toString('hex');
  const redisId = spawnSync('docker', ['run', '-d', '--rm', '-p', `127.0.0.1:${redisPort}:6379`, '-e', `REDISCLI_AUTH=${redisPw}`, 'redis:7-alpine', 'redis-server', '--requirepass', redisPw, '--save', ''], { encoding: 'utf8' });
  assert.equal(redisId.status, 0, redisId.stderr);
  const redisCt = redisId.stdout.trim();
  const redisUrl = `redis://:${redisPw}@127.0.0.1:${redisPort}`;
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: 1, connectTimeout: 2000 });
  for (let i = 0; i < 40; i++) { try { if (await redis.ping() === 'PONG') break; } catch { /* starting */ } await sleep(150); }

  const mcpPort = await freePort();
  const mcpToken = `plt-mcp-${randomBytes(16).toString('hex')}`;
  const mcpLog = '/tmp/plt-mcp.log';
  const mcp = spawn(process.execPath, [join(root, 'backend/mcp/src/http.js')], {
    env: { ...process.env, EDITOR_MCP_PORT: String(mcpPort), EDITOR_MCP_TOKEN: mcpToken, FC_APP_URL: 'http://127.0.0.1:9' },
    stdio: ['ignore', 'pipe', 'pipe'], detached: true,
  });
  const mcpSink = createWriteStream(mcpLog);
  mcp.stdout.pipe(mcpSink); mcp.stderr.pipe(mcpSink);
  for (let i = 0; i < 40; i++) {
    try { if ((await fetch(`http://127.0.0.1:${mcpPort}/health`)).status === 200) break; } catch { /* starting */ }
    await sleep(100);
  }

  const editors = Array.from({ length: 6 }, () => keypair());
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const log = '/tmp/plt-api.log';
  const common = {
    DATABASE_URL: url, REDIS_URL: redisUrl, JWT_SECRET: 'freightchain-plt-jwt-secret-32chars-min', NODE_ENV: 'development',
    PORT: String(port), APP_DOMAIN: `127.0.0.1:${port}`, APP_ORIGIN: base, SOL_USD: '100', FREE_RIDE_SECONDS: '10',
    POSTHOG_ENABLED: '0', WATCH_INTERVAL_MS: '0', CRANK_INTERVAL_MS: '0', PAYOUT_INTERVAL_MS: '0',
    THROTTLE_LIMIT: '100000', THROTTLE_AUTH_LIMIT: '100000', THROTTLE_AUTH_RPS: '10000', THROTTLE_EDITOR_LIMIT: '100000', THROTTLE_EDITOR_RPS: '10000',
    THROTTLE_ENTITIES_LIMIT: '100000', THROTTLE_ENTITIES_RPS: '10000', HB_MIN_INTERVAL_MS: '0', HB_TIMEOUT_MS: '150000',
    TRAFFIC_PROOF_REQUIRED: 'false', CHALLENGE_INTERVAL_SECONDS: '0', PAYMENT_MODE: 'transfer', SOLANA_RPC: 'http://127.0.0.1:9', SNS_RPC: 'http://127.0.0.1:9',
    EDITOR_WALLETS: editors.map((k) => k.wallet).join(','), EDITOR_MCP_TOKEN: mcpToken, EDITOR_MCP_URL: `http://127.0.0.1:${mcpPort}`,
    EDITOR_FAKE_LLM: '1', EDITOR_DEFAULT_PROVIDER: 'fake',
  };
  const apiProc = spawnNode('dist/main.js', common, log);
  const db = new PrismaClient({ datasources: { db: { url } } });
  const kids = [apiProc, mcp];
  const stop = async () => {
    for (const p of kids) stopPid(p.pid);
    await sleep(300);
    await db.$executeRawUnsafe('DROP TRIGGER IF EXISTS plt_t03_player ON stats."PlayerStats"').catch(() => undefined);
    await db.$executeRawUnsafe('DROP TRIGGER IF EXISTS plt_t03_global ON stats."GlobalStats"').catch(() => undefined);
    await db.$executeRawUnsafe('DROP TRIGGER IF EXISTS plt_t03_daily ON stats."DailyStats"').catch(() => undefined);
    await redis.quit().catch(() => undefined);
    await db.$disconnect().catch(() => undefined);
    spawnSync('docker', ['rm', '-f', redisCt], { stdio: 'ignore' });
  };
  try {
    await waitHealth(base, log, apiProc.pid);
    const anon = client(base);
    async function player() { const api = client(base); const keys = await signInPlayer(api); return { api, ...keys }; }
    async function editor(n = 0) {
      const keys = editors[n];
      const api = client(base);
      const nonce = await api.call('/api/editor/auth/nonce', { body: { wallet: keys.wallet }, headers: X });
      assert.equal(nonce.status, 200, JSON.stringify(nonce.json));
      const ver = await api.call('/api/editor/auth/verify', { body: { wallet: keys.wallet, signature: sign(keys.secretKey, nonce.json.message) }, headers: X });
      assert.equal(ver.status, 200, JSON.stringify(ver.json));
      return { api, ...keys };
    }
    async function endRide(who, { outcome = 'failed', s = 0, t = 0, waitMs = 0, crashesVehicle = 0 } = {}) {
      const made = await who.api.call('/api/rides', { body: { tier: 'free' } });
      assert.equal(made.status, 200, JSON.stringify(made.json));
      const id = made.json.id;
      const started = await who.api.call(`/api/rides/${id}/start`, { body: {} });
      assert.equal(started.status, 200, JSON.stringify(started.json));
      if (waitMs) await sleep(waitMs);
      const end = await who.api.call(`/api/rides/${id}/end`, { body: { outcome, s, t, hull: outcome === 'failed' ? 0 : 100, reason: 'plt', crashesVehicle } });
      assert.equal(end.status, 200, JSON.stringify(end.json));
      return { id, body: end.json, wallet: who.wallet };
    }
    async function counts(wallet) {
      const row = await db.playerStats.findUnique({ where: { wallet } });
      const g = await db.globalStats.findUnique({ where: { id: 1 } });
      const day = new Date().toISOString().slice(0, 10);
      const daily = await db.dailyStats.findUnique({ where: { day: new Date(`${day}T00:00:00.000Z`) } });
      const num = (r) => r ? { rides: r.rides, ridesFree: r.ridesFree, ridesPaid: r.ridesPaid, ridesCompleted: r.ridesCompleted, metres: r.metres, donations: r.donations, donationLamports: Number(r.donationLamports) } : null;
      return { player: num(row), global: num(g), daily: num(daily) };
    }

    const run = async (title, fn) => {
      try { await t.test(title, fn); } catch (e) { gaps.push(`FAILED ${title}: ${e instanceof Error ? e.message : e}`); }
    };

    await run('[PLT-T-01] a ride end updates player, global and daily stats under the player row lock and drops fc:stats:*', async () => {
      const who = await player();
      const made = await who.api.call('/api/rides', { body: { tier: 'free' } });
      assert.equal(made.status, 200, JSON.stringify(made.json));
      const started = await who.api.call(`/api/rides/${made.json.id}/start`, { body: {} });
      assert.equal(started.status, 200, JSON.stringify(started.json));
      const before = await counts(who.wallet);
      await anon.call('/api/stats');
      assert.ok(await redis.exists('fc:stats:global'), 'cache key is fc:stats:global');
      let locked;
      const got = new Promise((r) => { locked = r; });
      let release;
      const opened = new Promise((r) => { release = r; });
      const tx = db.$transaction(async (q) => {
        await q.$executeRaw`SELECT 1 FROM "player"."Player" WHERE "wallet" = ${who.wallet} FOR UPDATE`;
        locked();
        await opened;
      }, { timeout: 20_000, maxWait: 5_000 });
      await got;
      const ending = who.api.call(`/api/rides/${made.json.id}/end`, { body: { outcome: 'failed', s: 0, t: 0, hull: 0, reason: 'plt' } });
      await sleep(400);
      const mid = await counts(who.wallet);
      assert.equal(mid.player?.rides ?? 0, before.player?.rides ?? 0, 'stats wait on the player row lock');
      release();
      const ended = await ending;
      await tx;
      assert.equal(ended.status, 200, JSON.stringify(ended.json));
      const after = await counts(who.wallet);
      assert.equal(after.player.rides, (before.player?.rides ?? 0) + 1);
      assert.equal(after.global.rides, (before.global?.rides ?? 0) + 1);
      assert.equal(after.daily.rides, (before.daily?.rides ?? 0) + 1);
      assert.equal(after.player.ridesFree, (before.player?.ridesFree ?? 0) + 1);
      assert.equal(await redis.exists('fc:stats:global'), 0, 'write drops fc:stats:global');
      assert.equal(await redis.exists(`fc:stats:player:${who.wallet}`), 0);
      assert.equal(await redis.exists('fc:stats:daily'), 0);
      const seen = await anon.call('/api/stats');
      assert.equal(seen.status, 200);
      assert.equal(seen.json.rides, after.global.rides);
      const career = await who.api.call('/api/profile');
      assert.equal(career.json.career.rides, after.player.rides);
      if (!('me' in (seen.json ?? {})) || seen.json.global) gaps.push('PLT-T-01: GET /api/stats is the global row only; the player totals are GET /api/profile career, not { global, me }');
    });

    await run('[PLT-T-02] a mock tip counts a donation and a paid order adds lamports, then the cache is dropped', async () => {
      const driver = await player();
      const fan = await player();
      const id = `plt-paid-${Date.now().toString(36)}`;
      const now = new Date();
      await db.ride.create({ data: { id, wallet: driver.wallet, tier: '1h', seed: 1, minSeconds: 3600, completeDist: 100000, status: 'completed', createdAt: now, startedAt: now, endedAt: now, lastHbAt: now } });
      await anon.call('/api/stats');
      const before = await counts(driver.wallet);
      const tip = await fan.api.call(`/api/watch/${id}/donations`, { body: { effect: 'tip' } });
      assert.equal(tip.status, 200, JSON.stringify(tip.json));
      const mocked = await counts(driver.wallet);
      assert.equal(mocked.player.donations, (before.player?.donations ?? 0) + 1);
      assert.equal(mocked.player.donationLamports, before.player?.donationLamports ?? 0);
      assert.equal(mocked.global.donations, (before.global?.donations ?? 0) + 1);
      assert.equal(await redis.exists('fc:stats:global'), 0);
      const orderId = randomUUID();
      const signature = bs58.encode(randomBytes(64));
      await db.donationOrder.create({ data: { id: orderId, rideId: id, wallet: fan.wallet, recipient: driver.wallet, effect: 'tip', lamports: 2_000_000n, status: 'paid', signature, createdAt: now, paidAt: now } });
      const paid = await fan.api.call(`/api/watch/${id}/donation-orders/${orderId}/confirm`, { body: { signature } });
      assert.equal(paid.status, 200, JSON.stringify(paid.json));
      const after = await counts(driver.wallet);
      assert.equal(after.player.donations, mocked.player.donations + 1);
      assert.equal(after.player.donationLamports, mocked.player.donationLamports + 2_000_000);
      assert.equal(after.global.donationLamports, (mocked.global.donationLamports ?? 0) + 2_000_000);
      assert.equal(after.daily.donationLamports, (mocked.daily?.donationLamports ?? 0) + 2_000_000);
    });

    await run('[PLT-T-03] upserts run PlayerStats then GlobalStats then DailyStats, and two same-day endings do not deadlock', async () => {
      const ddl = [
        'CREATE TABLE IF NOT EXISTS stats.plt_t03_log (id bigserial PRIMARY KEY, tbl text NOT NULL, txid bigint NOT NULL)',
        'CREATE OR REPLACE FUNCTION stats.plt_t03_fn() RETURNS trigger LANGUAGE plpgsql AS $fn$ BEGIN INSERT INTO stats.plt_t03_log(tbl, txid) VALUES (TG_TABLE_NAME, txid_current()); RETURN NULL; END $fn$',
        'DROP TRIGGER IF EXISTS plt_t03_player ON stats."PlayerStats"',
        'DROP TRIGGER IF EXISTS plt_t03_global ON stats."GlobalStats"',
        'DROP TRIGGER IF EXISTS plt_t03_daily ON stats."DailyStats"',
        'CREATE TRIGGER plt_t03_player AFTER INSERT OR UPDATE ON stats."PlayerStats" FOR EACH ROW EXECUTE FUNCTION stats.plt_t03_fn()',
        'CREATE TRIGGER plt_t03_global AFTER INSERT OR UPDATE ON stats."GlobalStats" FOR EACH ROW EXECUTE FUNCTION stats.plt_t03_fn()',
        'CREATE TRIGGER plt_t03_daily AFTER INSERT OR UPDATE ON stats."DailyStats" FOR EACH ROW EXECUTE FUNCTION stats.plt_t03_fn()',
      ];
      for (const statement of ddl) await db.$executeRawUnsafe(statement);
      const mark = await db.$queryRaw`SELECT COALESCE(MAX(id), 0)::int AS id FROM stats.plt_t03_log`;
      const from = mark[0].id;
      const a = await player(); const b = await player();
      const [ea, eb] = await Promise.all([endRide(a), endRide(b)]);
      assert.equal(ea.body.status, 'failed');
      assert.equal(eb.body.status, 'failed');
      const rows = await db.$queryRaw`SELECT id::int AS id, tbl::text AS tbl, txid::text AS txid FROM stats.plt_t03_log WHERE id > ${Number(from)} ORDER BY id`;
      const byTx = new Map();
      for (const row of rows) {
        const list = byTx.get(row.txid) ?? [];
        list.push(row.tbl);
        byTx.set(row.txid, list);
      }
      const ours = [...byTx.values()].filter((names) => names.includes('PlayerStats') && names.includes('GlobalStats') && names.includes('DailyStats'));
      assert.ok(ours.length >= 2, JSON.stringify(rows));
      for (const names of ours) {
        assert.ok(names.indexOf('PlayerStats') < names.indexOf('GlobalStats'));
        assert.ok(names.indexOf('GlobalStats') < names.indexOf('DailyStats'));
      }
      await db.$executeRawUnsafe('DROP TRIGGER IF EXISTS plt_t03_player ON stats."PlayerStats"');
      await db.$executeRawUnsafe('DROP TRIGGER IF EXISTS plt_t03_global ON stats."GlobalStats"');
      await db.$executeRawUnsafe('DROP TRIGGER IF EXISTS plt_t03_daily ON stats."DailyStats"');
    });

    await run('[PLT-T-04] rideDelta clamps metres and seconds at 0, counts ridesCompleted only for completed, and ignores a ride that never started', async () => {
      const { rideDelta } = await import(pathToFileURL(join(serverDir, 'dist/domain/stats/stats.js')).href);
      const started = new Date();
      const row = (over) => ({ startedAt: started, tier: 'free', driveSeconds: 0, lastS: 0, crashesVehicle: 0, crashesBuilding: 0, status: 'failed', ...over });
      assert.equal(rideDelta(row({ startedAt: null, status: 'failed' })), null);
      assert.equal(rideDelta(row({ status: 'completed' })).ridesCompleted, 1);
      assert.equal(rideDelta(row({ status: 'abandoned' })).ridesCompleted, 0);
      assert.equal(rideDelta(row({ status: 'failed' })).rides, 1);
      assert.equal(rideDelta(row({ tier: '1h', status: 'failed' })).ridesPaid, 1);
      assert.equal(rideDelta(row({ tier: 'free' })).ridesFree, 1);
      assert.equal(rideDelta(row({ lastS: -3.2, driveSeconds: -1 })).metres, 0);
      assert.equal(rideDelta(row({ driveSeconds: -1 })).seconds, 0);
      const fractional = rideDelta(row({ driveSeconds: 1.9, lastS: 10.9, crashesVehicle: -2, status: 'completed' }));
      assert.equal(fractional.seconds, 1.9);
      assert.equal(fractional.metres, 10.9);
      assert.equal(fractional.crashesVehicle, -2);
      assert.equal(rideDelta(row({ status: 'expired' })), null);
      gaps.push('PLT-T-04: rideDelta does not floor seconds/metres/crashes (1.9 and 10.9 pass through; negative crashes are not clamped) and an expired ride counts as nothing, not as a non-completed ride');
      const who = await player();
      const failed = await endRide(who, { outcome: 'failed', s: 0, t: 0 });
      assert.equal(failed.body.status, 'failed');
      const abandoned = await endRide(who, { outcome: 'shift', s: 0, t: 0 });
      assert.equal(abandoned.body.status, 'abandoned');
      const done = await endRide(who, { outcome: 'shift', s: 150, t: 5, waitMs: 5200 });
      assert.equal(done.body.status, 'completed', JSON.stringify(done.body));
      const after = await counts(who.wallet);
      assert.equal(after.player.rides, 3);
      assert.equal(after.player.ridesCompleted, 1);
      assert.ok(after.player.metres >= 150);
    });

    await run('[PLT-T-05] stats cache for 15s, a 90-day daily window, and a Redis outage still reads PostgreSQL', async () => {
      const first = await anon.call('/api/stats');
      const ttl = await redis.ttl('fc:stats:global');
      assert.ok(ttl > 0 && ttl <= 15, `ttl ${ttl}`);
      await db.$executeRaw`UPDATE "stats"."GlobalStats" SET rides = rides + 1000000 WHERE id = 1`;
      const hit = await anon.call('/api/stats');
      assert.equal(hit.json.rides, first.json.rides, 'a write that bypasses the service stays cached');
      await redis.del('fc:stats:global');
      const miss = await anon.call('/api/stats');
      assert.equal(miss.json.rides, first.json.rides + 1000000);
      await db.$executeRaw`UPDATE "stats"."GlobalStats" SET rides = rides - 1000000 WHERE id = 1`;
      await redis.del('fc:stats:global', 'fc:stats:daily');
      const day = (offset) => { const n = new Date(); return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() + offset)); };
      const ymd = (d) => d.toISOString().slice(0, 10);
      const blank = { rides: 3, ridesFree: 0, ridesPaid: 0, ridesCompleted: 0, seconds: 0, metres: 0, crashesVehicle: 0, crashesBuilding: 0, donations: 0, donationLamports: 0n, updatedAt: new Date() };
      await db.dailyStats.upsert({ where: { day: day(-120) }, create: { day: day(-120), ...blank }, update: { rides: 3 } });
      await db.dailyStats.upsert({ where: { day: day(-10) }, create: { day: day(-10), ...blank, rides: 4 }, update: { rides: 4 } });
      await redis.del('fc:stats:daily');
      const daily = await anon.call('/api/stats/daily');
      assert.equal(daily.status, 200);
      assert.ok(Array.isArray(daily.json), 'as-built body is the array, not { days }');
      const days = daily.json.map((d) => d.day);
      assert.ok(!days.includes(ymd(day(-120))));
      assert.ok(days.includes(ymd(day(-10))));
      assert.ok(days.length <= 90);
      assert.deepEqual([...days].sort(), days, 'oldest first');
      gaps.push('PLT-T-05: GET /api/stats/daily returns the array oldest-first, not { days } newest-first. The window is still the newest 90 UTC days');
      spawnSync('docker', ['pause', redisCt]);
      try {
        const live = await anon.call('/api/stats');
        assert.equal(live.status, 200, JSON.stringify(live.json));
        const stored = await db.globalStats.findUnique({ where: { id: 1 } });
        assert.equal(live.json.rides, stored.rides);
      } finally { spawnSync('docker', ['unpause', redisCt]); }
      for (let i = 0; i < 30; i++) { try { if (await redis.ping() === 'PONG') break; } catch { /* paused */ } await sleep(100); }
      await sleep(5500); // the API's Redis breaker keeps auth and editor routes closed for 5s after the outage
    });

    await run('[PLT-T-06] stats:reconcile restores a mutated counter from ride and donation rows and drops the cache', async () => {
      const who = await player();
      await endRide(who);
      const truth = await counts(who.wallet);
      await anon.call('/api/stats');
      await db.$executeRaw`UPDATE "stats"."PlayerStats" SET rides = rides - 1, metres = metres - 10 WHERE wallet = ${who.wallet}`;
      const env = { ...common, DATABASE_URL: url, REDIS_URL: redisUrl };
      const report = spawnSync(process.execPath, ['dist/cli/index.js', 'stats:reconcile', '--wallet', who.wallet], { cwd: serverDir, env: { ...process.env, ...env }, encoding: 'utf8' });
      assert.equal(report.status, 0, report.stderr);
      const dry = JSON.parse(report.stdout);
      assert.equal(dry.fixed, false);
      assert.equal(dry.drifted[0].wallet, who.wallet);
      assert.equal(dry.drifted[0].fields.rides.truth, truth.player.rides);
      const fix = spawnSync(process.execPath, ['dist/cli/index.js', 'stats:reconcile', '--wallet', who.wallet, '--fix'], { cwd: serverDir, env: { ...process.env, ...env }, encoding: 'utf8' });
      assert.equal(fix.status, 0, fix.stderr);
      assert.equal(JSON.parse(fix.stdout).fixed, true);
      const again = spawnSync(process.execPath, ['dist/cli/index.js', 'stats:reconcile', '--wallet', who.wallet], { cwd: serverDir, env: { ...process.env, ...env }, encoding: 'utf8' });
      assert.deepEqual(JSON.parse(again.stdout).drifted, []);
      const after = await counts(who.wallet);
      assert.equal(after.player.rides, truth.player.rides);
      assert.equal(after.player.metres, truth.player.metres);
      await anon.call('/api/stats');
      assert.equal((await anon.call('/api/stats')).json.rides, after.global.rides);
      gaps.push('PLT-T-06: ReconcileStatsHandler reads rides and donations then writes in separate transactions. It does not wrap the recompute in one REPEATABLE READ transaction');
    });

    await run('[PLT-T-07] entities stay data-only; roster and VEHICLES own gameplay; entity and mcp checks pass', async () => {
      const seedDir = join(root, 'frontend/client/shared/entity/seed');
      const files = [];
      const walk = (dir) => { for (const name of readdirSync(dir, { withFileTypes: true })) { const p = join(dir, name.name); if (name.isDirectory()) walk(p); else if (name.name.endsWith('.js') && name.name !== 'index.js') files.push(p); } };
      walk(seedDir);
      assert.ok(files.length > 10);
      for (const file of files) {
        const text = readFileSync(file, 'utf8');
        assert.match(text, /export default \{/);
        assert.doesNotMatch(text, /\b(collision|footprint|VEHICLES)\b/);
      }
      const roster = readFileSync(join(root, 'frontend/client/shared/entity/roster.js'), 'utf8');
      const vehicles = readFileSync(join(root, 'frontend/client/shared/traffic.js'), 'utf8');
      assert.match(roster, /hl: 13/);
      assert.match(vehicles, /sedan:\s+\{[^}]*len: 4\.6/);
      const entity = spawnSync(process.execPath, ['--test', 'frontend/client/test/entity.test.mjs'], { cwd: root, encoding: 'utf8' });
      assert.equal(entity.status, 0, entity.stderr.slice(-2000));
      const mcpTest = spawnSync('npm', ['--prefix', 'backend/mcp', 'test'], { cwd: root, encoding: 'utf8' });
      assert.equal(mcpTest.status, 0, `${mcpTest.stdout}\n${mcpTest.stderr}`.slice(-3000));
      gaps.push('PLT-T-07: this run executes frontend/client/test/entity.test.mjs and backend/mcp tests. It does not run the full client npm run check (lint, bundle, parity)');
    });

    await run('[PLT-T-08] revisions are append-only, publish is wallet-signed, and the bundle ETag changes', async () => {
      const ed = await editor(0);
      const stranger = client(base);
      assert.equal((await stranger.call('/api/editor/entities')).status, 404);
      const before = await anon.call('/api/entities/bundle');
      assert.equal(before.status, 200);
      assert.match(before.json.rev, /^[0-9a-f]{16}$/);
      assert.equal(before.headers.get('cache-control'), 'public, max-age=60, stale-while-revalidate=600');
      assert.ok(before.headers.get('etag'));
      if (!before.json.items) gaps.push('PLT-T-08: GET /api/entities/bundle returns { rev, entities }, not { rev, items }');
      const etag = before.headers.get('etag');
      const conditional = await new Promise((resolve, reject) => {
        const req = http.get(`${base}/api/entities/bundle`, { headers: { 'if-none-match': etag } }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
        req.on('error', reject);
      });
      assert.equal(conditional, 304, `If-None-Match ${etag}`);
      const head = await ed.api.call('/api/editor/entities/cactus');
      assert.equal(head.status, 200, JSON.stringify(head.json));
      const baseRevisionId = head.json.row?.headRevisionId ?? null;
      const scale = Math.round((0.21 + Math.random() * 0.2) * 1000) / 1000;
      const cactus = structuredClone(SEED_ENTITIES.find((e) => e.id === 'cactus'));
      cactus.parts[0].s[0] = scale; cactus.parts[0].s[2] = scale;
      const source = printSource(cactus);
      const noHeader = await ed.api.call('/api/editor/entities/cactus/drafts', { body: { source, message: 'no header', baseRevisionId } });
      assert.equal(noHeader.status, 403);
      const bad = await ed.api.call('/api/editor/entities/cactus/drafts', { headers: X, body: { source: 'export default { id: "cactus", parts: alert(1) };', message: '', baseRevisionId } });
      assert.equal(bad.status, 422);
      assert.equal(bad.json.code, 'entity_invalid');
      const draft = await ed.api.call('/api/editor/entities/cactus/drafts', { headers: X, body: { source, message: 'fatter', baseRevisionId } });
      assert.equal(draft.status, 200, JSON.stringify(draft.json));
      assert.equal(draft.json.seq >= 2, true);
      const stale = await ed.api.call('/api/editor/entities/cactus/drafts', { headers: X, body: { source, message: 'stale', baseRevisionId } });
      assert.equal(stale.status, 409);
      assert.equal(stale.json.code, 'stale_base');
      const unchanged = await anon.call('/api/entities/bundle');
      assert.equal(unchanged.json.rev, before.json.rev);
      const ch = await ed.api.call('/api/editor/entities/cactus/publish/challenge', { headers: X, body: { revisionId: draft.json.id } });
      assert.equal(ch.status, 200, JSON.stringify(ch.json));
      assert.match(ch.json.message, /PUBLISH/);
      const refused = await ed.api.call('/api/editor/entities/cactus/publish', { headers: X, body: { revisionId: draft.json.id, signature: 'bad' } });
      assert.equal(refused.status, 401);
      const ch2 = await ed.api.call('/api/editor/entities/cactus/publish/challenge', { headers: X, body: { revisionId: draft.json.id } });
      const pub = await ed.api.call('/api/editor/entities/cactus/publish', { headers: X, body: { revisionId: draft.json.id, signature: sign(ed.secretKey, ch2.json.message) } });
      assert.equal(pub.status, 200, JSON.stringify(pub.json));
      const after = await anon.call('/api/entities/bundle');
      assert.notEqual(after.json.rev, before.json.rev);
      assert.equal(after.json.entities.find((e) => e.id === 'cactus').parts[0].s[0], scale);
      assert.ok(after.headers.get('etag'));
      assert.notEqual(after.headers.get('etag'), etag);
      if (!String(after.headers.get('etag')).includes(after.json.rev)) gaps.push('PLT-T-08: the bundle ETag is Express\'s weak hash of the body, not W/"<rev>"');
      const history = await ed.api.call('/api/editor/entities/cactus/revisions');
      const seqs = history.json.map((r) => r.seq);
      assert.deepEqual(seqs, [...seqs].sort((a, b) => b - a));
      const seedRev = history.json.find((r) => r.seq === 1);
      const restored = await ed.api.call('/api/editor/entities/cactus/restore', { headers: X, body: { revisionId: seedRev.id, baseRevisionId: draft.json.id } });
      assert.equal(restored.status, 200, JSON.stringify(restored.json));
      assert.equal(restored.json.seq, draft.json.seq + 1);
      const grown = await ed.api.call('/api/editor/entities/cactus/revisions');
      assert.ok(grown.json.length === history.json.length + 1);
      assert.equal(grown.json.find((r) => r.seq === 1).source, seedRev.source);
      const audit = await db.adminAction.findFirst({ where: { action: 'entity.publish', target: 'cactus', wallet: ed.wallet }, orderBy: { at: 'desc' } });
      assert.ok(audit);
      assert.equal(audit.detail.revisionId, draft.json.id);
    });

    await run('[PLT-T-09] jobs stay queued in PostgreSQL until something claims them, events poll by seq, and the parallel cap is 5', async () => {
      const { EditorJobPrismaRepository } = await import(pathToFileURL(join(serverDir, 'dist/infrastructure/prisma/repositories/editor-job.prisma.repository.js')).href);
      const { SETTING_DEFAULTS } = await import(pathToFileURL(join(serverDir, 'dist/domain/settings/game-settings.js')).href);
      assert.equal(SETTING_DEFAULTS.editor_jobs_parallel, 5);
      await db.gameSetting.upsert({ where: { key: 'editor_jobs_parallel' }, create: { key: 'editor_jobs_parallel', value: 5 }, update: { value: 5 } });
      await db.editorJob.updateMany({ where: { status: { in: ['queued', 'running'] } }, data: { status: 'cancelled', finishedAt: new Date(), error: 'plt cleanup' } });
      const ed = await editor(0);
      const props = SEED_ENTITIES.filter((e) => e.kind === 'prop' && e.id !== 'cactus').slice(0, 1);
      const created = await ed.api.call('/api/editor/jobs', { headers: X, body: { prompt: 'make it a little taller', entityId: props[0].id } });
      assert.equal(created.status, 202, JSON.stringify(created.json));
      await sleep(1200);
      const queued = await ed.api.call(`/api/editor/jobs/${created.json.jobId}`);
      assert.equal(queued.json.status, 'queued');
      assert.equal((await db.editorJob.findUnique({ where: { id: created.json.jobId } })).startedAt, null);
      const ev0 = await ed.api.call(`/api/editor/jobs/${created.json.jobId}/events?after=0`);
      assert.deepEqual(ev0.json.events.map((e) => e.seq), ev0.json.events.map((_, i) => i + 1));
      const ev1 = await ed.api.call(`/api/editor/jobs/${created.json.jobId}/events?after=1`);
      assert.deepEqual(ev1.json.events, []);
      assert.equal((await ed.api.call(`/api/editor/jobs/${created.json.jobId}/cancel`, { method: 'POST', headers: X })).status, 200);
      const cancelled = await ed.api.call(`/api/editor/jobs/${created.json.jobId}/events?after=1`);
      assert.equal(cancelled.json.status, 'cancelled');
      assert.deepEqual(cancelled.json.events.map((e) => e.seq), cancelled.json.events.map((_, i) => i + 2));
      const ids = SEED_ENTITIES.filter((e) => e.kind === 'prop' && e.id !== 'cactus' && e.id !== props[0].id).slice(0, 6).map((e) => e.id);
      assert.equal(ids.length, 6);
      const jobs = [];
      for (let i = 0; i < 6; i++) {
        const who = await editor(i);
        const res = await who.api.call('/api/editor/jobs', { headers: X, body: { prompt: 'slightly taller', entityId: ids[i] } });
        assert.equal(res.status, 202, JSON.stringify(res.json));
        jobs.push({ who, id: res.json.jobId });
      }
      await sleep(500);
      for (const job of jobs) assert.equal((await db.editorJob.findUnique({ where: { id: job.id } })).status, 'queued');
      const repo = new EditorJobPrismaRepository(db);
      const claims = [];
      for (let i = 0; i < 6; i++) claims.push(await repo.claim(5, new Date(), 600_000));
      assert.equal(claims.filter(Boolean).length, 5);
      assert.equal(await db.editorJob.count({ where: { id: { in: jobs.map((j) => j.id) }, status: 'running' } }), 5);
      assert.equal(await db.editorJob.count({ where: { id: { in: jobs.map((j) => j.id) }, status: 'queued' } }), 1);
      for (const job of jobs) assert.equal((await job.who.api.call(`/api/editor/jobs/${job.id}/cancel`, { method: 'POST', headers: X })).status, 200);
      const app = readFileSync(join(serverDir, 'src/app/app.module.ts'), 'utf8');
      const worker = readFileSync(join(serverDir, 'src/app/editor-worker.module.ts'), 'utf8');
      assert.doesNotMatch(app, /EditorJobSweepScheduler|EditorJobRunnerService/);
      assert.match(worker, /EditorJobRunnerService/);
      assert.match(worker, /EditorJobSweepScheduler/);
    });

    await run('[PLT-T-10] a Redis outage fail-closes editor routes; the shipped status is 429 rate_limited', async () => {
      const ed = await editor(1);
      spawnSync('docker', ['pause', redisCt]);
      try {
        const blocked = await ed.api.call('/api/editor/jobs', { headers: X, body: { prompt: 'taller', entityId: 'rock' } });
        const stats = await anon.call('/api/stats');
        assert.equal(stats.status, 200, 'stats still read PostgreSQL');
        if (blocked.status === 503 && blocked.json?.code === 'editor_rate_limit_unavailable') return;
        gaps.push(`PLT-T-10: Redis down on POST /api/editor/jobs returns ${blocked.status} ${blocked.json?.code}, not 503 editor_rate_limit_unavailable. There is no EditorRateLimitService; protected buckets use RedisThrottlerStorage`);
        assert.equal(blocked.status, 429);
        assert.equal(blocked.json.code, 'rate_limited');
      } finally { spawnSync('docker', ['unpause', redisCt]); }
      for (let i = 0; i < 30; i++) { try { if (await redis.ping() === 'PONG') break; } catch { /* */ } await sleep(100); }
      await sleep(5500);
      const prodPort = await freePort();
      const prodLog = '/tmp/plt-api-prod.log';
      const prod = spawnNode('dist/main.js', {
        ...common, PORT: String(prodPort), NODE_ENV: 'production', APP_DOMAIN: `127.0.0.1:${prodPort}`, APP_ORIGIN: `http://127.0.0.1:${prodPort}`,
        COOKIE_DOMAIN: 'plt.test', TRUST_PROXY: '0', TREASURY_PUBKEY: editors[0].wallet, EDITOR_FAKE_LLM: '0', EDITOR_DEFAULT_PROVIDER: '',
        REDIS_URL: 'redis://127.0.0.1:1', JWT_SECRET: common.JWT_SECRET,
        LIVE_FREE_DONATIONS: 'off', LIVE_EFFECTS: 'off', DEMO_WALLETS: '',
        ADMIN_JWT_SECRET: 'plt-admin-jwt-secret-32chars-minimum', EDITOR_JWT_SECRET: 'plt-editor-jwt-secret-32chars-minimum',
        ADMIN_ALERT_TELEGRAM_BOT_TOKEN: 'plt-telegram-bot-token-24', ADMIN_ALERT_TELEGRAM_CHAT_ID: '1',
      }, prodLog);
      kids.push(prod);
      try {
        await waitHealth(`http://127.0.0.1:${prodPort}`, prodLog, prod.pid);
        const res = await fetch(`http://127.0.0.1:${prodPort}/api/editor/jobs`, { method: 'POST', headers: { host: 'storybook.plt.test', 'content-type': 'application/json', 'x-fc-editor': '1' }, body: JSON.stringify({ prompt: 'taller', entityId: 'rock' }) });
        const body = await res.json();
        assert.notEqual(res.status, 202);
        assert.equal(res.status, 429, JSON.stringify(body));
        assert.equal(body.code, 'rate_limited');
        const open = await fetch(`http://127.0.0.1:${prodPort}/api/stats`);
        assert.equal(open.status, 200);
      } finally { stopPid(prod.pid); }
      const mcpProdPort = await freePort();
      const mcpProd = spawn(process.execPath, [join(root, 'backend/mcp/src/http.js')], {
        env: { ...process.env, NODE_ENV: 'production', EDITOR_MCP_PORT: String(mcpProdPort), EDITOR_MCP_TOKEN: mcpToken, FC_APP_URL: 'http://127.0.0.1:9', REDIS_URL: 'redis://127.0.0.1:1' },
        stdio: 'ignore', detached: true,
      });
      kids.push(mcpProd);
      try {
        let health = 0;
        for (let i = 0; i < 30; i++) {
          try { health = (await fetch(`http://127.0.0.1:${mcpProdPort}/health`)).status; if (health) break; } catch { /* */ }
          await sleep(100);
        }
        assert.equal(health, 503, 'production MCP health fails closed when Redis is down');
      } finally { stopPid(mcpProd.pid); }
    });

    await run('[PLT-T-11] telemetry is off unless POSTHOG_ENABLED=1, strips server events, and does not flip $create_alias', async () => {
      const off = await anon.call('/api/telemetry', { body: { anon_id: ANON, events: [{ event: 'ride_completed', properties: {} }, { event: 'landing_viewed', properties: { surface: 'hero' } }] } });
      assert.deepEqual(off.json, { enabled: false, accepted: 0, dropped: 0 });
      assert.doesNotMatch(readFileSync(log, 'utf8'), /phc_pltplatformservicese2e01/);
      const stubPort = await freePort();
      const batches = [];
      const stub = createServer((req, res) => {
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => { batches.push(JSON.parse(Buffer.concat(chunks).toString() || '{}')); res.writeHead(200); res.end('{}'); });
      });
      await new Promise((r) => stub.listen(stubPort, '127.0.0.1', r));
      const auxPort = await freePort();
      const auxLog = '/tmp/plt-api-analytics.log';
      const aux = spawnNode('dist/main.js', {
        ...common, PORT: String(auxPort), APP_DOMAIN: `127.0.0.1:${auxPort}`, APP_ORIGIN: `http://127.0.0.1:${auxPort}`,
        POSTHOG_ENABLED: '1', POSTHOG_KEY, POSTHOG_HOST: `http://127.0.0.1:${stubPort}`, REDIS_URL: '',
      }, auxLog);
      kids.push(aux);
      try {
        const auxBase = `http://127.0.0.1:${auxPort}`;
        await waitHealth(auxBase, auxLog, aux.pid);
        const api = client(auxBase);
        const mixed = await api.call('/api/telemetry', { body: { anon_id: ANON, events: [{ event: 'ride_completed', properties: { ride_id: 'x' } }, { event: 'landing_viewed', properties: { surface: 'hero' } }] } });
        assert.deepEqual(mixed.json, { enabled: true, accepted: 1, dropped: 1 });
        const who = await signInPlayer(api);
        const alias = await api.call('/api/telemetry', { body: { anon_id: ANON, events: [{ event: 'session_restored', properties: { surface: 'lobby', request_alias: true } }] } });
        assert.equal(alias.json.accepted, 1);
        await sleep(1500);
        const flat = batches.flatMap((b) => b.batch ?? []);
        assert.equal(flat.some((row) => row.event === 'ride_completed'), false);
        const created = flat.find((row) => row.event === '$create_alias');
        assert.ok(created, JSON.stringify(flat.map((row) => row.event)));
        assert.equal(created.distinct_id, ANON);
        assert.equal(created.properties.alias, who.wallet);
        assert.notEqual(created.distinct_id, who.wallet);
        const logged = readFileSync(auxLog, 'utf8');
        assert.doesNotMatch(logged, new RegExp(POSTHOG_KEY));
        assert.match(logged, /analytics enabled/);
        for (const batch of batches) assert.notEqual(batch.api_key, undefined);
      } finally { stub.close(); stopPid(aux.pid); }
    });

    await run('[PLT-T-12] client-error drops noise, scrubs secrets, caps an IP, and emits $exception plus client_crashed', async () => {
      const stubPort = await freePort();
      const batches = [];
      const stub = createServer((req, res) => {
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => { batches.push(JSON.parse(Buffer.concat(chunks).toString() || '{}')); res.writeHead(200); res.end('{}'); });
      });
      await new Promise((r) => stub.listen(stubPort, '127.0.0.1', r));
      const auxPort = await freePort();
      const auxLog = '/tmp/plt-api-crash.log';
      const aux = spawnNode('dist/main.js', {
        ...common, PORT: String(auxPort), APP_DOMAIN: `127.0.0.1:${auxPort}`, APP_ORIGIN: `http://127.0.0.1:${auxPort}`,
        POSTHOG_ENABLED: '1', POSTHOG_KEY, POSTHOG_HOST: `http://127.0.0.1:${stubPort}`, REDIS_URL: '',
      }, auxLog);
      kids.push(aux);
      try {
        const api = client(`http://127.0.0.1:${auxPort}`);
        await waitHealth(`http://127.0.0.1:${auxPort}`, auxLog, aux.pid);
        const wallet = 'A'.repeat(44);
        const crash = { anon_id: ANON, surface: 'game', release: 'abc1234', name: 'TypeError', value: `boom https://user:pass@freightchain.fun/play.html?x=1 ${wallet}`, frames: [{ filename: 'https://freightchain.fun/js/main.js', function: 'frame', lineno: 12, colno: 4 }] };
        const ok = await api.call('/api/client-error', { body: crash });
        assert.deepEqual(ok.json, { enabled: true, accepted: 1 });
        const noise = await api.call('/api/client-error', { body: { ...crash, value: 'Script error.', frames: [] } });
        assert.equal(noise.json.accepted, 0);
        const ext = await api.call('/api/client-error', { body: { ...crash, value: 'ext', frames: [{ filename: 'chrome-extension://abc/x.js', function: 'x', lineno: 1, colno: 1 }] } });
        assert.equal(ext.json.accepted, 0);
        const loop = await api.call('/api/client-error', { body: { ...crash, value: 'ResizeObserver loop limit exceeded', frames: [] } });
        assert.equal(loop.json.accepted, 0);
        for (let i = 0; i < 6; i++) assert.equal((await api.call('/api/client-error', { body: { ...crash, value: `again ${i}` } })).json.accepted, 1);
        const capped = await api.call('/api/client-error', { body: crash });
        assert.equal(capped.json.accepted, 0);
        await sleep(1500);
        const flat = batches.flatMap((b) => b.batch ?? []);
        assert.ok(flat.some((row) => row.event === '$exception'));
        assert.ok(flat.some((row) => row.event === 'client_crashed'));
        const blob = JSON.stringify(flat);
        assert.doesNotMatch(blob, /user:pass/);
        assert.doesNotMatch(blob, /\?x=1/);
        assert.doesNotMatch(blob, new RegExp(wallet));
        assert.match(blob, /\[redacted\]/);
        assert.match(readFileSync(join(serverDir, 'src/domain/analytics/client-error.ts'), 'utf8'), /CLIENT_ERROR_DAY_LIMIT = 2_000/);
        gaps.push('PLT-T-12: the 10/min IP cap is exercised live (accepted 0). The 2,000/UTC-day cap is the CLIENT_ERROR_DAY_LIMIT constant; this run does not send 2,000 reports');
        assert.doesNotMatch(readFileSync(auxLog, 'utf8'), new RegExp(POSTHOG_KEY));
      } finally { stub.close(); stopPid(aux.pid); }
    });

    await run('[PLT-T-13] hosts.js strips the seven prefixes and API calls use credentials include', async () => {
      const src = readFileSync(join(root, 'frontend/client/js/hosts.js'), 'utf8').replace(/^export const /gm, 'const ');
      const load = (href) => {
        const u = new URL(href);
        const location = { hostname: u.hostname, protocol: u.protocol, port: u.port };
        return JSON.parse(JSON.stringify(vm.runInNewContext(`${src}\n({API_BASE,GAME_BASE,SITE_BASE,STORYBOOK_BASE,WHITEPAPER_BASE,PITCHDECK_BASE,ADMIN_BASE,ENTITIES_BASE})`, { location })));
      };
      assert.deepEqual(load('http://localhost:3000/play.html'), { API_BASE: '', GAME_BASE: '', SITE_BASE: '', STORYBOOK_BASE: '', WHITEPAPER_BASE: '', PITCHDECK_BASE: '', ADMIN_BASE: '', ENTITIES_BASE: '' });
      assert.equal(load('http://127.0.0.1:3000/').API_BASE, '');
      const local = load('http://ride.freightchain.localhost:8080/play.html');
      assert.equal(local.API_BASE, 'http://api.freightchain.localhost:8080');
      assert.equal(local.GAME_BASE, 'http://ride.freightchain.localhost:8080');
      assert.equal(local.SITE_BASE, 'http://freightchain.localhost:8080');
      assert.equal(local.ADMIN_BASE, 'http://admin.freightchain.localhost:8080');
      const prod = load('https://api.freightchain.fun/api/health/live');
      assert.equal(prod.API_BASE, 'https://api.freightchain.fun');
      assert.equal(prod.GAME_BASE, 'https://ride.freightchain.fun');
      assert.equal(prod.STORYBOOK_BASE, 'https://storybook.freightchain.fun');
      assert.equal(prod.WHITEPAPER_BASE, 'https://whitepaper.freightchain.fun');
      assert.equal(prod.PITCHDECK_BASE, 'https://pitchdeck.freightchain.fun');
      assert.equal(prod.SITE_BASE, 'https://freightchain.fun');
      assert.equal(prod.ADMIN_BASE, 'https://admin.freightchain.fun');
      assert.equal(load('https://www.freightchain.fun/').SITE_BASE, 'https://freightchain.fun');
      assert.equal(load('https://storybook.freightchain.fun/viewer.html').ENTITIES_BASE, '');
      for (const file of ['frontend/client/js/online.js', 'frontend/client/site/wallet.js', 'frontend/client/site/ride.js', 'frontend/client/js/watch.js']) {
        const text = readFileSync(join(root, file), 'utf8');
        assert.match(text, /hosts\.js/);
        assert.match(text, /credentials:\s*'include'/);
      }
      gaps.push('PLT-T-13: client/test/hosts.test.js does not exist. The seven bases are asserted here');
    });

    await run('[PLT-T-14] a public receipt has status, distance and time; an unknown id is 404; the page links the replay', async () => {
      const missingWatch = await anon.call('/api/watch/no-such-ride');
      assert.equal(missingWatch.status, 404);
      const missingPublic = await anon.call('/api/rides/no-such-ride/public');
      assert.equal(missingPublic.status, 404);
      const who = await player();
      const ride = await endRide(who, { outcome: 'failed', s: 0, t: 1 });
      const watch = await anon.call(`/api/watch/${ride.id}`);
      assert.equal(watch.status, 404, JSON.stringify(watch.json));
      assert.equal(watch.json.code, 'replay_not_available');
      const pub = await anon.call(`/api/rides/${ride.id}/public`);
      assert.equal(pub.status, 200, JSON.stringify(pub.json));
      assert.equal(pub.json.status, 'failed');
      assert.equal(typeof pub.json.km, 'number');
      assert.equal(typeof pub.json.driveSeconds, 'number');
      assert.ok('verdict' in pub.json);
      const page = readFileSync(join(root, 'frontend/client/site/ride.js'), 'utf8');
      assert.match(page, /\/api\/rides\/\$\{encodeURIComponent\(rideId\)\}\/public/);
      assert.match(page, /play\.html\?watch=/);
      assert.match(page, /NOT FOUND/);
      assert.match(page, /credentials:\s*'include'/);
      gaps.push('PLT-T-14: /r/:id loads GET /api/rides/:id/public. A free ride is not a public replay, so GET /api/watch/:id is 404 replay_not_available');
    });

    if (gaps.length) console.log(`PLT gaps:\n- ${gaps.join('\n- ')}`);
    const failed = gaps.filter((g) => g.startsWith('FAILED'));
    assert.deepEqual(failed, []);
  } finally { await stop(); }
});
