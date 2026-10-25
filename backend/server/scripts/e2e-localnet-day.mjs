// THE AUTONOMOUS DAY of the escrow program v2 on a LOCAL chain – phase 3 of .claude/skills/localnet-e2e/run.sh (SCENARIO=day, part of `all`). A fresh
// validator holds the program + the 1h SERIES the admin wrote with the real set_series in phase 1 (its sale window – the cadence – shortened in the dump,
// the only edit: a validator's clock cannot be moved); its own server + database with the payout key (PAYOUT_SECRET) and the crank on its SCHEDULE
// (CRANK_INTERVAL_MS) – nobody runs the crank. Explained in docs/tech/localnet-e2e/index.html ("The autonomous day").
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
//      (signed); the job says `held`; release → R8 starts its ride too late (closed) → the job COMMITS
//      the plan (`committed`, public for the review lock – a pay_prize before pay_from is TooEarly); after pay_from it pays every rank with its proof
//      and closes the pool – every lamport asserted; the standings are final with each rank paid + its signature; a second pass pays nothing more
//   6. low sales keep the next pool active; an explicit admin cancellation permits crank refunds and close
//   New pledges are refused by both API and program. Historical escrow recovery runs in phase 2 against explicit genesis fixtures.
// env: BASE, RPC, KEYS, COVERAGE, DAY (phase 1's day.json), CHROME_PORT, DATABASE_URL + PAYOUT_SECRET (the CLI passes = the day server's database and key)
import { createHash } from 'node:crypto';
import nacl from 'tweetnacl'; import bs58 from 'bs58'; import { readFileSync, writeFileSync } from 'node:fs'; import { execFileSync } from 'node:child_process';
import { Connection, Keypair, PublicKey, SYSVAR_CLOCK_PUBKEY, Transaction } from '@solana/web3.js';
import { launch, sleep } from '../../../frontend/client/tools/cdp.mjs';
import { PoolProgramCodec } from '../dist/infrastructure/solana/pool-program.codec.js';
import { POOL_PROGRAM_IDL as IDL } from '../dist/infrastructure/solana/pool-program.idl.js';
import { closeSplit, prizeBound } from '../dist/domain/economy/vault-split.js';
import { poolPayouts } from '../dist/domain/economy/pool-payouts.js';
import { rankedWallets } from './localnet-rank.mjs';
import { honestUntilClear, rechain, paceRecording, uploadBatches } from './honest-traffic.mjs';
import { coverage } from './localnet-coverage.mjs';

const { BASE, RPC, KEYS, DAY } = process.env;
if (!BASE || !RPC || !KEYS || !DAY) { console.error('run it through .claude/skills/localnet-e2e/run.sh (needs BASE, RPC, KEYS, DAY)'); process.exit(2); }
const D = JSON.parse(readFileSync(DAY, 'utf8'));   // { saleSecs, playSecs, reviewSecs, minTickets, maxPerWallet, price, split }
const PRICE = D.price;   // the pool's prize/seed bps come from Config at open, not from day.json's split
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
const rentOf = async a => conn.getMinimumBalanceForRentExemption((await conn.getAccountInfo(new PublicKey(a), 'confirmed')).data.length);
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
const fetchy = async (url, init) => {
  let last;
  for (let i = 0; i < 4; i++) {
    try { return await fetch(url, init); }
    catch (e) { last = e; if (!/fetch failed/.test(e?.message) || i === 3) throw e; await sleep(400 * (i + 1)); }
  }
  throw last;
};
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
  const o = await api('tickets', { body: { poolId, qty, burnWarningAccepted: true }, cookie: p.cookie, ip: p.ip });
  if (!o.ok) return { order: o, paid: false };
  const pay = await api(`tickets/orders/${o.j.id}/payment`, { cookie: p.cookie, ip: p.ip });
  const sig = await sendSigned(signedB64(pay.j.transaction, p.kp));
  return { order: o, sig, paid: !!(await until(async () => (await api(`tickets/orders/${o.j.id}/confirm`, { body: { signature: sig }, cookie: p.cookie, ip: p.ip })).j.status === 'paid')) };
}
// The lobby opens the burn dialog before it creates an order. The checkbox has to be on or BUY stays disabled.
async function acceptBurn(h) {
  const up = await until(async () => !!(await h.ev('document.getElementById("burn-warning")')), 10000);
  if (!up) return false;
  return h.ev('(() => { const box = document.getElementById("burn-warning"); box.checked = true; box.dispatchEvent(new Event("change", { bubbles: true })); document.getElementById("burn-warning-accept").click(); return true; })()');
}

// ── a FINISHED RIDE over the player API. Frames come from the server's traffic sim. `onStart(rideId)` runs once the ride is on the road.
//    `extra` metres past max(completeDist, 1 km): a pledge settles on whole verified km.
const sha256 = text => createHash('sha256').update(text, 'utf8').digest('hex');
const LANES = [0, 0.35, -0.35, 0.7, -0.7, 1.05, -1.05, 1.4, -0.15, 0.55];
let laneSlot = 0;
async function apiRide(p, { speed = 20, extra = 60, onStart = async () => {}, mutate = () => null, hashOf = (_b, text) => sha256(text) } = {}) {
  const o = { cookie: p.cookie, ip: p.ip };
  const made = await api('rides', { body: { tier: '1h' }, ...o });
  if (!made.ok) return { error: `${made.status} ${JSON.stringify(made.j).slice(0, 160)}` };
  const ride = made.j;
  const started = await api(`rides/${ride.id}/start`, { body: {}, ...o });
  if (!started.ok) return { error: `start ${started.status} ${JSON.stringify(started.j).slice(0, 160)}` };
  await onStart(ride.id);
  const metres = Math.max(ride.completeDist ?? 0, 1000) + extra;
  const built = honestUntilClear({ rideId: ride.id, seed: ride.seed, trip: ride.trip, route: ride.route, metres, speed, laneBias: LANES[laneSlot++ % LANES.length] });
  if (built.fatal) return { error: `traffic ${built.fatal.hit} at ${Math.round(built.fatal.at)} m` };
  if (built.metres + 1 < metres) return { error: `short ${Math.round(built.metres)} < ${Math.round(metres)}` };
  const call = async (method, path, body) => { const r = await api(path, { method, body, ...o }); return { status: r.status, json: r.j }; };
  const paced = await paceRecording(call, ride.id, built.batches, built.hull);
  if (paced.status !== 200) return { error: `heartbeat ${paced.status} ${JSON.stringify(paced.json).slice(0, 180)}` };
  const batches = rechain(ride.id, built.batches, mutate, hashOf);
  const up = await uploadBatches(call, ride.id, batches);
  if (up.status !== 200) return { error: `upload ${up.status} ${JSON.stringify(up.json).slice(0, 180)}` };
  const end = await api(`rides/${ride.id}/end`, { body: { outcome: 'shift', s: built.metres, t: built.seconds, hull: built.hull }, ...o });
  return { id: ride.id, end: end.j };
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
  h.lobby = async () => { await h.send('Page.navigate', { url: `${BASE}/lobby.html#new` }); return until(async () => /BUY|RIDE|SOON/.test(await h.txt('#tier-1h')), 20000); };
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
  const live = await config();
  // open_next_pool copies the Config split onto the pool. The series row keeps whatever set_series stored, which on this program is not that split.
  check(`${label}: rules + deadlines from the series (sale ${D.saleSecs} s on the grid, play +${D.playSecs} s, review +${D.reviewSecs} s)`, p.status === 1 && p.tier === 1 && p.priceLamports === PRICE && p.minTickets === D.minTickets && p.maxPerWallet === D.maxPerWallet && p.prizeBps === live.prizeBps && p.seedBps === live.seedBps
    && secs(p.prepDeadline) === secs(sr.nextOpenAt) && secs(p.playDeadline) === secs(p.prepDeadline) + D.playSecs && secs(p.payoutAt) === secs(p.playDeadline) + D.reviewSecs && secs(p.createdAt) >= secs(p.prepDeadline) - D.saleSecs,
  JSON.stringify({ created: p.createdAt, prep: p.prepDeadline, play: p.playDeadline, payoutAt: p.payoutAt, nextOpenAt: sr.nextOpenAt }));
  const listed = await until(async () => (await api('pools')).j.pools?.find(x => x.id === id), 20000, 1000);
  check(`${label}: the server mirror registered it (GET /api/pools: open, the same deadlines)`, listed?.status === 'active' && listed.tier === '1h' && listed.payoutAt === p.payoutAt.getTime() && listed.prepDeadline === p.prepDeadline.getTime(), JSON.stringify(listed).slice(0, 240));
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
  const s4 = admintool(['set-series', '--tier', '4h', '--price', String(PRICE), '--min', '0', '--per-wallet', '2', '--sale-hours', '24', '--play-hours', '4', '--review-hours', '48', '--start', '+60', '--enabled', 'false', ...treas, ...adm]).series;
  check('set_series by the admin: a 4h series, DISABLED', s4?.enabled === false && s4.tier === 2);
  refuse('open_next_pool of a disabled series', ['open-next-pool', '--tier', '4h', '-k', Z.keyfile], 'SeriesDisabled');
  refuse('the payout key creates a pool', ['create-pool', '--tier', '1h', '--price', String(PRICE), '--min', '0', '--prep', '+600', '--play', '+700', ...treas, '-k', `${KEYS}/payout.json`], 'Unauthorized');
  refuse('the payout key writes a series', ['set-series', '--tier', '4h', '--price', String(PRICE), '--min', '0', '--sale-hours', '24', '--play-hours', '4', '--review-hours', '48', ...treas, '-k', `${KEYS}/payout.json`], 'Unauthorized');
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
  await acceptBurn(h1);
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
  console.log('     … 7 rides over the player API: R1–R5 honest, R6 an unhashed batch, R7 a teleport; R8 takes its ride but never drives it');
  const plan = { r1: { speed: 20, extra: 50 }, r2: { speed: 21, extra: 100 }, r3: { speed: 22, extra: 150 }, r4: { speed: 23, extra: 200 },
    r5: { speed: 24, extra: 250 }, r6: { speed: 25, extra: 300, hashOf: unhashed }, r7: { speed: 20, mutate: teleport } };
  const rides = {};
  const r8ride = await api('rides', { body: { tier: '1h' }, cookie: R8.cookie, ip: R8.ip });
  const disabled = await api('pledges', { body: { rideId: r8ride.j.id, lamportsPerKm: '1000000', targetKm: 2 }, cookie: S.cookie, ip: S.ip });
  check('new per-km pledges are disabled on the API', disabled.status === 403 && disabled.j.code === 'pledges_disabled', `${disabled.status} ${JSON.stringify(disabled.j)}`);
  const sponsorBefore = await bal(S.wallet);
  refuse('new per-km pledges are disabled on chain', ['create-pledge', '--pool', String(P), '--ride', r8ride.j.id, '--driver', R8.wallet, '--per-km', '1000000', '--km', '2', '-k', S.keyfile], 'PledgesDisabled');
  check('refused pledge escrows nothing and leaves the pool count unchanged', (await bal(S.wallet)) === sponsorBefore && (await poolAcc(P)).openPledges === 0);
  await Promise.all([R1, R2, R3, R4, R5, R6, R7].map(async p => { rides[p.name] = await apiRide(p, plan[p.name]); }));
  const vOf = p => rides[p.name]?.end?.verdict?.status ?? null;
  check('rides: R1–R5 COMPLETED + VERIFIED, R6 FLAGGED (unhashed-batch), R7 REJECTED (teleport)', [R1, R2, R3, R4, R5].every(p => rides[p.name].end?.status === 'completed' && vOf(p) === 'verified') && vOf(R6) === 'flagged' && vOf(R7) === 'rejected',
    JSON.stringify(Object.fromEntries(Object.entries(rides).map(([k, x]) => [k, x.error ?? [x.end?.status, x.end?.verdict?.status, (x.end?.verdict?.reasons ?? []).map(z => z.code).join('+')]]))));
  pc = await poolAcc(P);
  check('…and every ride ended before the play deadline', (await chainNow()) < secs(pc.playDeadline));

  // ── 4. the sale ends: no ticket is sold any more (an ACTIVE pool too – v2), the crank opens the next slot's pool
  await untilChain(secs(pc.prepDeadline), `pool ${P}'s sale end`);
  refuse('a buy after the sale end (the pool is ACTIVE)', ['buy', '-k', R8.keyfile, '--pool', String(P)], 'TooLate');
  refuse('a sponsorship after the sale end', ['sponsor', '--pool', String(P), '--lamports', '1000000', '-k', Z.keyfile], 'TooLate');
  const late = await api('tickets', { body: { poolId: P, qty: 1, burnWarningAccepted: true }, cookie: R8.cookie, ip: R8.ip });
  check('POST /api/tickets after the sale end: 409, nothing to sign', late.status === 409, `${late.status} ${JSON.stringify(late.j).slice(0, 160)}`);
  const P2 = await crankOpened(P, 30000);
  check('the crank opened the NEXT slot\'s pool by itself', P2 !== false && P2 > P);
  const pool2 = await checkOpened(P2, `pool ${P2} (slot 2)`);
  check(`slot 2 starts where slot 1 stopped selling (prep ${secs(pool0.prepDeadline)} + ${D.saleSecs} s)`, secs(pool2.prepDeadline) === secs(pool0.prepDeadline) + D.saleSecs);
  const b9 = await bal(R9.wallet), x9 = await buySelf(R9, P2), fee9 = x9.sig ? (await txInfo(x9.sig)).fee : 0;
  const r9Paid = await bal(R9.wallet);
  check(`R9 buys 1 of pool ${P2}: −(price + fee + Ticket rent); 1 < min ${D.minTickets}, it stays ACTIVE`, x9.paid && b9 - r9Paid === PRICE + fee9 + ticketRent && (await poolAcc(P2)).status === 1);

  // ── 5. the play deadline passes: v4 (H5-B) the payout job takes the pool now – the pool-level marks, every ride decided, then the winners root is COMMITTED
  //    (public for the review lock), then paid. Nobody pays before the root's pay_from, not even the payout key.
  await untilChain(secs(pc.playDeadline), `pool ${P}'s play deadline`);
  refuse('create_pledge after the play deadline', ['create-pledge', '--pool', String(P), '--ride', rides.r2.id, '--driver', R2.wallet, '--per-km', '1000000', '--km', '1', '-k', Z.keyfile], 'TooLate');
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
  check(`pool-level marks: the top 3 by distance (${top3.map(p => p.name)}) carry pool-new-wallet-top3, the other honest rides carry none, no pool-shared-ip`, top3.every(p => marks(p).includes('pool-new-wallet-top3') && marks(p).every(c => c === 'pool-new-wallet-top3')) && rest.filter(p => p !== R7).every(p => marks(p).length === 0) && !marks(R7).includes('pool-new-wallet-top3') && [R1, R2, R3, R4, R5, R6, R7].every(p => !marks(p).includes('pool-shared-ip')),
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
  // R8's unused ticket stays in the pot; attempting to start after the deadline closes the ride.
  const payoutSigs0 = new Set(await sigsOf(PAYOUT));
  before = await bals(everyone);
  const r8start = await api(`rides/${r8ride.j.id}/start`, { body: {}, cookie: R8.cookie, ip: R8.ip });
  check('R8 starts its ride after the play deadline: 409, the ride is closed (its ticket stays in the pot)', r8start.status === 409 && (r8start.j.code === 'rides_closed' || r8start.j.code === 'pool_last_start_passed'), `${r8start.status} ${JSON.stringify(r8start.j).slice(0, 160)}`);

  // ── 7. the payout job: first pass = the COMMIT (no prize yet); second pass after pay_from = the prizes + close
  const verifiedDay = [R1, R2, R3, R4, R5, R6];
  const want = (await rankedWallets(P, verifiedDay.map(p => p.wallet))).map(w => verifiedDay.find(p => p.wallet === w));
  check('ranking: the six verified wallets once, in score-formula order', want.length === 6 && want.every(Boolean));
  pc = await poolAcc(P);
  const bound = prizeBound({ priceLamports: PRICE, ticketsSold: 8, sponsored: SPONSOR_P, prizeBps: pc.prizeBps, seedBps: pc.seedBps, ...(pc.maxPlayerShareBps !== undefined ? { maxPlayerShareBps: pc.maxPlayerShareBps } : {}) });
  const payouts = poolPayouts(bound, want.map(p => p.wallet));
  const winnersArg = payouts.map(x => `${x.wallet}:${x.lamports}`).join(',');
  await untilChain(secs(pc.payoutAt), 'the validation window (a winners root waits until payoutAt)');
  const pass1 = cli('pool:payout', '--pool', String(P));
  const pass1Tx = await Promise.all((await sigsOf(PAYOUT)).filter(x => !payoutSigs0.has(x)).map(txInfo));
  const res1 = pass1.pools[0] ?? {};
  pc = await poolAcc(P);
  const commitTx = pass1Tx.find(t => t.ixs.join() === 'commit_winners'), commitEv = commitTx?.events.find(e => e.name === 'WinnersCommitted')?.fields;
  check(`pool:payout after the release: committed – the plan as a winners root (6 ranks, total = the table), pays from ${pc.payFrom?.toISOString?.()} (commit + the ${D.reviewSecs} s review lock), no prize in this pass`, res1.state === 'committed' && res1.paid?.length === 0 && !res1.closed && commitTx?.feePayer === PAYOUT
    && commitEv?.count === 6 && commitEv.total === payouts.reduce((a, x) => a + x.lamports, 0) && pc.winnersCount === 6 && secs(pc.payFrom) >= secs(pc.committedAt) + D.reviewSecs && secs(pc.payFrom) >= secs(pc.payoutAt) && !pass1Tx.some(t => t.events.some(e => e.name === 'PrizePaid')),
    JSON.stringify({ state: res1.state, note: res1.note, ixs: pass1Tx.map(t => t.ixs.join('+')), ev: commitEv && { count: commitEv.count, total: commitEv.total } }));
  check('the payout job creates no pledge attestations for current rides', !pass1Tx.some(t => t.ixs.includes('record_ride_attestation')));
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
  const legs = closeSplit({ priceLamports: PRICE, ticketsSold: 8, sponsored: SPONSOR_P, prizeBps: pc.prizeBps, seedBps: pc.seedBps, platformFeeBps: PLAT_BPS, ...(pc.maxPlayerShareBps !== undefined ? { maxPlayerShareBps: pc.maxPlayerShareBps } : {}), prizesPaid: paid, vaultLamports: before.vault - paid, cancelled: false, rentMin: RENT0 });
  pc = await poolAcc(P);
  check('prizes on chain = the plan, ≤ the prize share, every committed rank paid', pc.prizesPaid === paid && paid <= bound && legs.unclaimed === bound - paid && Number(pc.paidMask) === 63, `${pc.prizesPaid} / ${paid} / ${bound} mask ${pc.paidMask}`);
  check('close_pool by the payout key: fee / platform / seed legs = closeSplit, the creator (the crank) + the vault rent minimum', closeTx.feePayer === PAYOUT && closeTx.ixs.join() === 'close_pool' && closeTx.change(addr('fee')) === legs.fee && closeTx.change(addr('plat')) === legs.platformFee
    && closeTx.change(addr('seed')) === legs.seed && closeTx.change(CRANK) === RENT0 && legs.fee > 0 && legs.seed > 0, JSON.stringify({ fee: closeTx.change(addr('fee')), plat: closeTx.change(addr('plat')), seed: closeTx.change(addr('seed')), crank: closeTx.change(CRANK), legs }));
  const payoutFees = passTx.reduce((a, t) => a + t.fee, 0);
  check(`the payout key paid only the fees of its ${passTx.length} transactions`, d.payout === -payoutFees && passTx.length === 1 + 6 + 1, `${d.payout} vs −${payoutFees}`);
  check(`vault ${P} = 0, settled on chain and on the server`, after.vault === 0 && pc.status === 3 && !!(await until(async () => (await serverPool(P)).status === 'settled', 20000)));
  check('conservation: 8 tickets + sponsorship = prizes + fee + platform + seed', 8 * PRICE + SPONSOR_P === paid + legs.fee + legs.platformFee + legs.seed, `${8 * PRICE + SPONSOR_P} vs ${paid + legs.fee + legs.platformFee + legs.seed}`);
  st = await standings(P);
  check('standings: final, every rank paid with its pay_prize signature, state paid', st.final === true && st.payout?.state === 'paid' && st.ranks.length === 6 && st.ranks.every((x, i) => x.wallet === want[i].wallet && x.lamports === payouts[i].lamports && x.paid === true && x.signature === res.paid.find(y => y.wallet === x.wallet)?.signature),
    JSON.stringify(st.ranks?.map(x => [x.rank, x.wallet.slice(0, 6), x.lamports, x.paid, !!x.signature])));
  const again = cli('pool:payout', '--pool', String(P)), all = cli('pool:payout');
  check('a second payout pass pays nothing more (the pool is settled)', again.pools[0]?.state === 'paid' && again.pools[0].paid.length === 0 && !again.pools[0].closed && all.pools.every(x => x.paid.length === 0), JSON.stringify({ again: again.pools, all: all.pools }));
  refuse('pay_prize on the settled pool (payout key)', ['pay-prize', '--pool', String(P), '--winners', winnersArg, '--rank', '1', '-k', `${KEYS}/payout.json`], 'PoolNotActive');

  check('the legacy pledge worker has no current pledges to process', cli('pool:pledges').checked === 0);
  // v6: low sales never refund. An explicit cold-admin cancellation releases the ticket.
  await untilChain(secs(pool2.prepDeadline), `pool ${P2}'s sale end`);
  check('one-ticket pool remains active after sales close', (await poolAcc(P2)).status === 1 && (await bal(R9.wallet)) === r9Paid);
  refuse('v6 low sales cannot fail a pool', ['fail-pool', '--pool', String(P2), '-k', Z.keyfile], 'NotFailable');
  admintool(['cancel-pool', '--pool', String(P2), ...adm]);
  check('crank refunds and closes after explicit admin cancellation', !!(await until(async () => (await poolAcc(P2))?.status === 4, 30000, 1000)) && (await bal(codec.vaultPda(P2).toBase58())) === 0);
  check('R9 receives ticket price and rent after admin cancellation', (await bal(R9.wallet)) - r9Paid === PRICE + ticketRent);
  check('server mirror: cancelled', !!(await until(async () => (await serverPool(P2)).status === 'cancelled', 20000)));
  check('the series moved on by itself (the crank keeps opening the next slots)', (await series()).poolsOpened >= 2);

  const noise = p => !/favicon|status of 409|status of 404|road plan: server error 404/.test(p);
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
