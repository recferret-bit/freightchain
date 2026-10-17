// THE AUTONOMOUS DAY of the escrow program v2 on a LOCAL chain – phase 3 of .claude/skills/localnet-e2e/run.sh (SCENARIO=day, part of `all`). A fresh
// validator holds the program + the 1h SERIES the admin wrote with the real set_series in phase 1 (its sale window – the cadence – shortened in the dump,
// the only edit: a validator's clock cannot be moved); its own server + database with the payout key (PAYOUT_SECRET) and the crank on its SCHEDULE
// (CRANK_INTERVAL_MS) – nobody runs the crank. Explained in docs/localnet-e2e/index.html ("The autonomous day").
//   0. before the slot: no pool, a hand-sent open_next_pool is TooEarly, the payout job refuses (the program names no payout key)
//   1. the admin's last signatures: set_payout_authority (the payout key), a DISABLED 4h series (open_next_pool → SeriesDisabled); the payout key may not
//      create_pool / set_series / cancel_pool (Unauthorized)
//   2. the crank opens the pool of the slot BY ITSELF (PoolCreated.from_series, deadlines from the series' grid, the crank paid the rents, GET /api/pools)
//      and – program v4 (L4) – seals its road a few seconds later (seal_road from the first SlotHashes entry at or after the pool's target slot)
//   3. riders buy (the lobby in Chrome + Node wallets, each −(price + fee + Ticket rent) exactly) and ride over the player API: honest ×5, one FLAGGED
//      (an unhashed batch), one cheater (a teleport → REJECTED), one buyer who takes a ride and never drives it
//   4. the sale ends: a buy is TooLate on chain and 409 on the API; the crank opens (and seals) the NEXT slot's pool, one rider buys – it will miss its minimum
//   5. the play deadline: v4 (H5-B) the payout job takes the pool now – the pool-level marks, then it waits for every ride to be decided (waiting_review);
//      nothing pays before a winners root (WinnersNotCommitted), the payout key cannot close or veto; a signed admin HOLD; the admin decides every ride
//      (signed); the job says `held`; release → R8 starts its ride too late (closed) → the job attests each PLEDGED RIDE (RideAttestation, H4) and COMMITS
//      the plan (`committed`, public for the review lock – a pay_prize before pay_from is TooEarly); after pay_from it pays every rank with its proof
//      and closes the pool – every lamport asserted; the standings are final with each rank paid + its signature; a second pass pays nothing more
//   6. the next slot's pool missed its goal: the crank fails it, refunds the rider (price + Ticket rent) and closes it – by itself
//   pledges: a sponsor PLEDGES per km (POST /api/pledges → the wallet signs AND sends create_pledge → /confirm) to R1 (verified), R7 (rejected) and R8
//   (never driven); the pledge job (pool:pledges) settles R1 (earned by its ride's verified km) and R7 (flagged: all back) once their attestations' lock is
//   over and refunds R8's (no attestation); then anyone closes the two RideAttestations (rent back to the payout key) – every lamport asserted
// env: BASE, RPC, KEYS, COVERAGE, DAY (phase 1's day.json), CHROME_PORT, DATABASE_URL + PAYOUT_SECRET (the CLI passes = the day server's database and key)
import { createHash } from 'node:crypto';
import nacl from 'tweetnacl'; import bs58 from 'bs58'; import { readFileSync, writeFileSync } from 'node:fs'; import { execFileSync } from 'node:child_process';
import { Connection, Keypair, PublicKey, SYSVAR_CLOCK_PUBKEY, Transaction } from '@solana/web3.js';
import { launch, sleep } from '../../client/tools/cdp.mjs';
import { PoolProgramCodec } from '../dist/infrastructure/solana/pool-program.codec.js';
import { POOL_PROGRAM_IDL as IDL } from '../dist/infrastructure/solana/pool-program.idl.js';
import { closeSplit, prizeBound } from '../dist/domain/economy/vault-split.js';
import { poolPayouts } from '../dist/domain/economy/pool-payouts.js';
import { honestRoad } from './road-damage.mjs';
import { coverage } from './localnet-coverage.mjs';

const { BASE, RPC, KEYS, DAY } = process.env;
if (!BASE || !RPC || !KEYS || !DAY) { console.error('run it through .claude/skills/localnet-e2e/run.sh (needs BASE, RPC, KEYS, DAY)'); process.exit(2); }
const D = JSON.parse(readFileSync(DAY, 'utf8'));   // { saleSecs, playSecs, reviewSecs, minTickets, maxPerWallet, price, split }
const PRICE = D.price, [PRIZE_BPS, SEED_BPS] = D.split;
const CDP = +(process.env.CHROME_PORT || 9411);
const MIN_LEFT = +(process.env.DAY_MIN_LEFT || 100);   // seconds of sale the funded pool needs (buys + rides); a later pool is taken when the first slot is shorter
const cov = coverage(process.env.COVERAGE || `${KEYS}/../coverage.json`);
BigInt.prototype.toJSON ??= function () { return String(this); };   // the codec decodes Pool.paid_mask (u64 bit mask) as a BigInt
const T0 = Date.now(), fails = [];
const check = (n, ok, x = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} [${((Date.now() - T0) / 1000).toFixed(0)} s] ${n}${x ? ' – ' + x : ''}`); if (!ok) fails.push(n); return ok; };
const until = async (fn, ms = 30000, step = 500) => { for (let i = 0; i <= ms / step; i++) { const v = await fn(); if (v) return v; await sleep(step); } return false; };
const conn = new Connection(RPC, 'confirmed');
const codec = new PoolProgramCodec(IDL.address);
const key = name => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(`${KEYS}/${name}.json`, 'utf8'))));
const addr = name => key(name).publicKey.toBase58();
const bal = a => conn.getBalance(new PublicKey(a), 'confirmed');
const bals = async list => Object.fromEntries(await Promise.all(Object.entries(list).map(async ([k, a]) => [k, await bal(a)])));
const delta = (b, a) => Object.fromEntries(Object.keys(a).map(k => [k, a[k] - b[k]]));
const chainNow = async () => Number((await conn.getAccountInfo(SYSVAR_CLOCK_PUBKEY, 'confirmed')).data.readBigInt64LE(32));
const untilChain = async (ts, what) => { const left = ts - (await chainNow()); if (left > 0) console.log(`     … waiting ${left} s for ${what} (chain clock)`); while ((await chainNow()) < ts + 1) await sleep(1000); };
const account = async (name, a) => { const i = await conn.getAccountInfo(a, 'confirmed'); return i ? codec.decodeAccount(name, i.data) : null; };
const poolAcc = id => account('Pool', codec.poolPda(id));
const config = () => account('Config', codec.configPda());
const series = () => account('Series', codec.seriesPda(1));
const secs = d => d.getTime() / 1000;   // the codec turns every i64 into a Date
const ticketRent = await conn.getMinimumBalanceForRentExemption(8 + 79);
const rentOf = async a => conn.getMinimumBalanceForRentExemption((await conn.getAccountInfo(new PublicKey(a), 'confirmed')).data.length);   // v3 accounts grew: read the size
const RENT0 = await conn.getMinimumBalanceForRentExemption(0);
const admintool = args => JSON.parse(execFileSync('node', ['scripts/pool-admin.mjs', ...args, '--url', RPC], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim().split('\n').pop());
const cli = (...args) => JSON.parse(execFileSync('node', ['dist/cli/index.js', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
const refuse = (step, args, want) => {
  try { admintool(args); return check(`${step} → refused ${want}`, false, 'it LANDED'); } catch (e) {
    const got = cov.refused(step, e);
    return check(`${step} → refused ${want}`, got === want, got ?? String(e.stderr ?? e).split('\n').slice(0, 2).join(' '));
  }
};
/** one landed transaction: fee payer, the program's instructions and events, each account's lamport change */
const same = (a, b) => a.length >= b.length && b.every((x, i) => a[i] === x);
async function txInfo(sig) {
  const tx = await conn.getTransaction(sig, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
  const keys = (tx.transaction.message.staticAccountKeys ?? tx.transaction.message.accountKeys).map(k => k.toBase58());
  const program = IDL.address, msg = tx.transaction.message;
  const ixs = msg.compiledInstructions.filter(ix => keys[ix.programIdIndex] === program).map(ix => IDL.instructions.find(i => same(Uint8Array.from(ix.data), i.discriminator))?.name ?? 'unknown');
  const lines = codec.programData(tx.meta.logMessages ?? []);
  const events = lines === 'truncated' ? [] : lines.map(l => codec.decodeEvent(l.bytes)).filter(Boolean);
  return { feePayer: keys[0], fee: tx.meta.fee, ixs, events, err: tx.meta.err, cu: tx.meta.computeUnitsConsumed, slot: tx.slot, blockTime: tx.blockTime, change: a => { const i = keys.indexOf(a); return i < 0 ? 0 : tx.meta.postBalances[i] - tx.meta.preBalances[i]; } };
}
const sealCu = [];
const sigsOf = async a => (await conn.getSignaturesForAddress(new PublicKey(a), { limit: 100 }, 'confirmed')).reverse().map(x => x.signature);   // oldest first

// ── HTTP as a wallet – each rider from its own address (TRUST_PROXY=1 on the day server), so the pool-level shared-IP mark only fires where it should
const fetchy = (url, init) => fetch(url, init).catch(e => { if (!/fetch failed/.test(e?.message)) throw e; return fetch(url, init); });
const api = async (path, { body, cookie, method, ip } = {}) => {
  const res = await fetchy(`${BASE}/api/${path}`, { method: method ?? (body ? 'POST' : 'GET'), headers: { 'content-type': 'application/json', ...(cookie && { cookie }), ...(ip && { 'x-forwarded-for': ip }) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, ok: res.ok, j: await res.json().catch(() => ({})) };
};
async function signIn(kp, ip) {
  const wallet = kp.publicKey.toBase58(), { j } = await api('auth/nonce', { body: { wallet }, ip });
  const res = await fetchy(`${BASE}/api/auth/verify`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip }, body: JSON.stringify({ wallet, signature: bs58.encode(nacl.sign.detached(new TextEncoder().encode(j.message), kp.secretKey)) }) });
  if (!res.ok) throw new Error(`sign-in failed: ${res.status} ${await res.text()}`);
  return res.headers.get('set-cookie').split(';')[0];
}
let nextIp = 10;
async function player(name) {
  const kp = Keypair.generate(), wallet = kp.publicKey.toBase58(), ip = `198.51.100.${nextIp++}`;
  await conn.confirmTransaction(await conn.requestAirdrop(kp.publicKey, 3e9), 'confirmed');
  const keyfile = `${KEYS}/day-${name}.json`; writeFileSync(keyfile, JSON.stringify([...kp.secretKey]));
  const cookie = await signIn(kp, ip);
  const offer = await api('profile/agreements', { body: { age18: true, loss: true }, cookie, ip, method: 'PUT' });   // paid play (tickets, pledges) needs the 18+ and loss offer
  if (!offer.ok) throw new Error(`agreements failed: ${offer.status}`);
  return { name, kp, wallet, keyfile, ip, cookie };
}
const signedB64 = (b64, kp) => { const tx = Transaction.from(Buffer.from(b64, 'base64')); tx.partialSign(kp); return tx; };
const sendSigned = async tx => { const sig = await conn.sendRawTransaction(tx.serialize()); await conn.confirmTransaction(sig, 'confirmed'); return sig; };
const serverPool = async id => (await api(`pools/${id}`)).j;
const standings = async id => (await api(`pools/${id}/standings`)).j;
const myTickets = async (p, poolId) => ((await api('me', { cookie: p.cookie, ip: p.ip })).j.tickets ?? []).find(t => t.poolId === poolId);
async function buySelf(p, poolId, qty = 1) {
  const o = await api('tickets', { body: { poolId, qty }, cookie: p.cookie, ip: p.ip });
  if (!o.ok) return { order: o, paid: false };
  const pay = await api(`tickets/orders/${o.j.id}/payment`, { cookie: p.cookie, ip: p.ip });
  const sig = await sendSigned(signedB64(pay.j.transaction, p.kp));
  return { order: o, sig, paid: !!(await until(async () => (await api(`tickets/orders/${o.j.id}/confirm`, { body: { signature: sig }, cookie: p.cookie, ip: p.ip })).j.status === 'paid')) };
}

// ── a PLEDGE per km (program v3) through the server: POST /api/pledges → the sponsor's wallet signs AND sends create_pledge → /confirm reads its events.
//    One at a time (the sponsor's balance is measured around each).
let pledgeChain = Promise.resolve();
const PER_KM = 1_000_000, TARGET_KM = 2;   // a 2 000 000-lamport cap
function pledgeTo(S, rideId) {
  const run = async () => {
    const b0 = await bal(S.wallet);
    const c = await api('pledges', { body: { rideId, lamportsPerKm: String(PER_KM), targetKm: TARGET_KM }, cookie: S.cookie, ip: S.ip });
    if (!c.ok) return { error: `${c.status} ${JSON.stringify(c.j).slice(0, 200)}` };
    const sig = await sendSigned(signedB64(c.j.transaction.transaction, S.kp));
    const done = await until(async () => { const r = await api(`pledges/${c.j.pledge.id}/confirm`, { body: { signature: sig }, cookie: S.cookie, ip: S.ip }); return r.j.status === 'active' ? r.j : null; }, 20000, 1000);
    const pda = c.j.pledge.pdaAddress;
    return { id: c.j.pledge.id, rideId, pda, sig, rent: await rentOf(pda), fee: (await txInfo(sig)).fee, max: PER_KM * TARGET_KM, active: !!done, spent: b0 - (await bal(S.wallet)), built: c.j };
  };
  return (pledgeChain = pledgeChain.then(run, run));
}

// ── a FINISHED RIDE over the player API (the e2e-localnet-payout.mjs / e2e-verified-play.mjs recipe): hash-chained 10 Hz batches that take the planned holes' damage
const sha256 = text => createHash('sha256').update(text, 'utf8').digest('hex');
const r = (v, d) => Math.round(v * 10 ** d) / 10 ** d;
// drives past the finish line (completeDist, 1 050 m at DEMO_SCALE=48) by `extra` m – program v3 attests whole verified km; `onStart(rideId)` runs once it is on the road
async function apiRide(p, { seconds = 20, speed = 15, extra = 60, onStart = async () => {}, mutate = () => null, hashOf = (_b, text) => sha256(text) } = {}) {
  const o = { cookie: p.cookie, ip: p.ip };
  const made = await api('rides', { body: { tier: '1h' }, ...o });
  if (!made.ok) return { error: `${made.status} ${JSON.stringify(made.j).slice(0, 160)}` };
  const ride = made.j;
  await api(`rides/${ride.id}/start`, { body: {}, ...o });
  await onStart(ride.id);
  const d = { id: ride.id, t0: Date.now(), t: 0, s: 0, seq: 0, prevHash: ride.id, samples: [], inputs: [], bt0: 0, prompts: [], road: honestRoad(BASE, ride.id) };
  // each driver holds its own line across the road (a slow weave, its own phase and length): identical lines are what the pool's duplicate-recording mark catches
  const ph = Math.random() * 2 * Math.PI, wl = 25 + Math.random() * 40, lane = s => 2.4 + 0.45 * Math.sin(s / wl + ph);
  const row = (t, s, v) => [r(t, 2), r(s, 1), r(lane(s), 2), 0, r(v, 2), Math.round(900 + v * 50), 6, 100, 0.6, 0, 0, 0, 12, 1 | 2 | 8];
  const cut = async () => {
    await d.road.take(d.samples);
    const base = { seq: d.seq++, prevHash: d.prevHash, t0: r(d.bt0, 2), t1: r(d.t, 2), samples: d.samples, inputs: d.inputs };
    const body = mutate(base) ?? base;
    const text = JSON.stringify({ seq: body.seq, prevHash: body.prevHash, t0: body.t0, t1: body.t1, samples: body.samples, inputs: body.inputs });
    const hash = hashOf(body, text);
    d.prevHash = hash ?? `unhashed-${body.seq}`; d.samples = []; d.inputs = []; d.bt0 = d.t;
    await api(`rides/${d.id}/batches`, { body: { ...body, hash }, ...o });
  };
  const heartbeat = async () => {
    const { j } = await api(`rides/${d.id}/heartbeat`, { body: { s: d.s, t: d.t, hull: 100, paused: false, route: 'route66', night: false }, ...o });
    const c = j?.challenge;
    if (c && !d.prompts.some(x => x.id === c.id)) { d.prompts.push(c); const at = r(c.issuedMs + 450 + Math.random() * 700, 1); d.inputs.push([at, c.codes[0], 1], [r(at + 70 + Math.random() * 120, 1), c.codes[0], 0]); }
  };
  let wall = Date.now(), lastBeat = 0, gasDown = false, nextKey = 600;
  for (;;) {
    await sleep(100);
    const now = Date.now(), dt = Math.min(0.1, (now - wall) / 1000); wall = now;   // the GAME clock: frames are clamped, one sample a 0.1 s – a stalled loop (an upload, a busy machine) is no gap in game time
    d.t += dt; d.s += speed * dt;
    d.samples.push(row(d.t, d.s, speed));
    const ms = now - d.t0;
    if (ms >= nextKey) {
      if (!gasDown) { d.inputs.push([r(ms, 1), 'KeyW', 1]); gasDown = true; nextKey = ms + 1500 + Math.random() * 3000; }
      else { d.inputs.push([r(ms, 1), 'KeyW', 0]); gasDown = false; const tap = Math.random() < .5 ? 'KeyA' : 'KeyD'; const at = r(ms + 100 + Math.random() * 300, 1); d.inputs.push([at, tap, 1], [r(at + 120 + Math.random() * 400, 1), tap, 0]); nextKey = ms + 400 + Math.random() * 900; }
    }
    if (d.t - d.bt0 >= 15) await cut();
    if (now - lastBeat >= 5_000) { lastBeat = now; await heartbeat(); }
    if (d.t >= seconds && d.s >= Math.max(ride.completeDist ?? 0, 1000) + extra) break;
  }
  await cut(); await heartbeat();
  const end = await api(`rides/${d.id}/end`, { body: { outcome: 'shift', s: d.s, t: d.t, hull: 100 }, ...o });
  return { id: d.id, end: end.j };
}
const teleport = b => (b.seq === 1 ? { ...b, samples: b.samples.map((row, i) => (i === 40 ? [row[0], row[1] + 500, ...row.slice(2)] : row)) } : null);
const unhashed = (b, text) => (b.seq === 1 ? null : sha256(text));

// ── the lobby in headless Chrome with a fake Phantom that signs with the throwaway key (the e2e-localnet.mjs recipe)
const fakePhantom = p => `(() => { const SECRET = ${JSON.stringify([...p.kp.secretKey])}, PUB = ${JSON.stringify(p.wallet)}, RPC = ${JSON.stringify(RPC)};
  window.__asked = []; const me = () => window.solanaWeb3.Keypair.fromSecretKey(Uint8Array.from(SECRET));
  const pk = { toString: () => PUB, toBase58: () => PUB };
  window.phantom = { solana: { isPhantom: true, publicKey: pk, connect: async () => ({ publicKey: pk }), disconnect: async () => {},
    signTransaction: async tx => { __asked.push('signTransaction'); tx.partialSign(me()); return tx; },
    signAndSendTransaction: async tx => { __asked.push('signAndSendTransaction'); tx.partialSign(me());
      let s = ''; for (const b of tx.serialize()) s += String.fromCharCode(b);
      const r = await (await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'sendTransaction', params: [btoa(s), { encoding: 'base64', preflightCommitment: 'confirmed' }] }) })).json();
      if (r.error) throw new Error(r.error.message); return { signature: r.result }; } } }; })();`;
const browsers = [];
async function browser(p, port) {
  const h = await launch({ port, shotsDir: 'fc-localnet-shots', evalProblems: true }); browsers.push(h);
  await h.send('Page.addScriptToEvaluateOnNewDocument', { source: fakePhantom(p) });
  await h.send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 900, deviceScaleFactor: 1, mobile: false });
  const [n, v] = p.cookie.split('='); await h.send('Network.setCookie', { name: n, value: v, url: BASE, httpOnly: true });
  h.txt = sel => h.ev(`document.querySelector(${JSON.stringify(sel)})?.textContent ?? ''`);
  h.lobby = async () => { await h.send('Page.navigate', { url: `${BASE}/lobby.html#new` }); return until(async () => (await h.ev('document.querySelectorAll(".tier").length')) >= 3, 20000); };
  return h;
}
// the ADMIN session (fc_admin) and its signed actions – the ride review (e2e-localnet-payout.mjs) and the pool HOLD
async function adminSession(kp) {
  const address = kp.publicKey.toBase58(), h = { 'content-type': 'application/json', 'x-fc-admin': '1', 'x-forwarded-for': '203.0.113.7' };
  const n = await (await fetchy(`${BASE}/api/admin/auth/nonce`, { method: 'POST', headers: h, body: JSON.stringify({ wallet: address }) })).json();
  const v = await fetchy(`${BASE}/api/admin/auth/verify`, { method: 'POST', headers: h, body: JSON.stringify({ wallet: address, signature: bs58.encode(nacl.sign.detached(new TextEncoder().encode(n.message), kp.secretKey)) }) });
  const cookie = v.headers.get('set-cookie')?.split(';')[0] ?? '';
  const adm = async (method, path, body) => { const res = await fetchy(`${BASE}/api/admin/${path}`, { method, headers: { ...h, cookie }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: res.status, j: await res.json().catch(() => ({})) }; };
  const sign = message => bs58.encode(nacl.sign.detached(new TextEncoder().encode(message), kp.secretKey));
  const override = async (id, decision, note) => {
    const { j } = await adm('POST', `rides/${id}/challenge`, { action: 'override', decision, note });
    return adm('POST', `rides/${id}/verdict`, { decision, note, signature: sign(j.message) });
  };
  const hold = async (poolId, on, note) => {
    const c = await adm('POST', `pools/${poolId}/hold/challenge`, { action: 'pool_hold', hold: on, note });
    if (c.status !== 200) return c;
    return adm('POST', `pools/${poolId}/hold`, { hold: on, note, signature: sign(c.j.message) });
  };
  return { cookie, adm, override, hold };
}

/** the series pool the crank opened for the slot: waits for Series.last_pool_id to move past `after` */
async function crankOpened(after, ms) {
  const got = await until(async () => { const s = await series(); return s?.lastPoolId !== null && s?.lastPoolId !== undefined && (after === null || s.lastPoolId > after) ? { id: s.lastPoolId } : false; }, ms, 1000);
  return got ? got.id : false;   // pool 0 is a real id – wrapped so `until` does not take it for "not yet"
}
/** what the crank's open_next_pool transaction did: the creation signature is the pool PDA's oldest */
async function checkOpened(id, label) {
  const p = await poolAcc(id), sr = await series();
  const open = await txInfo((await sigsOf(codec.poolPda(id).toBase58()))[0]);
  const ev = open.events.find(e => e.name === 'PoolCreated')?.fields;
  check(`${label}: opened by the CRANK's own open_next_pool (fee payer = the crank key), PoolCreated.from_series = true`, open.ixs.join() === 'open_next_pool' && open.feePayer === addr('crank') && ev?.fromSeries === true && ev.poolId === id, JSON.stringify({ ixs: open.ixs, payer: open.feePayer, ev: ev && { fromSeries: ev.fromSeries, poolId: ev.poolId } }));
  const POOL_RENT = await rentOf(codec.poolPda(id).toBase58());
  // v4 (L4): nothing is sealed at the open – PoolCreated carries the TARGET slot and a zero commitment; the crank sends seal_road once the chain is past it
  check(`${label}: PoolCreated carries the seal target (a slot after the open) and no commitment yet – the road is not known when the pool opens`, ev?.seedSlot > 0 && /^A+=*$/.test(ev.seedCommitment) && /^A+=*$/.test(ev.seedSlotHash), JSON.stringify(ev && { slot: ev.seedSlot, commitment: ev.seedCommitment }));
  const sealed = await until(async () => { const x = await poolAcc(id); return Number(x.sealSlot) === 0 ? x : null; }, 30000, 1000);
  const sealTx = sealed ? (await Promise.all((await sigsOf(codec.poolPda(id).toBase58())).map(async sig => ({ sig, t: await txInfo(sig) })))).find(x => x.t.ixs.join() === 'seal_road') : null;
  const sealEv = sealTx?.t.events.find(e => e.name === 'RoadSealed')?.fields;
  const want = sealed && createHash('sha256').update(Buffer.concat([Buffer.from(Uint32Array.of(id).buffer), Buffer.from(sealed.seedSlotHash, 'base64'), Buffer.from(BigUint64Array.of(BigInt(sealed.seedSlot)).buffer)])).digest('base64');
  check(`${label}: the CRANK sealed the road by itself (seal_road, fee payer = the crank) from the first slot at or after the target – SHA-256(pool id ‖ slot hash ‖ slot) recomputes, RoadSealed carries the same`, !!sealed && sealTx?.t.feePayer === addr('crank') && !sealTx.t.err
    && sealed.seedCommitment === want && !/^A+=*$/.test(want) && Number(sealed.seedSlot) >= ev.seedSlot && sealEv?.seedCommitment === want && sealEv.seedSlot === Number(sealed.seedSlot) && sealEv.seedSlotHash === sealed.seedSlotHash,
    JSON.stringify({ sealed: !!sealed, payer: sealTx?.t.feePayer?.slice(0, 6), target: ev?.seedSlot, slot: sealed?.seedSlot, cu: sealTx?.t.cu }));
  if (sealTx) { sealCu.push(sealTx.t.cu); console.log(`     seal_road compute units on this validator: ${sealTx.t.cu} (the crank's limit: CU_LIMITS.seal_road)`); }
  check(`${label}: the crank paid the Pool rent + the vault rent minimum + its fee, exactly; it is the pool's creator record`, open.change(addr('crank')) === -(POOL_RENT + RENT0 + open.fee) && p.authority === addr('crank') && open.change(codec.vaultPda(id).toBase58()) === RENT0, `${open.change(addr('crank'))} vs −${POOL_RENT + RENT0 + open.fee}`);
  check(`${label}: rules + deadlines from the series (sale ${D.saleSecs} s on the grid, play +${D.playSecs} s, review +${D.reviewSecs} s)`, p.status === 0 && p.tier === 1 && p.priceLamports === PRICE && p.minTickets === D.minTickets && p.maxPerWallet === D.maxPerWallet && p.prizeBps === PRIZE_BPS
    && secs(p.prepDeadline) === secs(sr.nextOpenAt) && secs(p.playDeadline) === secs(p.prepDeadline) + D.playSecs && secs(p.payoutAt) === secs(p.playDeadline) + D.reviewSecs && secs(p.createdAt) >= secs(p.prepDeadline) - D.saleSecs,
  JSON.stringify({ created: p.createdAt, prep: p.prepDeadline, play: p.playDeadline, payoutAt: p.payoutAt, nextOpenAt: sr.nextOpenAt }));
  const listed = await until(async () => (await api('pools')).j.pools?.find(x => x.id === id), 20000, 1000);
  check(`${label}: the server mirror registered it (GET /api/pools: open, the same deadlines)`, listed?.status === 'open' && listed.tier === '1h' && listed.payoutAt === p.payoutAt.getTime() && listed.prepDeadline === p.prepDeadline.getTime(), JSON.stringify(listed).slice(0, 240));
  return p;
}

try {
  const admin = key('admin'), ADMIN = admin.publicKey.toBase58(), PAYOUT = addr('payout'), CRANK = addr('crank');
  const adm = ['-k', `${KEYS}/admin.json`], treas = ['--fee-treasury', addr('fee'), '--seed-treasury', addr('seed')];
  check('server sells tickets through the program', (await api('tiers')).j.paymentMode === 'program');
  let cfg = await config(), sr = await series();
  check('a fresh program: initialized by the upgrade authority (admin named, 500 bps), no pool, no payout key yet, the v4 floors lowered to 0 (set_config)', cfg?.authority === ADMIN && cfg.poolCount === 0 && cfg.payoutAuthority === null && cfg.platformFeeBps === 500
    && secs(cfg.minReviewSecs) === 0 && secs(cfg.minFinishSecs) === 0, JSON.stringify(cfg));
  check(`the 1h series the admin wrote: enabled, a ${D.saleSecs} s slot, its first slot still ahead`, sr?.enabled === true && secs(sr.saleSecs) === D.saleSecs && sr.poolsOpened === 0 && secs(sr.nextOpenAt) > (await chainNow()), JSON.stringify(sr));
  const PLAT_BPS = cfg.platformFeeBps;

  // ── 0. before the slot: nothing opens, a hand-sent open is refused, the payout job refuses while the program names no payout key
  const Z = await player('stranger');
  if (secs(sr.nextOpenAt) - (await chainNow()) > 15) {   // only while the slot is safely ahead – a late stranger's open would LAND (and be the creator)
    refuse('open_next_pool before the series\' slot has come', ['open-next-pool', '--tier', '1h', '-k', Z.keyfile], 'TooEarly');
    check('before the slot: the crank (on its schedule) opened nothing', (await config()).poolCount === 0);
  } else console.log('NOTE the slot is too close to send an open by hand first (raise DAY_LEAD) – TooEarly is still asserted by the money scenarios');
  const off = cli('pool:payout');
  check('pool:payout while the program names no payout key: off, says why', off.enabled === false && off.payout === PAYOUT && /names no payout key/.test(off.refused ?? ''), JSON.stringify(off));

  // ── 1. the admin's last signatures of the day
  const spa = admintool(['set-payout-authority', '--payout', PAYOUT, ...adm]);
  check('set_payout_authority by the admin: Config names the payout key', spa.config.payoutAuthority === PAYOUT);
  const s4 = admintool(['set-series', '--tier', '4h', '--price', String(PRICE), '--min', '5', '--per-wallet', '2', '--sale-hours', '24', '--play-hours', '4', '--review-hours', '48', '--start', '+60', '--enabled', 'false', ...treas, ...adm]).series;
  check('set_series by the admin: a 4h series, DISABLED', s4?.enabled === false && s4.tier === 2);
  refuse('open_next_pool of a disabled series', ['open-next-pool', '--tier', '4h', '-k', Z.keyfile], 'SeriesDisabled');
  refuse('the payout key creates a pool', ['create-pool', '--tier', '1h', '--price', String(PRICE), '--min', '1', '--prep', '+600', '--play', '+700', ...treas, '-k', `${KEYS}/payout.json`], 'Unauthorized');
  refuse('the payout key writes a series', ['set-series', '--tier', '4h', '--price', String(PRICE), '--min', '5', '--sale-hours', '24', '--play-hours', '4', '--review-hours', '48', ...treas, '-k', `${KEYS}/payout.json`], 'Unauthorized');
  refuse('the payout key names itself admin', ['propose-authority', '--new', PAYOUT, '-k', `${KEYS}/payout.json`], 'Unauthorized');
  const empty = cli('pool:payout');
  check('pool:payout with the payout key named: on, nothing to pay yet', empty.enabled === true && empty.refused === null && empty.pools.length === 0, JSON.stringify(empty));
  const R = []; for (let i = 1; i <= 9; i++) R.push(await player(`r${i}`));
  const S = await player('sponsor');
  const [R1, R2, R3, R4, R5, R6, R7, R8, R9] = R;
  const h1 = await browser(R1, CDP);

  // ── 2. the slot comes: the CRANK opens the pool by itself
  sr = await series();
  await untilChain(secs(sr.nextOpenAt), 'the series\' first slot');
  let P = await crankOpened(null, 30000);
  check('the crank opened the slot\'s pool on its own (no hand on chain)', P !== false, JSON.stringify(await series()));
  if (P === false) throw new Error('no pool opened');
  let left = secs((await poolAcc(P)).prepDeadline) - (await chainNow());
  if (left < MIN_LEFT) {   // the first slot started before the stack was up: the next slot's pool is the day's (this one fails empty and is closed by the crank)
    console.log(`     … pool ${P} sells for only ${left} s more – the next slot's pool is the funded one`);
    await untilChain(secs((await poolAcc(P)).prepDeadline), `pool ${P}'s sale end`);
    P = await crankOpened(P, 30000);
    if (P === false) throw new Error('the next slot opened nothing');
  }
  const pool0 = await checkOpened(P, `pool ${P} (slot 1)`);
  const vP = codec.vaultPda(P).toBase58();
  refuse('the payout key cancels the open pool', ['cancel-pool', '--pool', String(P), '-k', `${KEYS}/payout.json`], 'Unauthorized');

  // ── 3. riders buy – R1 in the LOBBY (the wallet signs AND sends), R2–R8 from Node – then ride
  check('lobby: the 1h card sells the series pool', await h1.lobby() && !!(await until(async () => /BUY 1 TICKET/.test(await h1.txt('#tier-1h .buyb')), 15000)), await h1.txt('#tier-1h'));
  let before = await bals({ r1: R1.wallet, vault: vP });
  await h1.ev('document.querySelector("#tier-1h .buyb").click()');
  check('lobby: R1 paid, 1 ticket credited', !!(await until(async () => /Paid – 1 ticket/.test(await h1.txt('#msg-1h')), 60000)), await h1.txt('#msg-1h'));
  let after = await bals({ r1: R1.wallet, vault: vP });
  const sigR1 = (await conn.getSignaturesForAddress(R1.kp.publicKey, { limit: 1 }, 'confirmed'))[0]?.signature;
  check('…R1 −(price + fee + Ticket rent) exactly, the vault + price', !!sigR1 && before.r1 - after.r1 === PRICE + (await txInfo(sigR1)).fee + ticketRent && after.vault - before.vault === PRICE, JSON.stringify(delta(before, after)));
  await h1.shot('day-1-lobby-bought');
  const buys = await Promise.all([R2, R3, R4, R5, R6, R7, R8].map(async p => { const b = await bal(p.wallet), x = await buySelf(p, P); return { p, ok: x.paid && b - (await bal(p.wallet)) === PRICE + (await txInfo(x.sig)).fee + ticketRent }; }));
  check('R2–R8 buy 1 each from Node (/confirm): each −(price + fee + Ticket rent) exactly', buys.every(b => b.ok), buys.filter(b => !b.ok).map(b => b.p.name).join());
  const SPONSOR_P = 900_000_000;   // v5: covers 8 × 0.1 SOL tickets under the 47.4 % player-share cap
  admintool(['sponsor', '--pool', String(P), '--lamports', String(SPONSOR_P), '-k', S.keyfile]);
  let pc = await poolAcc(P);
  check(`chain: 8 tickets, pool ${P} ACTIVE (min ${D.minTickets}), still inside its sale window`, pc.ticketsSold === 8 && pc.status === 1 && (await chainNow()) < secs(pc.prepDeadline), JSON.stringify({ sold: pc.ticketsSold, status: pc.status }));
  check('server mirror: active, 8 sold', !!(await until(async () => { const s = await serverPool(P); return s.status === 'active' && s.sold === 8 && s.sponsoredLamports === SPONSOR_P; }, 20000)));
  console.log('     … 7 rides over the player API, each past the 1 050 m line (≈ 55 s): R1–R5 honest, R6 an unhashed batch, R7 a teleport; R8 takes its ride but never drives it; the sponsor pledges to R1, R7, R8');
  const pledges = {};
  const plan = { r1: { speed: 20, extra: 50, onStart: async id => { pledges.r1 = await pledgeTo(S, id); } }, r2: { speed: 21, extra: 100 }, r3: { speed: 22, extra: 150 }, r4: { speed: 23, extra: 200 },
    r5: { speed: 24, extra: 250 }, r6: { speed: 25, extra: 300, hashOf: unhashed }, r7: { speed: 20, mutate: teleport, onStart: async id => { pledges.r7 = await pledgeTo(S, id); } } };
  const rides = {};
  const r8ride = await api('rides', { body: { tier: '1h' }, cookie: R8.cookie, ip: R8.ip });   // its ticket spent, the shift never driven
  const own = await api('pledges', { body: { rideId: r8ride.j.id, lamportsPerKm: String(PER_KM), targetKm: TARGET_KM }, cookie: R8.cookie, ip: R8.ip });
  check('POST /api/pledges by the driver to its own ride: 400', own.status === 400, `${own.status} ${JSON.stringify(own.j).slice(0, 120)}`);
  pledges.r8 = await pledgeTo(S, r8ride.j.id);
  await Promise.all([R1, R2, R3, R4, R5, R6, R7].map(async p => { rides[p.name] = await apiRide(p, plan[p.name]); }));
  for (const [k, x] of Object.entries(pledges)) {
    check(`pledge to ${k}: active after /confirm, the sponsor paid exactly cap + the Pledge account's rent + its fee, the PDA holds cap + rent`, !x.error && x.active && x.spent === x.max + x.rent + x.fee && (await bal(x.pda)) === x.max + x.rent,
      JSON.stringify(x.error ?? { spent: x.spent, max: x.max, rent: x.rent, fee: x.fee, pda: await bal(x.pda) }));
    const created = (await txInfo(x.sig)).events.find(e => e.name === 'PledgeCreated')?.fields;
    check(`…its PledgeCreated: sponsor, driver, ${PER_KM} per km up to ${TARGET_KM} km`, created?.sponsor === S.wallet && created.maxLamports === x.max && created.lamportsPerKm === PER_KM && created.targetKm === TARGET_KM, JSON.stringify(created));
  }
  const listed = (await api(`rides/${pledges.r1.rideId}/pledges`)).j;
  check('GET /api/rides/:id/pledges (public): R1\'s pledge, active, with its create signature', Array.isArray(listed) && listed.length === 1 && listed[0].status === 'active' && listed[0].createSignature === pledges.r1.sig, JSON.stringify(listed).slice(0, 200));
  const pk = k => ['--pool', String(P), '--ride', pledges[k].rideId, '--sponsor', S.wallet, '--driver', R.find(p => p.name === k).wallet];
  refuse('refund_pledge while the pool still runs', ['refund-pledge', ...pk('r8'), '-k', Z.keyfile], 'PledgeNotRefundable');
  const vOf = p => rides[p.name]?.end?.verdict?.status ?? null;
  check('rides: R1–R5 COMPLETED + VERIFIED, R6 FLAGGED (unhashed-batch), R7 REJECTED (teleport)', [R1, R2, R3, R4, R5].every(p => rides[p.name].end?.status === 'completed' && vOf(p) === 'verified') && vOf(R6) === 'flagged' && vOf(R7) === 'rejected',
    JSON.stringify(Object.fromEntries(Object.entries(rides).map(([k, x]) => [k, x.error ?? [x.end?.status, x.end?.verdict?.status, (x.end?.verdict?.reasons ?? []).map(z => z.code).join('+')]]))));
  pc = await poolAcc(P);
  check('…and every ride ended before the play deadline', (await chainNow()) < secs(pc.playDeadline));

  // ── 4. the sale ends: no ticket is sold any more (an ACTIVE pool too – v2), the crank opens the next slot's pool
  await untilChain(secs(pc.prepDeadline), `pool ${P}'s sale end`);
  refuse('a buy after the sale end (the pool is ACTIVE)', ['buy', '-k', R8.keyfile, '--pool', String(P)], 'TooLate');
  refuse('a sponsorship after the sale end', ['sponsor', '--pool', String(P), '--lamports', '1000000', '-k', Z.keyfile], 'TooLate');
  const late = await api('tickets', { body: { poolId: P, qty: 1 }, cookie: R8.cookie, ip: R8.ip });
  check('POST /api/tickets after the sale end: 409, nothing to sign', late.status === 409, `${late.status} ${JSON.stringify(late.j).slice(0, 160)}`);
  const P2 = await crankOpened(P, 30000);
  check('the crank opened the NEXT slot\'s pool by itself', P2 !== false && P2 > P);
  const pool2 = await checkOpened(P2, `pool ${P2} (slot 2)`);
  check(`slot 2 starts where slot 1 stopped selling (prep ${secs(pool0.prepDeadline)} + ${D.saleSecs} s)`, secs(pool2.prepDeadline) === secs(pool0.prepDeadline) + D.saleSecs);
  const b9 = await bal(R9.wallet), x9 = await buySelf(R9, P2), fee9 = x9.sig ? (await txInfo(x9.sig)).fee : 0;
  const r9Paid = await bal(R9.wallet);
  check(`R9 buys 1 of pool ${P2}: −(price + fee + Ticket rent); 1 < min ${D.minTickets}, it stays OPEN`, x9.paid && b9 - r9Paid === PRICE + fee9 + ticketRent && (await poolAcc(P2)).status === 0);

  // ── 5. the play deadline passes: v4 (H5-B) the payout job takes the pool now – the pool-level marks, every ride decided, then the winners root is COMMITTED
  //    (public for the review lock), then paid. Nobody pays before the root's pay_from, not even the payout key.
  await untilChain(secs(pc.playDeadline), `pool ${P}'s play deadline`);
  refuse('create_pledge after the play deadline', ['create-pledge', '--pool', String(P), '--ride', rides.r2.id, '--driver', R2.wallet, '--per-km', String(PER_KM), '--km', '1', '-k', Z.keyfile], 'TooLate');
  const wait = cli('pool:payout', '--pool', String(P));
  check('pool:payout at the play deadline: waiting_review (the marks ran, a ride nobody decided blocks the pool), nothing committed, nothing paid', wait.pools[0]?.state === 'waiting_review' && wait.pools[0].paid.length === 0 && (await poolAcc(P)).winnersCount === 0 && Number((await poolAcc(P)).committedAt?.getTime?.() ?? 0) === 0, JSON.stringify(wait.pools));
  refuse('pay_prize before any winners root (anyone)', ['pay-prize', '--pool', String(P), '--winners', `${R5.wallet}:1000000`, '--rank', '1', '-k', Z.keyfile], 'WinnersNotCommitted');
  refuse('the payout key\'s close_pool inside the review window', ['close-pool', '--pool', String(P), '-k', `${KEYS}/payout.json`], 'TooEarly');
  refuse('the payout key vetoes (only the cold admin may)', ['veto-winners', '--pool', String(P), '-k', `${KEYS}/payout.json`], 'Unauthorized');
  const verdictOf = async p => (await api(`rides/${rides[p.name].id}`, { cookie: p.cookie, ip: p.ip })).j.verdict;
  // the marks: every completed ride counts for them (no admin decision yet) – top 3 by distance; each rider signed in from its own address
  const byDist = [R1, R2, R3, R4, R5, R6, R7].sort((a, b) => (rides[b.name].end?.distance ?? 0) - (rides[a.name].end?.distance ?? 0));
  const top3 = byDist.slice(0, 3), rest = byDist.slice(3);
  const v = Object.fromEntries(await Promise.all([R1, R2, R3, R4, R5, R6, R7].map(async p => [p.name, await verdictOf(p)])));
  const marks = p => (v[p.name]?.reasons ?? []).map(z => z.code).filter(c => c.startsWith('pool-'));
  check(`pool-level marks: the top 3 by distance (${top3.map(p => p.name)}) carry pool-new-wallet-top3, nobody else a pool mark (one address each: no pool-shared-ip)`, top3.every(p => marks(p).includes('pool-new-wallet-top3')) && rest.every(p => marks(p).length === 0) && [R1, R2, R3, R4, R5, R6, R7].every(p => !marks(p).includes('pool-shared-ip')),
    JSON.stringify(Object.fromEntries(byDist.map(p => [p.name, [v[p.name]?.status, marks(p).join('+')]]))));
  const undecided = [R1, R2, R3, R4, R5, R6, R7].filter(p => v[p.name]?.status !== 'verified');
  let st = await standings(P);
  check(`standings: provisional, payoutAt = the chain's, underReview = ${undecided.length} (${undecided.map(p => p.name)}), payout waiting_review`, st.final === false && st.payoutAt === pc.payoutAt.getTime() && st.underReview === undecided.length && st.payout?.state === 'waiting_review' && undecided.some(p => p === R6) && undecided.some(p => p === R7), JSON.stringify({ final: st.final, underReview: st.underReview, payout: st.payout }));

  // the admin: HOLD first (signed), then decides every ride under review (signed) – the job must still wait for the release
  const A = await adminSession(admin);
  const held = await A.hold(P, true, 'day e2e: checking the winners by hand');
  check('admin HOLD (signed): the pool is held', held.status === 200 && held.j.held === true && held.j.by === ADMIN, `${held.status} ${JSON.stringify(held.j)}`);
  const decisions = [];   // one after another: the admin has one open challenge at a time (a second one replaces the first)
  for (const p of undecided) decisions.push([p.name, (await A.override(rides[p.name].id, p === R7 ? 'rejected' : 'verified', p === R7 ? 'day e2e: the teleport stands' : 'day e2e: looked at it, fine')).status]);
  check(`admin decides every ride under review (signed): R7 rejected, ${undecided.filter(p => p !== R7).map(p => p.name)} accepted`, decisions.every(([, s]) => s === 200), JSON.stringify(decisions));
  const everyone = { ...Object.fromEntries(R.map(p => [p.name, p.wallet])), payout: PAYOUT, vault: vP };
  before = await bals(everyone);
  const hp = cli('pool:payout', '--pool', String(P));
  after = await bals(everyone);
  check('pool:payout while held: held, nothing committed, no lamport moved', hp.pools[0]?.state === 'held' && hp.pools[0].paid.length === 0 && (await poolAcc(P)).winnersCount === 0 && Object.values(delta(before, after)).every(x => x === 0), JSON.stringify(hp.pools));
  st = await standings(P);
  check('standings: held, nobody under review any more', st.payout?.held === true && st.payout.state === 'held' && st.underReview === 0, JSON.stringify({ payout: st.payout, underReview: st.underReview }));
  const rel = await A.hold(P, false, null);
  check('admin releases the hold (signed)', rel.status === 200 && rel.j.held === false, `${rel.status} ${JSON.stringify(rel.j)}`);
  // R8 took its ride (ticket spent, a pledge on it) and never started it: such a ride has no end, so its pledge can never be attested – see the NOTE
  const payoutSigs0 = new Set(await sigsOf(PAYOUT));   // from here on every payout-key transaction is the job's (attestations, commit, prizes, close)
  before = await bals(everyone);
  const r8wait = cli('pool:payout', '--pool', String(P));
  if (r8wait.pools[0]?.state === 'waiting_review' && /pledged ride/.test(r8wait.pools[0].note ?? '')) console.log(`NOTE a pledged ride nobody started blocks the commit (${r8wait.pools[0].note}) – it ends only when its driver tries to start it`);
  const r8start = await api(`rides/${r8ride.j.id}/start`, { body: {}, cookie: R8.cookie, ip: R8.ip });
  check('R8 starts its ride after the play deadline: 409 rides_closed, the ride is closed (its ticket stays in the pot, its pledge will be refunded)', r8start.status === 409 && r8start.j.code === 'rides_closed', `${r8start.status} ${JSON.stringify(r8start.j).slice(0, 160)}`);

  // ── 7. the payout job: first pass = the pledged rides' attestations + the COMMIT (no prize yet); second pass after pay_from = the prizes + close
  const want = [R1, R2, R3, R4, R5, R6].sort((a, b) => (rides[b.name].end?.distance ?? 0) - (rides[a.name].end?.distance ?? 0));
  pc = await poolAcc(P);
  const bound = prizeBound({ priceLamports: PRICE, ticketsSold: 8, sponsored: SPONSOR_P, prizeBps: PRIZE_BPS, seedBps: SEED_BPS, ...(pc.maxPlayerShareBps !== undefined ? { maxPlayerShareBps: pc.maxPlayerShareBps } : {}) });
  const payouts = poolPayouts(bound, want.map(p => p.wallet));
  const winnersArg = payouts.map(x => `${x.wallet}:${x.lamports}`).join(',');
  const pass1 = cli('pool:payout', '--pool', String(P));
  const pass1Tx = await Promise.all((await sigsOf(PAYOUT)).filter(x => !payoutSigs0.has(x)).map(txInfo));
  const res1 = pass1.pools[0] ?? {};
  pc = await poolAcc(P);
  const commitTx = pass1Tx.find(t => t.ixs.join() === 'commit_winners'), commitEv = commitTx?.events.find(e => e.name === 'WinnersCommitted')?.fields;
  check(`pool:payout after the release: committed – the plan as a winners root (6 ranks, total = the table), pays from ${pc.payFrom?.toISOString?.()} (commit + the ${D.reviewSecs} s review lock), no prize in this pass`, res1.state === 'committed' && res1.paid?.length === 0 && !res1.closed && commitTx?.feePayer === PAYOUT
    && commitEv?.count === 6 && commitEv.total === payouts.reduce((a, x) => a + x.lamports, 0) && pc.winnersCount === 6 && secs(pc.payFrom) >= secs(pc.committedAt) + D.reviewSecs && secs(pc.payFrom) >= secs(pc.payoutAt) && !pass1Tx.some(t => t.events.some(e => e.name === 'PrizePaid')),
    JSON.stringify({ state: res1.state, note: res1.note, ixs: pass1Tx.map(t => t.ixs.join('+')), ev: commitEv && { count: commitEv.count, total: commitEv.total } }));
  const rideIdBytes = id => { const b = Buffer.alloc(32); Buffer.from(id.replace(/-/g, ''), 'hex').copy(b); return b; };   // the server's rideIdToBytes
  const attOf = async k => account('RideAttestation', codec.rideAttestationPda(P, rideIdBytes(pledges[k].rideId)));
  const [a1, a7, a8] = [await attOf('r1'), await attOf('r7'), await attOf('r8')];
  const attTx = pass1Tx.filter(t => t.ixs.join() === 'record_ride_attestation');
  check(`v4 (H4): before the commit the payout key attested each PLEDGED RIDE (in the passes since the release) – R1's VERIFIED (its whole km + the recording's Merkle root), R7's FLAGGED (0 km), R8's none (never driven): ${attTx.length} record_ride_attestation`,
    attTx.length === 2 && attTx.every(t => t.feePayer === PAYOUT && t.events.some(e => e.name === 'RideAttestationRecorded')) && pass1Tx.indexOf(attTx.at(-1)) < pass1Tx.indexOf(commitTx)
    && a1?.status === 1 && a1.verifiedKm === Math.floor(rides.r1.end.distance / 1000) && a1.verifiedKm >= 1 && !/^A+=*$/.test(a1.telemetryRoot) && a1.driver === R1.wallet && a1.rentPayer === PAYOUT
    && a7?.status === 2 && a7.verifiedKm === 0 && a8 === null, JSON.stringify({ ixs: pass1Tx.map(t => t.ixs.join('+')), a1: a1 && { s: a1.status, km: a1.verifiedKm }, a7: a7 && { s: a7.status }, a8, d1: rides.r1.end.distance }));
  const attRent = await rentOf(codec.rideAttestationPda(P, rideIdBytes(pledges.r1.rideId)).toBase58());
  refuse('pay_prize of the committed rank 1 before pay_from (anyone)', ['pay-prize', '--pool', String(P), '--winners', winnersArg, '--rank', '1', '-k', Z.keyfile], 'TooEarly');
  refuse('the payout key\'s close_pool before every committed rank is paid', ['close-pool', '--pool', String(P), '-k', `${KEYS}/payout.json`], 'TooEarly');
  const again1 = cli('pool:payout', '--pool', String(P));
  check('a pass inside the lock: still committed, nothing paid, nothing sent', again1.pools[0]?.state === 'committed' && again1.pools[0].paid.length === 0 && (await sigsOf(PAYOUT)).filter(x => !payoutSigs0.has(x)).length === pass1Tx.length, JSON.stringify(again1.pools));
  await untilChain(secs(pc.payFrom), `pool ${P}'s pay_from (the root's lock)`);
  const pass = cli('pool:payout', '--pool', String(P));
  after = await bals(everyone);
  const passTx = await Promise.all((await sigsOf(PAYOUT)).filter(x => !payoutSigs0.has(x)).map(txInfo));
  const res = pass.pools[0] ?? {}, d = delta(before, after);
  check('pool:payout after pay_from: paid – 6 prizes + close_pool in one pass', res.state === 'paid' && res.paid?.length === 6 && !!res.closed, JSON.stringify(res).slice(0, 400));
  console.log(`     ranking: ${want.map((p, i) => `#${i + 1} ${p.name} ${Math.round(rides[p.name].end.distance)} m → ${payouts[i].lamports}`).join(' · ')}`);
  for (const [i, p] of want.entries()) check(`rank ${i + 1} ${p.name} received exactly ${payouts[i].lamports} lamports`, d[p.name] === payouts[i].lamports && res.paid?.find(x => x.wallet === p.wallet)?.lamports === payouts[i].lamports, `${d[p.name]}`);
  check('R7 (rejected) and R8 (never rode) received nothing', d.r7 === 0 && d.r8 === 0, `${d.r7} / ${d.r8}`);
  const paid = payouts.reduce((a, x) => a + x.lamports, 0);
  const prizeTx = await Promise.all((res.paid ?? []).map(x => txInfo(x.signature)));
  check('every pay_prize was signed and paid for by the PAYOUT KEY (not the admin), one PrizePaid each (rank = the 0-based leaf), none before pay_from, all after the commit', prizeTx.length === 6 && prizeTx.every((t, i) => t.feePayer === PAYOUT && t.ixs.join() === 'pay_prize' && t.events.find(e => e.name === 'PrizePaid')?.fields.rank === i
    && t.blockTime >= secs(pc.payFrom) && t.slot > commitTx.slot), JSON.stringify(prizeTx.map(t => [t.feePayer.slice(0, 6), t.ixs, t.events.find(e => e.name === 'PrizePaid')?.fields.rank, t.blockTime - secs(pc.payFrom)])));
  if (!res.closed) throw new Error('the payout pass did not close the pool – nothing more to check');
  const closeTx = await txInfo(res.closed);
  const legs = closeSplit({ priceLamports: PRICE, ticketsSold: 8, sponsored: SPONSOR_P, prizeBps: PRIZE_BPS, seedBps: SEED_BPS, platformFeeBps: PLAT_BPS, ...(pc.maxPlayerShareBps !== undefined ? { maxPlayerShareBps: pc.maxPlayerShareBps } : {}), prizesPaid: paid, vaultLamports: before.vault - paid, cancelled: false, rentMin: RENT0 });
  pc = await poolAcc(P);
  check('prizes on chain = the plan, ≤ the prize share, every committed rank paid', pc.prizesPaid === paid && paid <= bound && legs.unclaimed === bound - paid && Number(pc.paidMask) === 63, `${pc.prizesPaid} / ${paid} / ${bound} mask ${pc.paidMask}`);
  check('close_pool by the payout key: fee / platform / seed legs = closeSplit, the creator (the crank) + the vault rent minimum', closeTx.feePayer === PAYOUT && closeTx.ixs.join() === 'close_pool' && closeTx.change(addr('fee')) === legs.fee && closeTx.change(addr('plat')) === legs.platformFee
    && closeTx.change(addr('seed')) === legs.seed && closeTx.change(CRANK) === RENT0 && legs.fee > 0 && legs.seed > 0, JSON.stringify({ fee: closeTx.change(addr('fee')), plat: closeTx.change(addr('plat')), seed: closeTx.change(addr('seed')), crank: closeTx.change(CRANK), legs }));
  const payoutFees = passTx.reduce((a, t) => a + t.fee, 0);
  check(`the payout key paid only the fees of its ${passTx.length} transactions + the rent of the ${attTx.length} ride attestations`, d.payout === -(payoutFees + attTx.length * attRent) && passTx.length === 2 + 1 + 6 + 1, `${d.payout} vs −${payoutFees + attTx.length * attRent} (${passTx.length} tx)`);
  check(`vault ${P} = 0, settled on chain and on the server`, after.vault === 0 && pc.status === 3 && !!(await until(async () => (await serverPool(P)).status === 'settled', 20000)));
  check('conservation: 8 tickets + sponsorship = prizes + fee + platform + seed', 8 * PRICE + SPONSOR_P === paid + legs.fee + legs.platformFee + legs.seed, `${8 * PRICE + SPONSOR_P} vs ${paid + legs.fee + legs.platformFee + legs.seed}`);
  st = await standings(P);
  check('standings: final, every rank paid with its pay_prize signature, state paid', st.final === true && st.payout?.state === 'paid' && st.ranks.length === 6 && st.ranks.every((x, i) => x.wallet === want[i].wallet && x.lamports === payouts[i].lamports && x.paid === true && x.signature === res.paid.find(y => y.wallet === x.wallet)?.signature),
    JSON.stringify(st.ranks?.map(x => [x.rank, x.wallet.slice(0, 6), x.lamports, x.paid, !!x.signature])));
  const again = cli('pool:payout', '--pool', String(P)), all = cli('pool:payout');
  check('a second payout pass pays nothing more (the pool is settled)', again.pools[0]?.state === 'paid' && again.pools[0].paid.length === 0 && !again.pools[0].closed && all.pools.every(x => x.paid.length === 0), JSON.stringify({ again: again.pools, all: all.pools }));
  refuse('pay_prize on the settled pool (payout key)', ['pay-prize', '--pool', String(P), '--winners', winnersArg, '--rank', '1', '-k', `${KEYS}/payout.json`], 'PoolNotActive');

  // ── 7b. the pledge job: settles each pledge on ITS ride's attestation, refunds the rest – the payout key only pays the fees, the money goes from each Pledge account
  refuse('refund_pledge of a ride with a decided attestation (it must be settled)', ['refund-pledge', ...pk('r1'), '-k', Z.keyfile], 'AttestationExists');
  const rideArgs = k => ['--pool', String(P), '--ride', pledges[k].rideId];
  refuse('close_ride_attestation while pledges of the pool are open', ['close-ride-attestation', ...rideArgs('r1'), '-k', Z.keyfile], 'PledgesOpen');
  const sBefore = await bal(S.wallet), r1Before = await bal(R1.wallet), r7Before = await bal(R7.wallet);
  const pj = cli('pool:pledges');
  check('pool:pledges: 2 settled (R1, R7), 1 refunded (R8), no error', pj.sending === true && pj.settled === 2 && pj.refunded === 1 && pj.errors.length === 0, JSON.stringify(pj));
  const last = async k => txInfo((await sigsOf(pledges[k].pda)).at(-1));
  const [t1, t7, t8] = [await last('r1'), await last('r7'), await last('r8')];
  const earned1 = Math.floor(pledges.r1.max * Math.min(a1.verifiedKm, TARGET_KM) / TARGET_KM);
  const ev = (t, n) => t.events.find(e => e.name === n)?.fields;
  check(`settle_pledge R1 (sent + paid by the payout key): R1 +${earned1} (rate × ${Math.min(a1.verifiedKm, TARGET_KM)} verified km of ITS ride), the sponsor + the rest + the account's rent`, t1.ixs.join() === 'settle_pledge' && t1.feePayer === PAYOUT
    && t1.change(R1.wallet) === earned1 && t1.change(S.wallet) === pledges.r1.max - earned1 + pledges.r1.rent && t1.change(pledges.r1.pda) === -(pledges.r1.max + pledges.r1.rent)
    && ev(t1, 'PledgeSettled')?.earnedLamports === earned1, JSON.stringify({ ixs: t1.ixs, r1: t1.change(R1.wallet), s: t1.change(S.wallet), ev: ev(t1, 'PledgeSettled') }));
  check('settle_pledge R7 (FLAGGED): R7 nothing, the sponsor the whole cap + the rent', t7.ixs.join() === 'settle_pledge' && t7.change(R7.wallet) === 0 && t7.change(S.wallet) === pledges.r7.max + pledges.r7.rent && ev(t7, 'PledgeSettled')?.earnedLamports === 0,
    JSON.stringify({ ixs: t7.ixs, s: t7.change(S.wallet), ev: ev(t7, 'PledgeSettled') }));
  check('refund_pledge R8 (its ride never driven – no attestation, the pool is over): the sponsor the whole cap + the rent', t8.ixs.join() === 'refund_pledge' && t8.feePayer === PAYOUT && t8.change(S.wallet) === pledges.r8.max + pledges.r8.rent && ev(t8, 'PledgeRefunded')?.refundedLamports === pledges.r8.max,
    JSON.stringify({ ixs: t8.ixs, s: t8.change(S.wallet), ev: ev(t8, 'PledgeRefunded') }));
  check('every Pledge account closed (0 lamports), R1 / R7 / sponsor deltas over the pass add up', (await Promise.all(Object.values(pledges).map(x => bal(x.pda)))).every(x => x === 0)
    && (await bal(R1.wallet)) - r1Before === earned1 && (await bal(R7.wallet)) - r7Before === 0
    && (await bal(S.wallet)) - sBefore === 3 * (pledges.r1.max) - earned1 + pledges.r1.rent + pledges.r7.rent + pledges.r8.rent);
  const states = await Promise.all(['r1', 'r7', 'r8'].map(async k => (await api(`rides/${pledges[k].rideId}/pledges`)).j[0]));
  check('the mirror: R1 settled (earned / back), R7 settled (all back), R8 refunded – each with its settle / refund signature', states[0]?.status === 'settled' && states[0].earnedLamports === String(earned1)
    && states[1]?.status === 'settled' && states[1].earnedLamports === '0' && states[2]?.status === 'refunded' && states[2].refundedLamports === String(pledges.r8.max) && states.every(x => !!x?.signature), JSON.stringify(states).slice(0, 400));
  check('a second pledge pass has nothing left to do', cli('pool:pledges').checked === 0);
  refuse('settle_pledge of a pledge already settled (the account is gone)', ['settle-pledge', ...pk('r1'), '-k', Z.keyfile], 'AccountNotInitialized');
  // v4 (L7): the pool is settled and no pledge is open – anyone gives each RideAttestation's rent back to whoever paid it (the payout key)
  const pBefore = await bal(PAYOUT), closes = [];
  for (const k of ['r1', 'r7']) closes.push(await txInfo(admintool(['close-ride-attestation', ...rideArgs(k), '-k', Z.keyfile]).signature));
  check(`close_ride_attestation ×2 by a stranger: the payout key gets each attestation's rent back (${attRent}), AttestationClosed, the accounts are gone`, (await bal(PAYOUT)) - pBefore === 2 * attRent
    && closes.every(t => ev(t, 'AttestationClosed')?.rentTo === PAYOUT && ev(t, 'AttestationClosed')?.lamports === attRent) && (await attOf('r1')) === null && (await attOf('r7')) === null, JSON.stringify({ got: (await bal(PAYOUT)) - pBefore, ev: closes.map(t => ev(t, 'AttestationClosed')) }));
  // ── 8. the next slot's pool missed its goal: the crank fails it, refunds R9 and closes it – by itself
  await untilChain(secs(pool2.prepDeadline), `pool ${P2}'s sale end`);
  check(`pool ${P2}: cancelled on chain by the crank (seal + fail + refund + close), vault 0`, !!(await until(async () => (await poolAcc(P2))?.status === 4, 30000, 1000)) && (await bal(codec.vaultPda(P2).toBase58())) === 0, JSON.stringify(await poolAcc(P2)));
  const steps = await Promise.all((await sigsOf(codec.poolPda(P2).toBase58())).slice(1).map(txInfo));
  check(`…every step sent and paid for by the crank key: ${steps.map(t => t.ixs.join('+')).join(', ')}`, steps.map(t => t.ixs.join('+')).join() === 'seal_road,buy_ticket,fail_pool,refund,close_pool' && steps.filter(t => t.ixs[0] !== 'buy_ticket').every(t => t.feePayer === CRANK && !t.err), JSON.stringify(steps.map(t => [t.ixs, t.feePayer.slice(0, 6)])));
  check('R9 got the price + its own Ticket rent back, paid nothing for it', (await bal(R9.wallet)) - r9Paid === PRICE + ticketRent, `${(await bal(R9.wallet)) - r9Paid}`);
  check('server mirror: cancelled', !!(await until(async () => (await serverPool(P2)).status === 'cancelled', 20000)));
  check('the series moved on by itself (the crank keeps opening the next slots)', (await series()).poolsOpened >= 2);

  const noise = p => !/favicon|status of 409|status of 404/.test(p);
  const probs = browsers.flatMap(h => h.filt().filter(noise));
  check('no page errors (lobby)', probs.length === 0, probs.slice(0, 5).join(' | '));
  console.log(`screenshots: ${browsers[0]?.SHOTS}`);
} catch (e) {
  check('scenario threw', false, `${e?.stack ?? e}${e?.cause ? ` – cause: ${e.cause.code ?? ''} ${e.cause.message ?? e.cause}` : ''}`);
}
console.log(fails.length ? `\n✗ ${fails.length} failed: ${fails.join(' · ')}` : '\n✓ the autonomous day: opened by the crank, paid by the payout key after the review window, every lamport accounted for');
const code = fails.length ? 1 : 0;
for (const h of browsers) h.finish(code, 300);
if (!browsers.length) process.exit(code);
