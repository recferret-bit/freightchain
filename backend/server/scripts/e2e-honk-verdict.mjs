// A short verified paid ride on the suite's server. The shift is demo-scaled (DEMO_WALLETS=* DEMO_SCALE=60).
// The recording is hash-chained and takes the server's holes. A verified verdict credits the ledger, then mint_ride
// pays the same amount to the rider. The pool vault does not move. A second pass does not mint again.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { Keypair } from '@solana/web3.js';
import { PrismaClient } from '@prisma/client';
import { honestRoad } from './road-damage.mjs';
import { honkBalance, vaultBalance } from './honk-program.mjs';

const RPC = process.env.RPC, KEYS = process.env.KEYS, BASE = process.env.BASE;
const UNIT = 1_000_000n; // ledger strings are whole TEN4; the chain balance is base units
const fails = [];
const check = (name, ok, extra = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' – ' + extra : ''}`); if (!ok) fails.push(name); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex');
const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d;
const post = async (path, body, cookie) => {
  const r = await fetch(`${BASE}/api/${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(cookie && { cookie }) }, body: JSON.stringify(body) });
  const text = await r.text();
  let j = {};
  try { j = text ? JSON.parse(text) : {}; } catch { j = { raw: text }; }
  return { r, j };
};
const get = async (path, cookie) => {
  const r = await fetch(`${BASE}/api/${path}`, { headers: cookie ? { cookie } : {} });
  return r.json();
};

function walletOf(file) {
  const kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(join(KEYS, file), 'utf8'))));
  const naclKp = nacl.sign.keyPair.fromSeed(kp.secretKey.slice(0, 32));
  return { kp, naclKp, address: bs58.encode(naclKp.publicKey) };
}

async function signIn(w) {
  const { j } = await post('auth/nonce', { wallet: w.address });
  const signature = bs58.encode(nacl.sign.detached(new TextEncoder().encode(j.message), w.naclKp.secretKey));
  const { r } = await post('auth/verify', { wallet: w.address, signature });
  return { ...w, cookie: r.headers.get('set-cookie')?.split(';')[0] };
}

async function drive(p) {
  const made = await post('rides', { tier: '1h' }, p.cookie);
  if (!made.r.ok) return { error: `${made.r.status} ${JSON.stringify(made.j).slice(0, 200)}` };
  const ride = made.j;
  await post(`rides/${ride.id}/start`, {}, p.cookie);
  const d = { id: ride.id, t: 0, s: 0, seq: 0, prevHash: ride.id, samples: [], inputs: [], bt0: 0, prompts: [], road: honestRoad(BASE, ride.id) };
  const row = (t, s, v) => [round(t, 2), round(s, 1), 2.4, 0, round(v, 2), Math.round(900 + v * 50), 6, 100, 0.6, 0, 0, 0, 12, 1 | 2 | 8];
  const cut = async () => {
    await d.road.take(d.samples);
    const base = { seq: d.seq++, prevHash: d.prevHash, t0: round(d.bt0, 2), t1: round(d.t, 2), samples: d.samples, inputs: d.inputs };
    const text = JSON.stringify(base);
    const hash = sha256(text);
    d.prevHash = hash; d.samples = []; d.inputs = []; d.bt0 = d.t;
    await post(`rides/${d.id}/batches`, { ...base, hash }, p.cookie);
  };
  const heartbeat = async () => {
    const { j } = await post(`rides/${d.id}/heartbeat`, { s: d.s, t: d.t, hull: 100, paused: false, night: false }, p.cookie);
    const c = j?.challenge;
    if (c && !d.prompts.some((x) => x.id === c.id)) {
      d.prompts.push(c);
      const at = round(c.issuedMs + 450 + Math.random() * 700, 1);
      d.inputs.push([at, c.codes[0], 1], [round(at + 70 + Math.random() * 120, 1), c.codes[0], 0]);
    }
  };
  if (!(ride.timeScale >= 60) || ride.minSeconds > 120) return { error: `shift is not demo-scaled (timeScale ${ride.timeScale}, minSeconds ${ride.minSeconds})` };
  const speed = 20, seconds = Math.max(70, (ride.minSeconds ?? 60) + 5);
  const line = Math.max(ride.completeDist ?? 0, 100) + 30;
  let wall = Date.now(), lastBeat = 0, gasDown = false, nextKey = 600, t0 = Date.now();
  for (;;) {
    await sleep(100);
    const now = Date.now(), dt = (now - wall) / 1000; wall = now;
    d.t += dt; d.s += speed * dt;
    d.samples.push(row(d.t, d.s, speed));
    const ms = now - t0;
    if (ms >= nextKey) {
      if (!gasDown) { d.inputs.push([round(ms, 1), 'KeyW', 1]); gasDown = true; nextKey = ms + 1500 + Math.random() * 3000; }
      else {
        d.inputs.push([round(ms, 1), 'KeyW', 0]); gasDown = false;
        const tap = Math.random() < 0.5 ? 'KeyA' : 'KeyD';
        const at = round(ms + 100 + Math.random() * 300, 1);
        d.inputs.push([at, tap, 1], [round(at + 120 + Math.random() * 400, 1), tap, 0]);
        nextKey = ms + 400 + Math.random() * 900;
      }
    }
    if (d.t - d.bt0 >= 15) await cut();
    if (now - lastBeat >= 5000) { lastBeat = now; await heartbeat(); }
    if (d.t >= seconds && d.s >= line) break;
  }
  await cut();
  await heartbeat();
  const end = await post(`rides/${d.id}/end`, { outcome: 'shift', s: d.s, t: d.t, hull: 100 }, p.cookie);
  return { id: d.id, end };
}

// The headless session leaves its paid ride running. A second POST /api/rides for this wallet is 409 until that one ends.
// Failed does not mint. A created ride is resumed by the drive below, so only a running one is closed here.
async function closeRunning(p) {
  const db = new PrismaClient();
  let rows = [];
  try {
    rows = await db.ride.findMany({ where: { wallet: p.address, status: 'running' }, select: { id: true, lastS: true, lastT: true } });
  } finally { await db.$disconnect(); }
  for (const row of rows) {
    const end = await post(`rides/${row.id}/end`, { outcome: 'failed', s: row.lastS, t: row.lastT, hull: 100, reason: 'suite handoff' }, p.cookie);
    check('open ride closed', end.r.ok, `${row.id} ${end.r.status} ${JSON.stringify(end.j).slice(0, 160)}`);
  }
}

if (!RPC || !KEYS || !BASE || !process.env.DATABASE_URL) {
  console.error('verdict needs RPC, KEYS, BASE and DATABASE_URL');
  process.exit(2);
}

const player = await signIn(walletOf('player.json'));
const prisma = new PrismaClient();
try {
  await prisma.rideTicket.upsert({
    where: { wallet_poolId: { wallet: player.address, poolId: 1 } },
    create: { wallet: player.address, poolId: 1, balance: 1, bought: 1 },
    update: { balance: { increment: 1 }, bought: { increment: 1 } },
  });
} finally { await prisma.$disconnect(); }

await closeRunning(player);
if (fails.length) process.exit(1);

const beforeChain = await honkBalance({ rpc: RPC, owner: player.kp.publicKey });
const beforeVault = await vaultBalance({ rpc: RPC });
const before = await get('honk', player.cookie);
const driven = await drive(player);
if (!driven.end) {
  check('ride ended', false, driven.error || 'drive returned no end');
  process.exit(1);
}
check('ride ended', driven.end.r.ok, JSON.stringify(driven.end.j).slice(0, 240));
const verdict = driven.end.j?.verdict;
check('verdict verified', verdict?.status === 'verified', JSON.stringify(verdict?.reasons ?? verdict ?? driven.end.j).slice(0, 300));
const after = await get('honk', player.cookie);
const minted = BigInt(String(after.minted).split('.')[0]) - BigInt(String(before.minted ?? '0').split('.')[0]);
const chainDelta = (await honkBalance({ rpc: RPC, owner: player.kp.publicKey })) - beforeChain;
const chainExpect = 100n * UNIT;
check('ledger mint', minted === 100n, `${before.minted} -> ${after.minted}`);
check('chain mint matches', chainDelta === chainExpect && chainDelta === minted * UNIT, `chain ${chainDelta} ledger ${minted} TEN4`);
check('vault unchanged', (await vaultBalance({ rpc: RPC })) === beforeVault, String(beforeVault));
const again = await post(`rides/${driven.id}/end`, { outcome: 'shift', s: 1, t: 1, hull: 100 }, player.cookie);
const chainAfter = await honkBalance({ rpc: RPC, owner: player.kp.publicKey });
check('second end does not mint', chainAfter - beforeChain === chainExpect, `again ${again.r.status} chain ${chainAfter - beforeChain}`);
if (fails.length) process.exit(1);
