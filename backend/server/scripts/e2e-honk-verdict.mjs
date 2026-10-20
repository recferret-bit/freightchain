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
import { honkBalance, vaultBalance } from './honk-program.mjs';
import { driveVerified } from './honest-traffic.mjs';

const RPC = process.env.RPC, KEYS = process.env.KEYS, BASE = process.env.BASE;
const UNIT = 1_000_000n; // ledger strings are whole TEN4; the chain balance is base units
const fails = [];
const check = (name, ok, extra = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' – ' + extra : ''}`); if (!ok) fails.push(name); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex');
const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d;
const post = async (path, body, cookie, headers) => {
  const r = await fetch(`${BASE}/api/${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(cookie && { cookie }), ...headers }, body: JSON.stringify(body) });
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

function callOf(cookie, extraHeaders) {
  return async (method, path, body, headers) => {
    const fn = method === 'GET' ? get : post;
    if (method === 'GET') {
      const j = await get(path, cookie);
      return { status: 200, json: j };
    }
    const res = await post(path, body, cookie, { ...extraHeaders, ...headers });
    return { status: res.r.status, json: res.j };
  };
}

async function mintRow(rideId) {
  const db = new PrismaClient();
  try { return await db.honkMint.findUnique({ where: { rideId } }); }
  finally { await db.$disconnect(); }
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

await closeRunning(player);
if (fails.length) process.exit(1);

async function assertNoMint(label, driven, chainBefore) {
  if (!driven.end || driven.end.status !== 200) { check(label, false, driven.error || JSON.stringify(driven.end?.json).slice(0, 200)); return; }
  const end = driven.end.json;
  const past = end.status === 'completed' && end.distance + 1 >= end.completeDist * 0.2;
  const row = await mintRow(end.id);
  const chain = await honkBalance({ rpc: RPC, owner: player.kp.publicKey });
  check(`${label} completed past 20% with 0 TEN4`, past && !row && chain === chainBefore && end.honk?.pays === '0',
    `${end.status} d=${end.distance}/${end.completeDist} honk=${JSON.stringify(end.honk)} row=${row ? 'yes' : 'no'} chain ${chain - chainBefore} verdict=${end.verdict?.status}`);
}

const chain0 = await honkBalance({ rpc: RPC, owner: player.kp.publicKey });
const free = await driveVerified(callOf(player.cookie), { tier: 'free', level: 1 });
await assertNoMint('free training ride', free, chain0);

const agreed = await post('profile/agreements', { age18: true, loss: true }, player.cookie);
check('age agreement', agreed.r.ok, JSON.stringify(agreed.j).slice(0, 160));
const weekly = await driveVerified(callOf(player.cookie, { 'cf-ipcountry': 'CA' }), { tier: '1h' });
check('weekly grant ride', weekly.end?.json?.weeklyGrant === true, weekly.error || JSON.stringify(weekly.end?.json).slice(0, 200));
await assertNoMint('weekly grant ride', weekly, chain0);

const prisma = new PrismaClient();
try {
  await prisma.rideTicket.upsert({
    where: { wallet_poolId: { wallet: player.address, poolId: 1 } },
    create: { wallet: player.address, poolId: 1, balance: 1, bought: 1 },
    update: { balance: { increment: 1 }, bought: { increment: 1 } },
  });
} finally { await prisma.$disconnect(); }

const beforeChain = await honkBalance({ rpc: RPC, owner: player.kp.publicKey });
const beforeVault = await vaultBalance({ rpc: RPC });
const before = await get('honk', player.cookie);
const driven = await driveVerified(callOf(player.cookie), { tier: '1h' });
if (!driven.end || driven.end.status !== 200) {
  check('ride ended', false, driven.error || JSON.stringify(driven.end?.json).slice(0, 240));
  process.exit(1);
}
check('paid ride is demo-scaled', driven.ride.timeScale >= 60 && driven.ride.minSeconds <= 120, `timeScale ${driven.ride.timeScale} min ${driven.ride.minSeconds}`);
check('ride ended', driven.end.status === 200, JSON.stringify(driven.end.json).slice(0, 240));
const verdict = driven.end.json?.verdict;
check('verdict verified', verdict?.status === 'verified', JSON.stringify(verdict?.reasons ?? verdict).slice(0, 300));
const after = await get('honk', player.cookie);
const minted = BigInt(String(after.minted).split('.')[0]) - BigInt(String(before.minted ?? '0').split('.')[0]);
const chainDelta = (await honkBalance({ rpc: RPC, owner: player.kp.publicKey })) - beforeChain;
const chainExpect = 100n * UNIT;
check('ledger mint', minted === 100n, `${before.minted} -> ${after.minted}`);
check('chain mint matches', chainDelta === chainExpect && chainDelta === minted * UNIT, `chain ${chainDelta} ledger ${minted} TEN4`);
check('vault unchanged', (await vaultBalance({ rpc: RPC })) === beforeVault, String(beforeVault));
const again = await post(`rides/${driven.ride.id}/end`, { outcome: 'shift', s: 1, t: 1, hull: 100 }, player.cookie);
const chainAfter = await honkBalance({ rpc: RPC, owner: player.kp.publicKey });
check('second end does not mint', chainAfter - beforeChain === chainExpect, `again ${again.r.status} chain ${chainAfter - beforeChain}`);
if (fails.length) process.exit(1);
