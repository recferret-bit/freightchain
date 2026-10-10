// THE AUTONOMOUS DAY of the escrow program v2 on a LOCAL chain – phase 3 of .claude/skills/localnet-e2e/run.sh (SCENARIO=day, part of `all`). A fresh
// validator holds the program + the 1h SERIES the admin wrote with the real set_series in phase 1 (its sale window – the cadence – shortened in the dump,
// the only edit: a validator's clock cannot be moved); its own server + database with the payout key (PAYOUT_SECRET) and the crank on its SCHEDULE
// (CRANK_INTERVAL_MS) – nobody runs the crank. Explained in docs/localnet-e2e/index.html ("The autonomous day").
//   0. before the slot: no pool, a hand-sent open_next_pool is TooEarly, the payout job refuses (the program names no payout key)
//   1. the admin's last signatures: set_payout_authority (the payout key), a DISABLED 4h series (open_next_pool → SeriesDisabled); the payout key may not
//      create_pool / set_series / cancel_pool (Unauthorized)
//   2. the crank opens the pool of the slot BY ITSELF (PoolCreated.from_series, deadlines from the series' grid, the crank paid the rents, GET /api/pools)
//   3. riders buy (the lobby in Chrome + Node wallets, each −(price + fee + Ticket rent) exactly) and ride over the player API: honest ×5, one FLAGGED
//      (an unhashed batch), one cheater (a teleport → REJECTED), one buyer who never rides
//   4. the sale ends: a buy is TooLate on chain and 409 on the API; the crank opens the NEXT slot's pool, one rider buys – it will miss its minimum
//   5. play deadline → review window: the payout job pays nothing (pending), the payout key's pay_prize is TooEarly; at payout_at a stranger's is
//      Unauthorized, the job runs the pool-level marks and waits (waiting_review, the standings show underReview); a signed admin HOLD; the admin decides
//      every ride (signed); the job says `held` and pays nothing; release → the job pays the verified ranks with the payout key and closes the pool –
//      every lamport asserted; the standings are final with each rank paid + its signature; a second pass pays nothing more
//   6. the next slot's pool missed its goal: the crank fails it, refunds the rider (price + Ticket rent) and closes it – by itself
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
const MIN_LEFT = +(process.env.DAY_MIN_LEFT || 75);   // seconds of sale the funded pool needs (buys + rides); a later pool is taken when the first slot is shorter
const cov = coverage(process.env.COVERAGE || `${KEYS}/../coverage.json`);
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
const POOL_RENT = await conn.getMinimumBalanceForRentExemption(8 + 192);
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
  return { feePayer: keys[0], fee: tx.meta.fee, ixs, events, err: tx.meta.err, change: a => { const i = keys.indexOf(a); return i < 0 ? 0 : tx.meta.postBalances[i] - tx.meta.preBalances[i]; } };
}
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
  return { name, kp, wallet, keyfile, ip, cookie: await signIn(kp, ip) };
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

// ── a FINISHED RIDE over the player API (the e2e-localnet-payout.mjs / e2e-verified-play.mjs recipe): hash-chained 10 Hz batches that take the planned holes' damage
const sha256 = text => createHash('sha256').update(text, 'utf8').digest('hex');
const r = (v, d) => Math.round(v * 10 ** d) / 10 ** d;
async function apiRide(p, { seconds = 20, speed = 15, mutate = () => null, hashOf = (_b, text) => sha256(text) } = {}) {
  const o = { cookie: p.cookie, ip: p.ip };
  const made = await api('rides', { body: { tier: '1h' }, ...o });
  if (!made.ok) return { error: `${made.status} ${JSON.stringify(made.j).slice(0, 160)}` };
  const ride = made.j;
  await api(`rides/${ride.id}/start`, { body: {}, ...o });
  const d = { id: ride.id, t0: Date.now(), t: 0, s: 0, seq: 0, prevHash: ride.id, samples: [], inputs: [], bt0: 0, prompts: [], road: honestRoad(BASE, ride.id) };
  const row = (t, s, v) => [r(t, 2), r(s, 1), 2.4, 0, r(v, 2), Math.round(900 + v * 50), 6, 100, 0.6, 0, 0, 0, 12, 1 | 2 | 8];
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
    const now = Date.now(), dt = (now - wall) / 1000; wall = now;
    d.t += dt; d.s += speed * dt;
    d.samples.push(row(d.t, d.s, speed));
    const ms = now - d.t0;
    if (ms >= nextKey) {
      if (!gasDown) { d.inputs.push([r(ms, 1), 'KeyW', 1]); gasDown = true; nextKey = ms + 1500 + Math.random() * 3000; }
      else { d.inputs.push([r(ms, 1), 'KeyW', 0]); gasDown = false; const tap = Math.random() < .5 ? 'KeyA' : 'KeyD'; const at = r(ms + 100 + Math.random() * 300, 1); d.inputs.push([at, tap, 1], [r(at + 120 + Math.random() * 400, 1), tap, 0]); nextKey = ms + 400 + Math.random() * 900; }
    }
    if (d.t - d.bt0 >= 15) await cut();
    if (now - lastBeat >= 5_000) { lastBeat = now; await heartbeat(); }
    if (d.t >= seconds) break;
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
  check('a fresh program: initialized by the upgrade authority (admin named, 500 bps), no pool, no payout key yet', cfg?.authority === ADMIN && cfg.poolCount === 0 && cfg.payoutAuthority === null && cfg.platformFeeBps === 500, JSON.stringify(cfg));
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
  let pc = await poolAcc(P);
  check(`chain: 8 tickets, pool ${P} ACTIVE (min ${D.minTickets}), still inside its sale window`, pc.ticketsSold === 8 && pc.status === 1 && (await chainNow()) < secs(pc.prepDeadline), JSON.stringify({ sold: pc.ticketsSold, status: pc.status }));
  check('server mirror: active, 8 sold', !!(await until(async () => { const s = await serverPool(P); return s.status === 'active' && s.sold === 8; }, 20000)));
  console.log('     … 7 rides over the player API (≈ 25 s): R1–R5 honest, R6 an unhashed batch, R7 a teleport; R8 never rides');
  const plan = { r1: { speed: 11 }, r2: { speed: 13 }, r3: { speed: 15 }, r4: { speed: 17 }, r5: { speed: 19 }, r6: { speed: 21, hashOf: unhashed }, r7: { speed: 9, mutate: teleport } };
  const rides = {};
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
  const late = await api('tickets', { body: { poolId: P, qty: 1 }, cookie: R8.cookie, ip: R8.ip });
  check('POST /api/tickets after the sale end: 409, nothing to sign', late.status === 409, `${late.status} ${JSON.stringify(late.j).slice(0, 160)}`);
  const P2 = await crankOpened(P, 30000);
  check('the crank opened the NEXT slot\'s pool by itself', P2 !== false && P2 > P);
  const pool2 = await checkOpened(P2, `pool ${P2} (slot 2)`);
  check(`slot 2 starts where slot 1 stopped selling (prep ${secs(pool0.prepDeadline)} + ${D.saleSecs} s)`, secs(pool2.prepDeadline) === secs(pool0.prepDeadline) + D.saleSecs);
  const b9 = await bal(R9.wallet), x9 = await buySelf(R9, P2), fee9 = x9.sig ? (await txInfo(x9.sig)).fee : 0;
  const r9Paid = await bal(R9.wallet);
  check(`R9 buys 1 of pool ${P2}: −(price + fee + Ticket rent); 1 < min ${D.minTickets}, it stays OPEN`, x9.paid && b9 - r9Paid === PRICE + fee9 + ticketRent && (await poolAcc(P2)).status === 0);

  // ── 5. the play deadline passes: the review window – nobody pays, not even the payout key
  await untilChain(secs(pc.playDeadline), `pool ${P}'s play deadline`);
  const pend = cli('pool:payout', '--pool', String(P));
  check('pool:payout inside the review window: pending, nothing paid', pend.pools[0]?.state === 'pending' && pend.pools[0].paid.length === 0 && !pend.pools[0].closed, JSON.stringify(pend.pools));
  refuse('the payout key\'s pay_prize inside the review window', ['pay-prize', '--pool', String(P), '--to', R5.wallet, '--lamports', '1000000', '-k', `${KEYS}/payout.json`], 'TooEarly');
  refuse('the payout key\'s close_pool inside the review window', ['close-pool', '--pool', String(P), '-k', `${KEYS}/payout.json`], 'TooEarly');
  let st = await standings(P);
  check('standings in the review window: provisional (final false), payoutAt = the chain\'s, R6 + R7 under review', st.final === false && st.payoutAt === pc.payoutAt.getTime() && st.underReview === 2 && st.payout?.state === 'pending', JSON.stringify({ final: st.final, underReview: st.underReview, payout: st.payout }));

  // ── 6. payout_at: the job runs the pool-level marks and waits for every ride to be decided
  await untilChain(secs(pc.payoutAt), `pool ${P}'s payout time`);
  refuse('pay_prize by a stranger after payout_at', ['pay-prize', '--pool', String(P), '--to', Z.wallet, '--lamports', '1000000', '-k', Z.keyfile], 'Unauthorized');
  const wait = cli('pool:payout', '--pool', String(P));
  check('pool:payout at payout_at: waiting_review (a ride nobody decided blocks the pool), nothing paid', wait.pools[0]?.state === 'waiting_review' && wait.pools[0].paid.length === 0, JSON.stringify(wait.pools));
  const verdictOf = async p => (await api(`rides/${rides[p.name].id}`, { cookie: p.cookie, ip: p.ip })).j.verdict;
  // the marks: every completed ride counts for them (no admin decision yet) – top 3 by distance; each rider signed in from its own address
  const byDist = [R1, R2, R3, R4, R5, R6, R7].sort((a, b) => (rides[b.name].end?.distance ?? 0) - (rides[a.name].end?.distance ?? 0));
  const top3 = byDist.slice(0, 3), rest = byDist.slice(3);
  const v = Object.fromEntries(await Promise.all([R1, R2, R3, R4, R5, R6, R7].map(async p => [p.name, await verdictOf(p)])));
  const marks = p => (v[p.name]?.reasons ?? []).map(z => z.code).filter(c => c.startsWith('pool-'));
  check(`pool-level marks: the top 3 by distance (${top3.map(p => p.name)}) carry pool-new-wallet-top3, nobody else a pool mark (one address each: no pool-shared-ip)`, top3.every(p => marks(p).includes('pool-new-wallet-top3')) && rest.every(p => marks(p).length === 0) && [R1, R2, R3, R4, R5, R6, R7].every(p => !marks(p).includes('pool-shared-ip')),
    JSON.stringify(Object.fromEntries(byDist.map(p => [p.name, [v[p.name]?.status, marks(p).join('+')]]))));
  const undecided = [R1, R2, R3, R4, R5, R6, R7].filter(p => v[p.name]?.status !== 'verified');
  st = await standings(P);
  check(`standings: underReview = ${undecided.length} (${undecided.map(p => p.name)}), payout waiting_review, nothing final`, st.underReview === undecided.length && st.payout?.state === 'waiting_review' && st.final === false && undecided.some(p => p === R6) && undecided.some(p => p === R7), JSON.stringify({ underReview: st.underReview, payout: st.payout }));

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
  check('pool:payout while held: held, nothing paid, no lamport moved', hp.pools[0]?.state === 'held' && hp.pools[0].paid.length === 0 && Object.values(delta(before, after)).every(x => x === 0), JSON.stringify(hp.pools));
  st = await standings(P);
  check('standings: held, nobody under review any more', st.payout?.held === true && st.payout.state === 'held' && st.underReview === 0, JSON.stringify({ payout: st.payout, underReview: st.underReview }));
  const rel = await A.hold(P, false, null);
  check('admin releases the hold (signed)', rel.status === 200 && rel.j.held === false, `${rel.status} ${JSON.stringify(rel.j)}`);

  // ── 7. the payout job pays the verified ranks with the PAYOUT KEY and closes the pool
  const want = [R1, R2, R3, R4, R5, R6].sort((a, b) => (rides[b.name].end?.distance ?? 0) - (rides[a.name].end?.distance ?? 0));
  pc = await poolAcc(P);
  const bound = prizeBound({ priceLamports: PRICE, ticketsSold: 8, sponsored: 0, prizeBps: PRIZE_BPS, seedBps: SEED_BPS });
  const payouts = poolPayouts(bound, want.map(p => p.wallet));
  before = await bals(everyone);
  const pass = cli('pool:payout', '--pool', String(P));
  after = await bals(everyone);
  const res = pass.pools[0] ?? {}, d = delta(before, after);
  check('pool:payout after the release: paid – 6 prizes + close_pool in one pass', res.state === 'paid' && res.paid?.length === 6 && !!res.closed, JSON.stringify(res).slice(0, 400));
  console.log(`     ranking: ${want.map((p, i) => `#${i + 1} ${p.name} ${Math.round(rides[p.name].end.distance)} m → ${payouts[i].lamports}`).join(' · ')}`);
  for (const [i, p] of want.entries()) check(`rank ${i + 1} ${p.name} received exactly ${payouts[i].lamports} lamports`, d[p.name] === payouts[i].lamports && res.paid?.find(x => x.wallet === p.wallet)?.lamports === payouts[i].lamports, `${d[p.name]}`);
  check('R7 (rejected) and R8 (never rode) received nothing', d.r7 === 0 && d.r8 === 0, `${d.r7} / ${d.r8}`);
  const paid = payouts.reduce((a, x) => a + x.lamports, 0);
  const prizeTx = await Promise.all((res.paid ?? []).map(x => txInfo(x.signature)));
  check('every pay_prize was signed and paid for by the PAYOUT KEY (not the admin), one PrizePaid each', prizeTx.length === 6 && prizeTx.every(t => t.feePayer === PAYOUT && t.ixs.join() === 'pay_prize' && t.events.some(e => e.name === 'PrizePaid')), JSON.stringify(prizeTx.map(t => [t.feePayer.slice(0, 6), t.ixs])));
  if (!res.closed) throw new Error('the payout pass did not close the pool – nothing more to check');
  const closeTx = await txInfo(res.closed);
  const legs = closeSplit({ priceLamports: PRICE, ticketsSold: 8, sponsored: 0, prizeBps: PRIZE_BPS, seedBps: SEED_BPS, platformFeeBps: PLAT_BPS, prizesPaid: paid, vaultLamports: before.vault - paid, cancelled: false, rentMin: RENT0 });
  pc = await poolAcc(P);
  check('prizes on chain = the plan, ≤ the prize share', pc.prizesPaid === paid && paid <= bound && legs.unclaimed === bound - paid, `${pc.prizesPaid} / ${paid} / ${bound}`);
  check('close_pool by the payout key: fee / platform / seed legs = closeSplit, the creator (the crank) + the vault rent minimum', closeTx.feePayer === PAYOUT && closeTx.ixs.join() === 'close_pool' && closeTx.change(addr('fee')) === legs.fee && closeTx.change(addr('plat')) === legs.platformFee
    && closeTx.change(addr('seed')) === legs.seed && closeTx.change(CRANK) === RENT0 && legs.fee > 0 && legs.seed > 0, JSON.stringify({ fee: closeTx.change(addr('fee')), plat: closeTx.change(addr('plat')), seed: closeTx.change(addr('seed')), crank: closeTx.change(CRANK), legs }));
  const payoutFees = [...prizeTx, closeTx].reduce((a, t) => a + t.fee, 0);
  check('the payout key paid only the fees of its 7 transactions', d.payout === -payoutFees, `${d.payout} vs −${payoutFees}`);
  check(`vault ${P} = 0, settled on chain and on the server`, after.vault === 0 && pc.status === 3 && !!(await until(async () => (await serverPool(P)).status === 'settled', 20000)));
  check('conservation: 8 tickets = prizes + fee + platform + seed', 8 * PRICE === paid + legs.fee + legs.platformFee + legs.seed, `${8 * PRICE} vs ${paid + legs.fee + legs.platformFee + legs.seed}`);
  st = await standings(P);
  check('standings: final, every rank paid with its pay_prize signature, state paid', st.final === true && st.payout?.state === 'paid' && st.ranks.length === 6 && st.ranks.every((x, i) => x.wallet === want[i].wallet && x.lamports === payouts[i].lamports && x.paid === true && x.signature === res.paid.find(y => y.wallet === x.wallet)?.signature),
    JSON.stringify(st.ranks?.map(x => [x.rank, x.wallet.slice(0, 6), x.lamports, x.paid, !!x.signature])));
  const again = cli('pool:payout', '--pool', String(P)), all = cli('pool:payout');
  check('a second payout pass pays nothing more (the pool is settled)', again.pools[0]?.state === 'paid' && again.pools[0].paid.length === 0 && !again.pools[0].closed && all.pools.every(x => x.paid.length === 0), JSON.stringify({ again: again.pools, all: all.pools }));
  refuse('pay_prize on the settled pool (payout key)', ['pay-prize', '--pool', String(P), '--to', R5.wallet, '--lamports', '1000000', '-k', `${KEYS}/payout.json`], 'PoolNotActive');

  // ── 8. the next slot's pool missed its goal: the crank fails it, refunds R9 and closes it – by itself
  await untilChain(secs(pool2.prepDeadline), `pool ${P2}'s sale end`);
  check(`pool ${P2}: cancelled on chain by the crank (fail + refund + close), vault 0`, !!(await until(async () => (await poolAcc(P2))?.status === 4, 30000, 1000)) && (await bal(codec.vaultPda(P2).toBase58())) === 0, JSON.stringify(await poolAcc(P2)));
  const steps = await Promise.all((await sigsOf(codec.poolPda(P2).toBase58())).slice(1).map(txInfo));
  check(`…every step sent and paid for by the crank key: ${steps.map(t => t.ixs.join('+')).join(', ')}`, steps.map(t => t.ixs.join('+')).join() === 'buy_ticket,fail_pool,refund,close_pool' && steps.filter(t => t.ixs[0] !== 'buy_ticket').every(t => t.feePayer === CRANK && !t.err), JSON.stringify(steps.map(t => [t.ixs, t.feePayer.slice(0, 6)])));
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
