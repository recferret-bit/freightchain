// Runs in the isolated probe container. Only this process owns the scratch player's signing key.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { Connection, Keypair, Transaction, SystemProgram } from '@solana/web3.js';
import { PoolProgramCodec } from './dist/infrastructure/solana/pool-program.codec.js';
import { POOL_PROGRAM_IDL } from './dist/infrastructure/solana/pool-program.idl.js';
import { sealRoad } from './scripts/localnet-seal.mjs';
const { RPC, BASE, KEYS } = process.env;
// Synchronous operator CLI calls can outlive an idle keepalive socket in this probe process.
const conn = new Connection(RPC, { commitment: 'confirmed', fetch: (url, init) => fetch(url, { ...init, headers: { ...init.headers, connection: 'close' } }) }), codec = new PoolProgramCodec(POOL_PROGRAM_IDL.address);
const key = name => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(`${KEYS}/${name}.json`))));
const admin = key('admin'), player = key('player');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const stateFile = '/tmp/production-chain.json';
let state = {}; try { state = JSON.parse(readFileSync(stateFile)); } catch {}
const save = () => writeFileSync(stateFile, JSON.stringify(state), { mode: 0o600 });
const headers = { 'content-type': 'application/json', host: 'api.freightchain.localhost', origin: 'https://freightchain.localhost', 'cf-ipcountry': 'CA' };
async function api(path, body, method) {
  const response = await fetch(`${BASE}/api/${path}`, { method: method || (body ? 'POST' : 'GET'), headers: { ...headers, ...(state.cookie ? { cookie: state.cookie } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(35000) });
  return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie') };
}
async function ok(path, body, method) { const result = await api(path, body, method); assert.equal(result.status, 200, `${path}: ${JSON.stringify(result)}`); return result.body; }
async function until(fn) { for (let n = 0; n < 90; n++) { const value = await fn(); if (value) return value; await sleep(1000); } throw new Error('condition timed out'); }
async function send(tx, signer = player) {
  tx.partialSign(signer); const signature = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false });
  await until(async () => { const s = (await conn.getSignatureStatuses([signature])).value[0]; assert(!s?.err, JSON.stringify(s?.err)); return ['confirmed', 'finalized'].includes(s?.confirmationStatus); });
  return signature;
}
const tool = args => JSON.parse(execFileSync('node', ['scripts/pool-admin.mjs', ...args, '--url', RPC], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim().split('\n').pop());
const ticket = async () => ((await ok('me')).tickets || []).find(t => t.poolId === state.pool);
async function prepare() {
  const order = await ok('tickets', { poolId: state.pool, qty: 1, burnWarningAccepted: true });
  const pay = await ok(`tickets/orders/${order.id}/payment`);
  state.order = order.id; state.transaction = pay.transaction; save();
}
const phase = process.argv[2];
if (phase === 'setup') {
  const latest = await conn.getLatestBlockhash();
  const fund = new Transaction({ feePayer: admin.publicKey, ...latest });
  for (const name of ['player', 'fee', 'seed']) fund.add(SystemProgram.transfer({ fromPubkey: admin.publicKey, toPubkey: key(name).publicKey, lamports: 5e9 }));
  await send(fund, admin);
  tool(['initialize', '-k', `${KEYS}/admin.json`, '--admin', admin.publicKey.toBase58(), '--platform-treasury', key('fee').publicKey.toBase58(), '--platform-fee-bps', '500']);
  // Keep the program's review/finish floors and the real one-hour ride length.
  tool(['set-pool-rules', '-k', `${KEYS}/admin.json`, '--split', '8500/500/1000', '--paid', 'true']);
  const created = tool(['create-pool', '-k', `${KEYS}/admin.json`, '--tier', '1h', '--price', '50000000', '--prep', '+3600', '--play', '+18000', '--payout', '+22000', '--per-wallet', '5', '--fee-treasury', key('fee').publicKey.toBase58(), '--seed-treasury', key('seed').publicKey.toBase58()]);
  state.pool = created.poolId; save();
  tool(['sponsor', '-k', `${KEYS}/admin.json`, '--pool', String(state.pool), '--lamports', '1000000000']);
  await sealRoad({ conn, codec, admintool: tool, id: state.pool, keyfile: `${KEYS}/admin.json` });
  await until(async () => (await api(`pools/${state.pool}`)).status === 200);
  assert.equal((await ok('tiers')).paymentMode, 'program');
  const nonce = await ok('auth/nonce', { wallet: player.publicKey.toBase58() });
  const signed = await api('auth/verify', { wallet: player.publicKey.toBase58(), signature: bs58.encode(nacl.sign.detached(new TextEncoder().encode(nonce.message), player.secretKey)) });
  assert.equal(signed.status, 200, JSON.stringify(signed)); assert.match(signed.cookie, /Secure/i);
  state.cookie = signed.cookie.split(';')[0]; save();
  const terms = await ok('profile/terms');
  assert.equal((await api('tickets', { poolId: state.pool, qty: 1, burnWarningAccepted: true })).status, 428);
  await ok('profile/terms', { termsVersion: terms.termsVersion, privacyVersion: terms.privacyVersion, age18: true, accepted: true });
  assert.equal((await api('tickets', { poolId: state.pool, qty: 1, burnWarningAccepted: true })).status, 409);
  await ok('profile/agreements', { age18: true, loss: true }, 'PUT');
  await prepare();
} else if (phase === 'send') {
  const transaction = Transaction.from(Buffer.from(state.transaction, 'base64'));
  assert.equal(transaction.feePayer.toBase58(), player.publicKey.toBase58());
  const existing = await conn.getAccountInfo(codec.ticketPda(state.pool, player.publicKey));
  const before = await conn.getBalance(player.publicKey), vaultBefore = await conn.getBalance(codec.vaultPda(state.pool));
  state.signature = await send(transaction); save();
  const receipt = await conn.getTransaction(state.signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
  const rent = existing ? 0 : await conn.getMinimumBalanceForRentExemption(87);
  assert.equal(before - await conn.getBalance(player.publicKey), 50000000 + rent + receipt.meta.fee);
  assert.equal(await conn.getBalance(codec.vaultPda(state.pool)) - vaultBefore, 50000000);
} else if (phase === 'credited') {
  const expected = Number(process.argv[3]);
  // Observe the watcher before calling confirm: this proves recovery without a client retry.
  await until(async () => { const t = await ticket(); return t?.bought === expected; });
  const account = await conn.getAccountInfo(codec.ticketPda(state.pool, player.publicKey));
  const chainTicket = codec.decodeAccount('Ticket', account.data);
  assert.equal(chainTicket.qty, expected); assert.equal(chainTicket.rentPayer, player.publicKey.toBase58());
  const before = await ticket();
  await until(async () => (await ok(`tickets/orders/${state.order}/confirm`, { signature: state.signature })).status === 'paid');
  await ok(`tickets/orders/${state.order}/confirm`, { signature: state.signature });
  assert.deepEqual(await ticket(), before, 'repeat confirm must not duplicate credit');
} else if (phase === 'refresh') {
  state.transaction = (await ok(`tickets/orders/${state.order}/payment`)).transaction; save();
} else if (phase === 'prepare') {
  await prepare();
} else if (phase === 'enforcement') {
  const ride = await ok('rides', { tier: '1h' }); state.ride = ride.id; save();
  const started = await ok(`rides/${ride.id}/start`, {});
  assert.equal(started.timeScale, 1); assert.equal(started.minSeconds, 3600); assert(started.completeDist >= 50400, 'normal one-hour finish distance'); assert.equal(started.trafficVersion, 1);
  const bad = await api(`rides/${ride.id}/batches`, { seq: 0, prevHash: ride.id, t0: 0, t1: 0.1, samples: [], inputs: [] });
  assert.equal(bad.status, 400, JSON.stringify(bad)); assert.match(JSON.stringify(bad.body), /batch-streams-invalid/);
  const ended = await ok(`rides/${ride.id}/end`, { outcome: 'shift', reason: 'production-rehearsal-invalid-finish', s: started.completeDist, t: 1, hull: 1 });
  assert.notEqual(ended.status, 'completed', 'unproved instant finish must fail closed');
} else if (phase === 'rpc-down') {
  const response = await api(`tickets/orders/${state.order}/payment`);
  assert.equal(response.status, 503, JSON.stringify(response));
  assert.equal((await ticket()).bought, 2);
} else if (phase === 'refund') {
  tool(['cancel-pool', '-k', `${KEYS}/admin.json`, '--pool', String(state.pool)]);
  await until(async () => (await ok(`pools/${state.pool}`)).status === 'refunding');
  const pay = await ok(`pools/${state.pool}/refund`);
  const before = await conn.getBalance(player.publicKey);
  const sig = await send(Transaction.from(Buffer.from(pay.transaction, 'base64'))); state.refundSignature = sig; save();
  const after = await conn.getBalance(player.publicKey);
  const fee = (await conn.getTransaction(sig, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 })).meta.fee;
  assert.equal(after - before + fee, 150000000 + await conn.getMinimumBalanceForRentExemption(87));
  await until(async () => (await ticket()) === undefined);
  assert.equal((await ok(`tickets/orders/${state.order}`)).status, 'refunded');
  await ok('chain/settle', { signature: sig });
  assert.equal(await ticket(), undefined);
} else throw new Error(`unknown phase ${phase}`);
console.log(JSON.stringify({ phase, passed: true, pool: state.pool, wallet: player.publicKey.toBase58(), signature: state.signature, ride: state.ride, refundSignature: state.refundSignature }));
