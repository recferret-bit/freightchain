// TEN riders, one escrowed pool, the whole money loop on a LOCAL chain – started by .claude/skills/localnet-e2e/run.sh after e2e-localnet.mjs (or alone:
// SCENARIO=payout). Real program transactions, real lamports, every balance asserted; explained in docs/tech/localnet-e2e/index.html ("Ten riders").
//   1. pool D (1h, operator-funded, ≤ 2 per wallet) – 10 wallets buy 11 tickets: the lobby in headless Chrome and Node wallets (every wallet signs AND
//      sends, pays its own fee and Ticket rent; /confirm), one wallet 2 at once; open at 9, live at 10+; a sponsorship
//   2. the rides – the FINISHED RIDES are made through the same API the game uses (no admin back door: a server that let an admin write recordings would let
//      it mint winners): every bot signs in, spends its ticket, starts, heartbeats (answers the dispatch prompts), uploads hash-chained 10 Hz recordings that
//      take the damage of the server's planned holes, and ends. One ride is the real game in Chrome. Mixed on purpose: 6 honest, one wallet with 2 rides,
//      one FLAGGED (an unhashed batch) that the admin ACCEPTS with a signed review, one cheater (a teleport → REJECTED), one crash (never completes)
//   3. "cron": `verdict:rejudge --status all` re-judges every completed ride from its telemetry (nothing may change, the admin's decision stays), and a
//      `pool:crank` pass must leave the live pool alone
//   4. after the play deadline: the payout job (devnet-payout.mjs – signs as the program authority what GET /api/pools/:id/payout builds): each ranked
//      wallet gets exactly its share, the cheater and the crash get nothing, then close_pool: fee / platform / seed (= the next pool's seed) / creator legs
//   5. every Ticket rent back to whoever advanced it (close_ticket – nothing in the server does this yet: docs/tech/escrow-open-items.md)
//   6. the seed rolls on: the seed treasury sponsors the next 1h pool with exactly what pool D left it; the lobby shows it
//   7. the rest of the program on the validator: pause, sold out, cancel_pool + refunds, an unpaid pool closed by the admin, the authority handover and
//      every error code the validator can reach – recorded into COVERAGE (scripts/localnet-coverage.mjs) for the 100 % report
// env: BASE, RPC, KEYS, CHROME_PORT, COVERAGE (file), PREP_D / PLAY_D (seconds from pool D's creation)
import { createHash } from 'node:crypto';
import nacl from 'tweetnacl'; import bs58 from 'bs58'; import { readFileSync, writeFileSync } from 'node:fs'; import { execFileSync } from 'node:child_process';
import { Connection, Keypair, PublicKey, SYSVAR_CLOCK_PUBKEY, Transaction } from '@solana/web3.js';
import { launch, sleep, driveHook } from '../../../frontend/client/tools/cdp.mjs';
import { PoolProgramCodec } from '../dist/infrastructure/solana/pool-program.codec.js';
import { POOL_PROGRAM_IDL } from '../dist/infrastructure/solana/pool-program.idl.js';
import { closeSplit, prizeBound } from '../dist/domain/economy/vault-split.js';
import { poolPayouts } from '../dist/domain/economy/pool-payouts.js';
import { rankedWallets } from './localnet-rank.mjs';
import { honestUntilClear, rechain, paceRecording, uploadBatches } from './honest-traffic.mjs';
import { coverage } from './localnet-coverage.mjs';
import { CU_LIMITS } from '../dist/infrastructure/solana/program-chain.adapter.js';
import { sealRoad } from './localnet-seal.mjs';

const { BASE, RPC, KEYS } = process.env;
if (!BASE || !RPC || !KEYS) { console.error('run it through .claude/skills/localnet-e2e/run.sh (needs BASE, RPC, KEYS)'); process.exit(2); }
const CDP = +(process.env.CHROME_PORT || 9391);
const PREP_D = +(process.env.PREP_D || 150), PLAY_D = +(process.env.PLAY_D || 270), REVIEW_D = +(process.env.REVIEW_D || 20);   // v2: payout_at = play + REVIEW_D
const PRICE = 100_000_000, SPONSOR = 1_250_000_000, SPLIT = [7000, 2000, 1000];   // 0.1 SOL a ticket, 1.25 SOL sponsored (covers 11 tickets under v5 47.4 % cap)
const cov = coverage(process.env.COVERAGE || `${KEYS}/../coverage.json`);
BigInt.prototype.toJSON ??= function () { return String(this); };   // the codec decodes Pool.paid_mask (u64 bit mask) as a BigInt
const T0 = Date.now(), fails = [];
const check = (n, ok, x = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} [${((Date.now() - T0) / 1000).toFixed(0)} s] ${n}${x ? ' – ' + x : ''}`); if (!ok) fails.push(n); return ok; };
const until = async (fn, ms = 30000, step = 500) => { for (let i = 0; i <= ms / step; i++) { const v = await fn(); if (v) return v; await sleep(step); } return false; };
const conn = new Connection(RPC, 'confirmed');
const codec = new PoolProgramCodec(POOL_PROGRAM_IDL.address);
const key = name => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(`${KEYS}/${name}.json`, 'utf8'))));
const addr = name => key(name).publicKey.toBase58();
const bal = a => conn.getBalance(new PublicKey(a), 'confirmed');
const bals = async list => Object.fromEntries(await Promise.all(Object.entries(list).map(async ([k, a]) => [k, await bal(a)])));
const delta = (b, a) => Object.fromEntries(Object.keys(a).map(k => [k, a[k] - b[k]]));
const fee = async sig => (await conn.getTransaction(sig, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 })).meta.fee;
const chainNow = async () => Number((await conn.getAccountInfo(SYSVAR_CLOCK_PUBKEY, 'confirmed')).data.readBigInt64LE(32));
const untilChain = async (ts, what) => { const left = ts - (await chainNow()); if (left > 0) console.log(`     … waiting ${left} s for ${what} (chain clock)`); while ((await chainNow()) < ts + 2) await sleep(1000); };
const account = async (name, a) => { const i = await conn.getAccountInfo(a, 'confirmed'); return i ? codec.decodeAccount(name, i.data) : null; };
const poolAcc = id => account('Pool', codec.poolPda(id));
const ticketRent = await conn.getMinimumBalanceForRentExemption(8 + 79);
const RENT0 = await conn.getMinimumBalanceForRentExemption(0);
const admintool = args => JSON.parse(execFileSync('node', ['scripts/pool-admin.mjs', ...args, '--url', RPC], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim().split('\n').pop());
const cli = (...args) => JSON.parse(execFileSync('node', ['dist/cli/index.js', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
/** a refusal on purpose: the program must answer `want` (recorded for the coverage report); nothing may land */
const refuse = (step, args, want) => {
  try { admintool(args); return check(`${step} → refused ${want}`, false, 'it LANDED'); } catch (e) {
    const got = cov.refused(step, e);
    return check(`${step} → refused ${want}`, got === want, got ?? String(e.stderr ?? e).split('\n').slice(0, 2).join(' '));
  }
};
const sha256 = text => createHash('sha256').update(text, 'utf8').digest('hex');
const r = (v, d) => Math.round(v * 10 ** d) / 10 ** d;
const ms = v => (v instanceof Date ? v.getTime() : Date.parse(v));   // pool-admin prints the codec's Dates as ISO strings

// ── HTTP as a wallet
// a socket the server closed while idle (its keep-alive timeout, 5 s – the crank / CLI steps leave such gaps) fails the next request before it is sent: once more
const fetchy = async (url, init) => {
  let last;
  for (let i = 0; i < 4; i++) {
    try { return await fetch(url, init); }
    catch (e) { last = e; if (!/fetch failed/.test(e?.message) || i === 3) throw e; await sleep(400 * (i + 1)); }
  }
  throw last;
};
const api = async (path, { body, cookie, method } = {}) => {
  const res = await fetchy(`${BASE}/api/${path}`, { method: method ?? (body ? 'POST' : 'GET'), headers: { 'content-type': 'application/json', ...(cookie && { cookie }) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, ok: res.ok, j: await res.json().catch(() => ({})) };
};
async function signIn(kp) {
  const wallet = kp.publicKey.toBase58(), { j } = await api('auth/nonce', { body: { wallet } });
  const res = await fetchy(`${BASE}/api/auth/verify`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ wallet, signature: bs58.encode(nacl.sign.detached(new TextEncoder().encode(j.message), kp.secretKey)) }) });
  if (!res.ok) throw new Error(`sign-in failed: ${res.status} ${await res.text()}`);
  const cookie = res.headers.get('set-cookie').split(';')[0];
  const offer = await api('profile/agreements', { body: { age18: true, loss: true }, cookie, method: 'PUT' });
  if (!offer.ok) throw new Error(`agreements failed: ${offer.status}`);
  return cookie;
}
async function player(name) {
  const kp = Keypair.generate(), wallet = kp.publicKey.toBase58();
  await conn.confirmTransaction(await conn.requestAirdrop(kp.publicKey, 5e9), 'confirmed');
  const keyfile = `${KEYS}/payout-${name}.json`; writeFileSync(keyfile, JSON.stringify([...kp.secretKey]));
  return { name, kp, wallet, keyfile, cookie: await signIn(kp) };
}
const signedB64 = (b64, kp) => { const tx = Transaction.from(Buffer.from(b64, 'base64')); tx.partialSign(kp); return tx; };
const sendSigned = async tx => { const sig = await conn.sendRawTransaction(tx.serialize()); await conn.confirmTransaction(sig, 'confirmed'); return sig; };
const serverPool = async id => (await api(`pools/${id}`)).j;
const myTickets = async (p, poolId) => ((await api('me', { cookie: p.cookie })).j.tickets ?? []).find(t => t.poolId === poolId);
async function buySelf(p, poolId, qty = 1) {
  const o = await api('tickets', { body: { poolId, qty, burnWarningAccepted: true }, cookie: p.cookie });
  const pay = await api(`tickets/orders/${o.j.id}/payment`, { cookie: p.cookie });
  const sig = await sendSigned(signedB64(pay.j.transaction, p.kp));
  return { sig, paid: !!(await until(async () => (await api(`tickets/orders/${o.j.id}/confirm`, { body: { signature: sig }, cookie: p.cookie })).j.status === 'paid')) };
}
// The lobby opens the burn dialog before it creates an order. The checkbox has to be on or BUY stays disabled.
async function acceptBurn(h) {
  const up = await until(async () => !!(await h.ev('document.getElementById("burn-warning")')), 10000);
  if (!up) return false;
  return h.ev('(() => { const box = document.getElementById("burn-warning"); box.checked = true; box.dispatchEvent(new Event("change", { bubbles: true })); document.getElementById("burn-warning-accept").click(); return true; })()');
}

// ── a FINISHED RIDE over the player API. The frames are the server's traffic sim (trafficVersion 1), each wallet a different line
//    so the pool's duplicate-recording mark stays quiet. `mutate` / `hashOf` run before the hash. A crash ends under the first TEN4 band, so it is not judged.
const LANES = [0, 0.35, -0.35, 0.7, -0.7, 1.05, -1.05, 1.4, -0.15, 0.55];
let laneSlot = 0;
async function apiRide(p, { speed = 20, extra = 60, mutate = () => null, hashOf = (_b, text) => sha256(text), crashAt = 0 } = {}) {
  const made = await api('rides', { body: { tier: '1h' }, cookie: p.cookie });
  if (!made.ok) return { error: `${made.status} ${JSON.stringify(made.j).slice(0, 160)}` };
  const ride = made.j;
  const started = await api(`rides/${ride.id}/start`, { body: {}, cookie: p.cookie });
  if (!started.ok) return { error: `start ${started.status} ${JSON.stringify(started.j).slice(0, 160)}` };
  const call = async (method, path, body) => { const r = await api(path, { method, body, cookie: p.cookie }); return { status: r.status, json: r.j }; };
  if (crashAt) {
    const end = await api(`rides/${ride.id}/end`, { body: { outcome: 'failed', s: 4, t: 0.4, hull: 0, reason: 'direct hit – a bus' }, cookie: p.cookie });
    return { id: ride.id, end: end.j };
  }
  const metres = Math.max(ride.completeDist ?? 0, 1000) + extra;
  const built = honestUntilClear({ rideId: ride.id, seed: ride.seed, trip: ride.trip, route: ride.route, metres, speed, laneBias: LANES[laneSlot++ % LANES.length] });
  if (built.fatal) return { error: `traffic ${built.fatal.hit} at ${Math.round(built.fatal.at)} m` };
  if (built.metres + 1 < metres) return { error: `short ${Math.round(built.metres)} < ${Math.round(metres)}` };
  const paced = await paceRecording(call, ride.id, built.batches, built.hull);
  if (paced.status !== 200) return { error: `heartbeat ${paced.status} ${JSON.stringify(paced.json).slice(0, 180)}` };
  const batches = rechain(ride.id, built.batches, mutate, hashOf);
  const up = await uploadBatches(call, ride.id, batches);
  if (up.status !== 200) return { error: `upload ${up.status} ${JSON.stringify(up.json).slice(0, 180)}` };
  const end = await api(`rides/${ride.id}/end`, { body: { outcome: 'shift', s: built.metres, t: built.seconds, hull: built.hull }, cookie: p.cookie });
  return { id: ride.id, end: end.j };
}
const teleport = b => (b.seq === 1 ? { ...b, samples: b.samples.map((row, i) => (i === 40 ? [row[0], row[1] + 500, ...row.slice(2)] : row)) } : null);
const unhashed = (b, text) => (b.seq === 1 ? null : sha256(text));

// ── the lobby + the real game in headless Chrome (a fake Phantom that signs with the throwaway key – the e2e-localnet.mjs recipe)
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
async function gameRide(h, p) {
  const made = await api('rides', { body: { tier: '1h' }, cookie: p.cookie });
  if (!made.ok) return { error: `${made.status} ${JSON.stringify(made.j).slice(0, 160)}` };
  await h.send('Page.navigate', { url: `${BASE}/play.html?ride=${made.j.id}` });
  await until(() => h.ev('!!window.__game'), 30000, 200);
  await h.ev('document.getElementById("go").click()'); await sleep(800);
  // Same pin as the money scenario. input.gas alone is not a gas key; the verdict wants a KeyW down in the recording.
  await h.ev(driveHook(20, '__game.st.park=false;__game.st.keyOn=true;__game.st.engineOn=true;__game.st.ign=null;__game.st.gear=7;__game.st.clutch=0;__game.st.brake=0;__game.input.gas=1;__game.input.brake=0;__game.input.clutch=0;__game.st.coldT=0;__game.st.strain=0;__game.st.noStall=2;'));
  await h.send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'KeyW', key: 'w' });
  const t0 = Date.now();
  while (!(await h.ev('__game.st.complete || __game.st.mode === "done" || __game.st.mode === "dead"')) && Date.now() - t0 < 90000) await sleep(200);
  await h.send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'KeyW', key: 'w' });
  await h.ev('window.dispatchEvent(new KeyboardEvent("keydown", { key: "p", code: "KeyP", bubbles: true }))'); await sleep(500);
  await h.ev('document.getElementById("endshift")?.click()');
  const end = await until(async () => { const s = (await api(`rides/${made.j.id}`, { cookie: p.cookie })).j; return s.verdict ? s : null; }, 30000, 1000);
  return { id: made.j.id, end };
}
async function adminSession(kp) {   // the ADMIN sign-in (fc_admin), not the player session – scripts/e2e-verified-deep.mjs
  const address = kp.publicKey.toBase58(), h = { 'content-type': 'application/json', 'x-fc-admin': '1' };
  const n = await (await fetchy(`${BASE}/api/admin/auth/nonce`, { method: 'POST', headers: h, body: JSON.stringify({ wallet: address }) })).json();
  const v = await fetchy(`${BASE}/api/admin/auth/verify`, { method: 'POST', headers: h, body: JSON.stringify({ wallet: address, signature: bs58.encode(nacl.sign.detached(new TextEncoder().encode(n.message), kp.secretKey)) }) });
  const cookie = v.headers.get('set-cookie')?.split(';')[0] ?? '';
  const adm = async (method, path, body) => { const res = await fetchy(`${BASE}/api/admin/${path}`, { method, headers: { ...h, cookie }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: res.status, j: await res.json().catch(() => ({})) }; };
  const override = async (id, decision, note) => {
    const { j } = await adm('POST', `rides/${id}/challenge`, { action: 'override', decision, note });
    return adm('POST', `rides/${id}/verdict`, { decision, note, signature: bs58.encode(nacl.sign.detached(new TextEncoder().encode(j.message), kp.secretKey)) });
  };
  return { cookie, adm, override };
}

try {
  const admin = key('admin'), ADMIN = admin.publicKey.toBase58();
  const treas = ['--fee-treasury', addr('fee'), '--seed-treasury', addr('seed')];
  const cfg = await account('Config', codec.configPda());
  const PLAT_BPS = cfg.platformFeeBps;
  check('Config: the admin is the program authority, nothing paused', cfg.authority === ADMIN && cfg.paused === false, JSON.stringify(cfg));

  // ── 1. pool D: three refused creations (each check of create_pool), then the real one
  const mkArgs = (tier, price, min, max, per, prep, play, split = SPLIT.join('/'), t = treas) => ['create-pool', '--tier', tier, '--price', String(price), '--min', '0', '--max', String(max), '--per-wallet', String(per), '--prep', `+${prep}`, '--play', `+${play}`, '--last-start', `+${play - 1}`, '--split', split, ...t, '-k', `${KEYS}/admin.json`];
  refuse('create_pool: shares that do not add up to 100 %', mkArgs('1h', PRICE, 10, 0, 2, 60, 120, '7000/2000/2000'), 'BpsSum');
  refuse('create_pool: a price below the rent minimum (a refund could not land)', mkArgs('1h', 1000, 10, 0, 2, 60, 120), 'PriceBelowRentMin');
  const empty = Keypair.generate().publicKey.toBase58();
  refuse('create_pool: a fee treasury that is not rent-exempt', mkArgs('1h', PRICE, 10, 0, 2, 60, 120, SPLIT.join('/'), ['--fee-treasury', empty, '--seed-treasury', addr('seed')]), 'TreasuryNotRentExempt');
  const D = admintool([...mkArgs('1h', PRICE, 10, 0, 2, PREP_D, PLAY_D), '--payout', `+${PLAY_D + REVIEW_D}`]).poolId;
  const sealD = await sealRoad({ conn, codec, admintool, id: D, keyfile: `${KEYS}/admin.json` });   // v4 (L4): no ride before the road is sealed (the crank's job on a server)
  execFileSync('node', ['dist/cli/index.js', 'pool:register', String(D), '--label', 'TEN RIDERS'], { stdio: 'ignore' });
  const vD = codec.vaultPda(D).toBase58();
  check(`pool D (#${D}, 1h, operator-funded, ≤ 2 per wallet): open on chain and on the server, vault = rent minimum, its road sealed`, (await poolAcc(D)).status === 1 && (await serverPool(D)).status === 'active' && (await bal(vD)) === RENT0 && Number(sealD?.pool.sealSlot) === 0 && Number(sealD.pool.seedSlot) > 0);
  refuse('seal_road of a pool already sealed', ['seal-road', '--pool', String(D), '-k', `${KEYS}/admin.json`], 'RoadAlreadySealed');

  // ── 2. ten wallets buy eleven tickets
  const R = []; for (let i = 1; i <= 10; i++) R.push(await player(`r${i}`));
  const [R1, R2, R3, R4, R5, R6, R7, R8, R9, R10] = R;
  const S = await player('sponsor-fan'), Z = await player('stranger');
  // R1 in the LOBBY (headless Chrome, the wallet signs AND sends)
  const h1 = await browser(R1, CDP);
  check('lobby: the 1h card offers pool D', await h1.lobby() && /BUY 1 TICKET/.test(await h1.txt('#tier-1h .buyb')), await h1.txt('#tier-1h .buyb'));
  let before = await bals({ r1: R1.wallet, vault: vD });
  await h1.ev('document.querySelector("#tier-1h .buyb").click()');
  await acceptBurn(h1);
  check('lobby: R1 paid, 1 ticket credited', await until(async () => /Paid – 1 ticket/.test(await h1.txt('#msg-1h')), 60000), await h1.txt('#msg-1h'));
  let after = await bals({ r1: R1.wallet, vault: vD });
  const sigR1 = (await conn.getSignaturesForAddress(R1.kp.publicKey, { limit: 1 }, 'confirmed'))[0]?.signature;
  check('…the wallet was asked to sign AND send, R1 −(price + fee + Ticket rent) exactly', (await h1.ev('JSON.stringify(__asked)')) === '["signAndSendTransaction"]' && !!sigR1 && before.r1 - after.r1 === PRICE + (await fee(sigR1)) + ticketRent && after.vault - before.vault === PRICE, JSON.stringify(delta(before, after)));
  await h1.shot('payout-1-lobby-bought');
  for (const p of [R2, R3, R4, R5, R6, R7, R9, R10]) {
    const b = await bal(p.wallet), { sig, paid } = await buySelf(p, D);
    check(`${p.name} buys 1 (/confirm): −(price + fee + Ticket rent) exactly`, paid && b - (await bal(p.wallet)) === PRICE + (await fee(sig)) + ticketRent);
  }
  let pd = await poolAcc(D);
  check('chain: 9 tickets sold, pool D still ACTIVE with nine tickets', pd.ticketsSold === 9 && pd.status === 1, JSON.stringify({ sold: pd.ticketsSold, status: pd.status }));
  refuse('R8 buys 3 at once (≤ 2 per wallet)', ['buy', '-k', R8.keyfile, '--pool', String(D), '--qty', '3'], 'WalletCap');
  before = await bals({ r8: R8.wallet });
  const b8 = await buySelf(R8, D, 2);
  check('R8 buys 2 at once: −(2 × price + fee + one Ticket rent) exactly', b8.paid && before.r8 - (await bal(R8.wallet)) === 2 * PRICE + (await fee(b8.sig)) + ticketRent);
  pd = await poolAcc(D);
  check('chain: 11 tickets, 10 buyers, pool D ACTIVE (the 10th ticket took it live)', pd.ticketsSold === 11 && pd.buyers === 10 && pd.status === 1, JSON.stringify({ sold: pd.ticketsSold, buyers: pd.buyers, status: pd.status }));
  refuse('sponsor 0 lamports', ['sponsor', '--pool', String(D), '--lamports', '0', '-k', S.keyfile], 'InvalidParams');
  before = await bals({ s: S.wallet, vault: vD });
  const sp = admintool(['sponsor', '--pool', String(D), '--lamports', String(SPONSOR), '-k', S.keyfile]);
  after = await bals({ s: S.wallet, vault: vD });
  const receiptRent = await conn.getMinimumBalanceForRentExemption((await conn.getAccountInfo(codec.sponsorReceiptPda(D, S.wallet), 'confirmed')).data.length);
  check('a fan sponsors 0.05 SOL: −(amount + fee + its SponsorReceipt\'s rent – v4, M8), the vault holds it', before.s - after.s === SPONSOR + (await fee(sp.signature)) + receiptRent && after.vault - before.vault === SPONSOR, `${before.s - after.s}`);
  check('server mirror: active, 11 sold, the sponsorship counted', await until(async () => { const s = await serverPool(D); return s.status === 'active' && s.sold === 11 && s.sponsoredLamports === SPONSOR; }, 20000), JSON.stringify(await serverPool(D)).slice(0, 200));
  check('every wallet holds its tickets on the server', (await Promise.all(R.map(async p => (await myTickets(p, D))?.balance === (p === R8 ? 2 : 1)))).every(Boolean));
  check(`vault D = rent + 11 × price + sponsorship`, (await bal(vD)) === RENT0 + 11 * PRICE + SPONSOR);
  // a live pool is nobody's to fail, cancel, refund or settle early
  refuse('fail_pool on the live pool D', ['fail-pool', '--pool', String(D), '-k', Z.keyfile], 'NotFailable');
  refuse('cancel_pool by a stranger on active pool D', ['cancel-pool', '--pool', String(D), '-k', Z.keyfile], 'Unauthorized');
  refuse('refund from the live pool D', ['refund', '--pool', String(D), '--buyer', R5.wallet, '-k', Z.keyfile], 'NotRefunding');
  refuse('close_ticket in the live pool D (only once settled)', ['close-ticket', '--pool', String(D), '--buyer', R5.wallet, '-k', Z.keyfile], 'NotSettled');
  // v4 (H5-B): a prize is paid only from a committed winners root – committed by the admin / payout key once the rides are over, public until its lock ends
  const probe = `${R2.wallet}:1000000`, aRide = '00000000-0000-4000-8000-000000000001';
  refuse('pay_prize before any winners root (anyone may send one – the root decides)', ['pay-prize', '--pool', String(D), '--winners', probe, '--rank', '1', '-k', Z.keyfile], 'WinnersNotCommitted');
  refuse('commit_winners by a stranger', ['commit-winners', '--pool', String(D), '--winners', probe, '-k', Z.keyfile], 'Unauthorized');
  refuse('commit_winners before the play deadline', ['commit-winners', '--pool', String(D), '--winners', probe, '-k', `${KEYS}/admin.json`], 'TooEarly');
  refuse('record_ride_attestation by a stranger', ['record-ride-attestation', '--pool', String(D), '--ride', aRide, '--driver', R2.wallet, '--km', '1', '-k', Z.keyfile], 'Unauthorized');
  refuse('record_ride_attestation VERIFIED with 0 km', ['record-ride-attestation', '--pool', String(D), '--ride', aRide, '--driver', R2.wallet, '--km', '0', '-k', `${KEYS}/admin.json`], 'ZeroVerifiedKm');

  // ── 3. the rides: finished rides over the player API (+ one in the real game), all at once
  console.log('     … 11 rides: the real game in Chrome + 10 recordings over the API, each past 1 km (≈ 60 s)');
  const plan = {
    [R2.wallet]: [{ speed: 18, extra: 60 }], [R3.wallet]: [{ speed: 19, extra: 120 }], [R4.wallet]: [{ speed: 20, extra: 180 }], [R5.wallet]: [{ speed: 21, extra: 240 }], [R6.wallet]: [{ speed: 22, extra: 300 }],
    [R7.wallet]: [{ speed: 8, crashAt: 0.4 }],                     // crashes under the first TEN4 band: FAILED, never judged
    [R8.wallet]: [{ speed: 24, extra: 30 }, { speed: 25, extra: 40 }],   // two tickets, two rides – the ranking keeps the best one
    [R9.wallet]: [{ speed: 23, extra: 360, hashOf: unhashed }],     // one batch the client "could not hash" → FLAGGED, the admin reviews it
    [R10.wallet]: [{ speed: 26, mutate: teleport }],                // +500 m in a tenth of a second → REJECTED
  };
  const rides = {};
  await Promise.all([
    gameRide(h1, R1).then(x => { rides[R1.wallet] = [x]; }),
    ...R.slice(1).map(async p => { rides[p.wallet] = []; for (const o of plan[p.wallet]) rides[p.wallet].push(await apiRide(p, o)); }),
  ]);
  const verdictOf = x => x?.end?.verdict?.status ?? null;
  check('no ride was refused at creation (each spent a ticket of pool D)', Object.values(rides).flat().every(x => !x.error), JSON.stringify(Object.values(rides).flat().filter(x => x.error)));
  check('R1 (the real game) + R2–R6 + both of R8: COMPLETED and VERIFIED', [R1, R2, R3, R4, R5, R6, R8].every(p => rides[p.wallet].every(x => x.end?.status === 'completed' && verdictOf(x) === 'verified')),
    JSON.stringify(Object.fromEntries([R1, R2, R3, R4, R5, R6, R8].map(p => [p.name, rides[p.wallet].map(x => [x.end?.status, verdictOf(x), (x.end?.verdict?.reasons ?? []).map(z => z.code)])]))));
  check('R7 crashed: FAILED, no verdict (only completed shifts are judged)', rides[R7.wallet][0].end?.status === 'failed' && !rides[R7.wallet][0].end?.verdict, JSON.stringify(rides[R7.wallet][0].end).slice(0, 160));
  check('R9: COMPLETED but FLAGGED (unhashed-batch)', rides[R9.wallet][0].end?.status === 'completed' && verdictOf(rides[R9.wallet][0]) === 'flagged' && rides[R9.wallet][0].end.verdict.reasons.some(z => z.code === 'unhashed-batch'), JSON.stringify(rides[R9.wallet][0].end?.verdict));
  check('R10: COMPLETED but REJECTED (teleport)', rides[R10.wallet][0].end?.status === 'completed' && verdictOf(rides[R10.wallet][0]) === 'rejected' && rides[R10.wallet][0].end.verdict.reasons.some(z => z.code === 'teleport'), JSON.stringify(rides[R10.wallet][0].end?.verdict));
  check('every ticket of pool D spent', (await Promise.all(R.map(async p => (await myTickets(p, D))?.balance === 0))).every(Boolean));

  // the admin's signed review of R9's flagged ride: ACCEPT – the one admin action that changes a payout
  const A = await adminSession(admin);
  const acc = await A.override(rides[R9.wallet][0].id, 'verified', 'payout e2e: the unhashed batch is a known client hiccup');
  const r9 = (await api(`rides/${rides[R9.wallet][0].id}`, { cookie: R9.cookie })).j.verdict;
  check('admin ACCEPTS R9 (signed review): verified, by the admin wallet', acc.status === 200 && r9?.status === 'verified' && r9?.override?.by === ADMIN, `${acc.status} ${JSON.stringify(r9)}`);
  // a machine-rejected ride waits for an admin's decision too (the payout gate, WP2 review): the admin confirms R10's rejection (signed)
  const rej = await A.override(rides[R10.wallet][0].id, 'rejected', 'payout e2e: the teleport stands');
  const r10 = (await api(`rides/${rides[R10.wallet][0].id}`, { cookie: R10.cookie })).j.verdict;
  check('admin CONFIRMS R10\'s rejection (signed review): rejected, by the admin wallet', rej.status === 200 && r10?.status === 'rejected' && r10?.override?.by === ADMIN, `${rej.status} ${JSON.stringify(r10)}`);

  // ── 4. "cron": re-judge every completed ride from its telemetry, then a crank pass
  const rj = cli('verdict:rejudge', '--status', 'all');
  const after9 = (await api(`rides/${rides[R9.wallet][0].id}`, { cookie: R9.cookie })).j.verdict, after10 = (await api(`rides/${rides[R10.wallet][0].id}`, { cookie: R10.cookie })).j.verdict;
  check('cron verdict:rejudge --status all: re-judged the completed rides; R9 keeps the admin\'s decision, R10 stays rejected', after9?.status === 'verified' && after9?.override && after10?.status === 'rejected', JSON.stringify(rj).slice(0, 300));
  const crank = cli('pool:crank');
  check('cron pool:crank: nothing to do for the live pool D', !crank.actions.some(a => a.poolId === D), JSON.stringify(crank.actions));
  // pool L: opened now and sealed LATE on purpose (no crank pass runs before it) – seal_road then walks most of the 512-entry SlotHashes: its worst case in CU
  const L = admintool(mkArgs('8h', PRICE, 1, 0, 1, 3600, 3700)).poolId, lTarget = Number((await poolAcc(L)).sealSlot);
  check('GET payout before the payout time: 409 too_early (admin), 403 (a rider)', (await api(`pools/${D}/payout`, { cookie: await signIn(admin) })).status === 409 && (await api(`pools/${D}/payout`, { cookie: R1.cookie })).status === 403);

  // ── 5. the sale ends (v2: an ACTIVE pool stops selling too), the play deadline passes, the review window binds the admin too; then the payout job pays
  await untilChain(Number((await poolAcc(D)).prepDeadline.getTime() / 1000), 'pool D sale end');
  refuse('buy into the ACTIVE pool D after its sale end', ['buy', '-k', Z.keyfile, '--pool', String(D)], 'TooLate');
  const lateBuy = await api('tickets', { body: { poolId: D, qty: 1, burnWarningAccepted: true }, cookie: Z.cookie });
  check('POST /api/tickets after the sale end: 409', lateBuy.status === 409, `${lateBuy.status} ${JSON.stringify(lateBuy.j).slice(0, 120)}`);
  await untilChain(Number((await poolAcc(D)).playDeadline.getTime() / 1000), 'pool D play deadline');
  pd = await poolAcc(D);
  const bound = prizeBound({ priceLamports: PRICE, ticketsSold: 11, sponsored: SPONSOR, prizeBps: SPLIT[0], seedBps: SPLIT[1] });
  check('the pot counts EVERY ticket – the crash\'s and the cheater\'s money stays in it', pd.ticketsSold === 11 && pd.sponsored === SPONSOR && bound === Math.floor((11 * PRICE + SPONSOR) * SPLIT[0] / 10_000));
  // the expected ranking: the counted verified wallets, once, in the score-formula order the payout handler pays (best ride)
  const counted = [R1, R2, R3, R4, R5, R6, R8, R9];
  const dist = p => rides[p.wallet].reduce((a, x) => a + (x.end?.distance ?? 0), 0);
  const want = (await rankedWallets(D, counted.map(p => p.wallet))).map(w => counted.find(p => p.wallet === w));
  check('ranking: 8 counted wallets once, crash and cheater out', want.length === 8 && want.every(Boolean));
  const payouts = poolPayouts(bound, want.map(p => p.wallet));
  const winnersArg = payouts.map(x => `${x.wallet}:${x.lamports}`).join(',');
  // v4 (H5-B): the winners are committed at the PLAY deadline (inside the review window) – GET payout offers the commit, not prizes
  const adminCookie = await signIn(admin);
  let po = await api(`pools/${D}/payout`, { cookie: adminCookie });
  check('GET payout at the play deadline (inside the review window): 8 ranked wallets by the score formula (crash + cheater out), amounts = the payout table, cap = the prize share; commit_winners offered, no prize yet',
    po.ok && po.j.prizeLamports === bound && po.j.ranks.map(x => x.wallet).join() === want.map(p => p.wallet).join() && po.j.ranks.map(x => x.lamports).join() === payouts.map(x => x.lamports).join() && !!po.j.commit && po.j.transactions.length === 0 && po.j.committedRoot === null,
    JSON.stringify(po.j.ranks ?? po.j).slice(0, 400));
  console.log(`     ranking: ${want.map((p, i) => `#${i + 1} ${p.name} ${Math.round(dist(p))} m → ${payouts[i].lamports}`).join(' · ')}`);
  const dry = execFileSync('node', ['scripts/devnet-payout.mjs', String(D)], { encoding: 'utf8', env: { ...process.env, BASE, RPC, ADMIN: `${KEYS}/admin.json` } });
  check('devnet-payout.mjs (dry run) at the play deadline: prints the ranked plan, offers commit_winners, sends nothing without --yes', /ranked wallet/.test(dry) && /nothing committed yet/.test(dry) && /commit_winners to sign/.test(dry) && /rerun with --yes/.test(dry) && (await poolAcc(D)).winnersCount === 0, dry.trim().split('\n').slice(-2).join(' | '));
  // a WRONG root first – the admin's (or a stolen payout key's) mistake: public for the whole lock, and the cold admin's veto strikes it
  const emptyWallet = Keypair.generate().publicKey.toBase58(), wrong = `${vD}:1000000,${emptyWallet}:1000`;
  refuse('commit_winners above the prize share', ['commit-winners', '--pool', String(D), '--winners', `${R2.wallet}:${bound + 1}`, '-k', `${KEYS}/admin.json`], 'PrizeExceedsShare');
  const wc = admintool(['commit-winners', '--pool', String(D), '--winners', wrong, '-k', `${KEYS}/admin.json`]).pool;
  check('commit_winners of a wrong list (the vault + an empty wallet) lands: public now, pays only from max(payout_at, commit + the review lock)', wc.winnersCount === 2 && ms(wc.payFrom) >= ms(wc.payoutAt) && ms(wc.payFrom) >= ms(wc.committedAt) + REVIEW_D * 1000, JSON.stringify({ at: wc.committedAt, from: wc.payFrom, payoutAt: wc.payoutAt }));
  refuse('commit_winners while a root is committed', ['commit-winners', '--pool', String(D), '--winners', winnersArg, '-k', `${KEYS}/admin.json`], 'WinnersCommitted');
  refuse('pay_prize inside the lock (anyone)', ['pay-prize', '--pool', String(D), '--winners', wrong, '--rank', '2', '-k', Z.keyfile], 'TooEarly');
  refuse('pay_prize into the vault itself (even as a committed leaf)', ['pay-prize', '--pool', String(D), '--winners', wrong, '--rank', '1', '-k', Z.keyfile], 'AccountMismatch');
  refuse('veto_winners by a stranger (the cold admin only)', ['veto-winners', '--pool', String(D), '-k', Z.keyfile], 'Unauthorized');
  po = await api(`pools/${D}/payout`, { cookie: adminCookie });
  check('GET payout: the committed root is not the ranking → veto offered, nothing to pay', po.ok && po.j.committedRoot === wc.winnersRoot && !!po.j.veto && !po.j.commit && po.j.transactions.length === 0 && /not the ranking/.test(po.j.note ?? ''), JSON.stringify({ note: po.j.note, veto: !!po.j.veto }));
  await untilChain(Math.ceil(ms(wc.payFrom) / 1000), 'the wrong root\'s lock');
  refuse('pay_prize of a committed leaf that leaves an empty wallet below the rent minimum', ['pay-prize', '--pool', String(D), '--winners', wrong, '--rank', '2', '-k', Z.keyfile], 'BelowRentMin');
  refuse('pay_prize with a proof that is not the committed root\'s', ['pay-prize', '--pool', String(D), '--winners', `${R2.wallet}:1000,${emptyWallet}:1000`, '--rank', '1', '-k', Z.keyfile], 'InvalidProof');
  const vetoRun = execFileSync('node', ['scripts/devnet-payout.mjs', String(D), '--yes', '--veto'], { encoding: 'utf8', env: { ...process.env, BASE, RPC, ADMIN: `${KEYS}/admin.json` } });
  const vetoSig = /veto_winners: ([1-9A-HJ-NP-Za-km-z]{80,90})/.exec(vetoRun)?.[1];
  pd = await poolAcc(D);
  check('the admin vetoes the wrong root (devnet-payout.mjs --veto): WinnersVetoed, no root, nothing paid', !!vetoSig && pd.winnersCount === 0 && pd.committedAt.getTime() === 0 && pd.prizesPaid === 0, vetoRun.trim().split('\n').slice(-2).join(' | '));
  refuse('veto_winners with no root', ['veto-winners', '--pool', String(D), '-k', `${KEYS}/admin.json`], 'WinnersNotCommitted');
  {
    let sl = await conn.getSlot('confirmed');
    while (sl < lTarget + 440) { await sleep(1000); sl = await conn.getSlot('confirmed'); }
    if (sl > lTarget + 500) console.log(`NOTE pool ${L}: ${sl - lTarget} slots after its target – too close to the window's end for the worst-case seal measurement, skipped`);
    else {
      const ls = admintool(['seal-road', '--pool', String(L), '-k', Z.keyfile]);
      const lt = await conn.getTransaction(ls.signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
      const lines = codec.programData(lt.meta.logMessages), units = lt.meta.computeUnitsConsumed;
      check(`seal_road ${lt.slot - lTarget} slots after its target (near the oldest end of the 512-entry SlotHashes): RoadSealed, ${units} CU – under the crank's CU_LIMITS.seal_road ${CU_LIMITS.seal_road}`,
        lines !== 'truncated' && lines.some(l => codec.decodeEvent(l.bytes)?.name === 'RoadSealed') && Number(ls.pool.sealSlot) === 0 && units < CU_LIMITS.seal_road, `${units} CU`);
    }
  }
  // the admin's payout job (devnet-payout.mjs --yes: what the admin page signs): commits the ranking, waits out its lock on the chain clock, pays every rank, closes
  const everyone = { ...Object.fromEntries(R.map(p => [p.name, p.wallet])), fee: addr('fee'), plat: addr('plat'), seed: addr('seed'), admin: ADMIN, vault: vD };
  before = await bals(everyone);
  const vaultBefore = before.vault;
  const job = execFileSync('node', ['scripts/devnet-payout.mjs', String(D), '--yes'], { encoding: 'utf8', env: { ...process.env, BASE, RPC, ADMIN: `${KEYS}/admin.json` } });
  after = await bals(everyone);
  const d = delta(before, after);
  const sigs = [...job.matchAll(/: ([1-9A-HJ-NP-Za-km-z]{80,90})$/gm)].map(m => m[1]);
  check('payout job: commit_winners + 8 pay_prize + close_pool sent', sigs.length === 10, job.trim().split('\n').slice(-3).join(' | '));
  const txs = await Promise.all(sigs.map(async x => ({ sig: x, tx: await conn.getTransaction(x, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 }) })));
  const evOf = t => { const l = codec.programData(t.tx.meta.logMessages ?? []); return l === 'truncated' ? [] : l.map(z => codec.decodeEvent(z.bytes)).filter(Boolean); };
  const ixOf = t => t.tx.meta.logMessages.filter(l => /^Program log: Instruction: /.test(l)).map(l => l.replace('Program log: Instruction: ', ''));
  const commitEv = evOf(txs[0]).find(e => e.name === 'WinnersCommitted')?.fields, prizeTx = txs.slice(1, 9);
  check('the job\'s first transaction is the commit (WinnersCommitted: 8 ranks, total = the plan) – it lands before any PrizePaid', !!commitEv && commitEv.count === 8 && commitEv.total === payouts.reduce((a, x) => a + x.lamports, 0) && prizeTx.every(t => t.tx.slot > txs[0].tx.slot), JSON.stringify(commitEv));
  const payFromS = Math.floor(new Date(commitEv?.payFrom ?? 0).getTime() / 1000);
  check(`no PrizePaid before the root's pay_from (${new Date(payFromS * 1000).toISOString()}: commit + the ${REVIEW_D} s review lock) – each pay_prize's block time is past it`, prizeTx.every(t => t.tx.blockTime >= payFromS) && payFromS >= Math.floor(new Date(commitEv?.committedAt ?? 0).getTime() / 1000) + REVIEW_D, prizeTx.map(t => t.tx.blockTime - payFromS).join(','));
  check('PrizePaid.rank is the 0-based leaf index: rank 1 … 8 → 0 … 7, each to its committed wallet', prizeTx.every((t, i) => { const e = evOf(t).find(x => x.name === 'PrizePaid')?.fields; return e?.rank === i && e.to === payouts[i].wallet && e.lamports === payouts[i].lamports; }), JSON.stringify(prizeTx.map(t => evOf(t).find(x => x.name === 'PrizePaid')?.fields?.rank)));
  check('attestations only for PLEDGED rides: no pledge in pool D → the job wrote no RideAttestation (commit, 8 pay_prize, close_pool – nothing else)', txs.map(ixOf).flat().join() === ['CommitWinners', ...Array(8).fill('PayPrize'), 'ClosePool'].join(), txs.map(ixOf).flat().join());
  for (const [i, p] of want.entries()) check(`rank ${i + 1} ${p.name} received exactly ${payouts[i].lamports} lamports`, d[p.name] === payouts[i].lamports, `${d[p.name]}`);
  check('R7 (crash) and R10 (cheater) received nothing', d.r7 === 0 && d.r10 === 0, `${d.r7} / ${d.r10}`);
  const paid = payouts.reduce((a, x) => a + x.lamports, 0);
  pd = await poolAcc(D);
  const legs = closeSplit({ priceLamports: PRICE, ticketsSold: 11, sponsored: SPONSOR, prizeBps: SPLIT[0], seedBps: SPLIT[1], platformFeeBps: PLAT_BPS, prizesPaid: paid, vaultLamports: vaultBefore - paid, cancelled: false, rentMin: RENT0 });
  const adminFees = (await Promise.all(sigs.map(fee))).reduce((a, b) => a + b, 0);
  check('prizes on chain = the table, ≤ the prize share, every committed rank paid; the rounding stays unclaimed', pd.prizesPaid === paid && paid <= bound && legs.unclaimed === bound - paid && Number(pd.paidMask) === 255, `${pd.prizesPaid} / ${paid} / ${bound} mask ${pd.paidMask}`);
  check('fee treasury: exactly its leg', d.fee === legs.fee && legs.fee > 0, `${d.fee} vs ${legs.fee}`);
  check(`platform treasury: exactly ${PLAT_BPS} bps of the fee share`, d.plat === legs.platformFee && (PLAT_BPS === 0 || legs.platformFee > 0), `${d.plat} vs ${legs.platformFee}`);
  check('seed treasury (the next pool\'s seed): seed share + unclaimed prize', d.seed === legs.seed && legs.seed > 0, `${d.seed} vs ${legs.seed}`);
  check('creator (admin): + the vault rent minimum − the fees of the 10 transactions it signed', d.admin === RENT0 - adminFees, `${d.admin} vs ${RENT0 - adminFees}`);
  check('vault D = 0, settled on chain and on the server', after.vault === 0 && pd.status === 3 && await until(async () => (await serverPool(D)).status === 'settled'));
  check('conservation: 11 tickets + sponsorship = prizes + fee + platform + seed', 11 * PRICE + SPONSOR === paid + legs.fee + legs.platformFee + legs.seed, `${11 * PRICE + SPONSOR} vs ${paid + legs.fee + legs.platformFee + legs.seed}`);
  refuse('pay_prize on the settled pool D', ['pay-prize', '--pool', String(D), '--winners', winnersArg, '--rank', '1', '-k', Z.keyfile], 'PoolNotActive');
  refuse('close_sponsor_receipt with nothing to close (a stranger never sponsored D)', ['close-sponsor-receipt', '--pool', String(D), '--sponsor', Z.wallet, '-k', Z.keyfile], 'AccountNotInitialized');
  before = await bals({ s: S.wallet });
  admintool(['close-sponsor-receipt', '--pool', String(D), '--sponsor', S.wallet, '-k', Z.keyfile]);
  check('close_sponsor_receipt of the settled pool D (a stranger sends it): the fan gets the receipt\'s rent back', (await bal(S.wallet)) - before.s === receiptRent && (await conn.getAccountInfo(codec.sponsorReceiptPda(D, S.wallet), 'confirmed')) === null, `${(await bal(S.wallet)) - before.s}`);

  // ── 6. the Ticket rents: close_ticket (permissionless) gives each back to whoever paid it – the buyer
  const payers = { ...Object.fromEntries(R.map(p => [p.name, p.wallet])), z: Z.wallet };
  before = await bals(payers);
  const ctSigs = []; for (const p of R) ctSigs.push(admintool(['close-ticket', '--pool', String(D), '--buyer', p.wallet, '-k', Z.keyfile]).signature);
  after = await bals(payers);
  const dt = delta(before, after);
  check('close_ticket ×10 by a stranger: every buyer got its own Ticket rent back', R.every(p => dt[p.name] === ticketRent), JSON.stringify(dt));
  check('…the stranger paid only the fees; every Ticket account is gone', -dt.z === (await Promise.all(ctSigs.map(fee))).reduce((a, b) => a + b, 0) && (await Promise.all(R.map(p => conn.getAccountInfo(codec.ticketPda(D, p.wallet))))).every(x => x === null));

  // ── 7. the seed rolls on: the seed treasury sponsors the next 1h pool with what pool D left it (an operator step – no code moves it by itself)
  const E = admintool(mkArgs('1h', PRICE, 2, 0, 2, 900, 1200)).poolId;
  await sealRoad({ conn, codec, admintool, id: E, keyfile: Z.keyfile });   // anyone may seal (permissionless)
  execFileSync('node', ['dist/cli/index.js', 'pool:register', String(E), '--label', 'NEXT WEEK'], { stdio: 'ignore' });
  const seedFromD = d.seed;
  before = await bals({ seed: addr('seed'), vault: codec.vaultPda(E).toBase58() });
  const se = admintool(['sponsor', '--pool', String(E), '--lamports', String(seedFromD), '-k', `${KEYS}/seed.json`]);
  after = await bals({ seed: addr('seed'), vault: codec.vaultPda(E).toBase58() });
  check('the seed treasury sponsors pool E with exactly pool D\'s seed leg (+ its fee and the SponsorReceipt\'s rent)', after.vault - before.vault === seedFromD && before.seed - after.seed === seedFromD + (await fee(se.signature)) + receiptRent && se.pool.sponsored === seedFromD, `${before.seed - after.seed}`);
  const eBound = prizeBound({ priceLamports: PRICE, ticketsSold: 0, sponsored: seedFromD, prizeBps: SPLIT[0], seedBps: SPLIT[1] });
  check(`pool E's prize cap before a single ticket: ${eBound} lamports (70 % of the rolled-over seed)`, eBound === Math.floor(seedFromD * SPLIT[0] / 10_000) && eBound > 0);
  check('server mirror: pool E open with the sponsorship', await until(async () => { const s = await serverPool(E); return s.status === 'active' && s.sponsoredLamports === seedFromD; }, 20000), JSON.stringify(await serverPool(E)).slice(0, 200));
  await h1.lobby();
  const seedTxt = `sponsored ${(seedFromD / 1e9).toFixed(seedFromD >= 1e9 ? 2 : 3)} SOL`;
  check(`lobby: the 1h card shows the next pool with "${seedTxt}"`, !!(await until(async () => (await h1.txt('#tier-1h')).includes(seedTxt), 15000)), (await h1.txt('#tier-1h')).slice(0, 240));
  await h1.shot('payout-2-next-seed');

  // ── 8. the rest of the program on the validator (coverage): pause, sold out, cancel + refunds, an unpaid pool closed by the admin, the handover
  const adm = ['-k', `${KEYS}/admin.json`];
  admintool(['set-config', '--paused', 'true', ...adm]);
  check('set_config: paused', (await account('Config', codec.configPda())).paused === true);
  refuse('buy while paused', ['buy', '-k', Z.keyfile, '--pool', String(E)], 'Paused');
  refuse('create_pool while paused', mkArgs('4h', PRICE, 1, 1, 1, 30, 40), 'Paused');
  admintool(['set-config', '--paused', 'false', ...adm]);
  check('set_config: running again', (await account('Config', codec.configPda())).paused === false);
  // v4 floors: the cold admin may raise them – a new pool must then leave that long after its sale (min_finish_secs) / its play deadline (min_review_secs)
  refuse('set_config cannot raise the finish floor above two hours', ['set-config', '--min-finish-secs', '7201', ...adm], 'InvalidParams');
  const fl = admintool(['set-config', '--min-finish-secs', '7200', ...adm]).config;
  check('set_config: the finish floor raised to 7200 s (FloorsSet)', ms(fl.minFinishSecs) === 7_200_000, JSON.stringify(fl.minFinishSecs));
  refuse('create_pool with a play window under the finish floor', mkArgs('4h', PRICE, 1, 1, 1, 30, 40), 'WindowTooShort');
  admintool(['set-config', '--min-finish-secs', '0', ...adm]);
  refuse('migrate_config_v4 of a Config already in the v4 layout', ['migrate-config', ...adm], 'AlreadyMigrated');
  // F: one ticket max – sold out at the second; never paid a prize: the admin commits NO winner after the deadline and closes it (the prize share goes to the seed)
  const F = admintool(mkArgs('4h', PRICE, 1, 1, 1, 25, 35)).poolId;
  admintool(['buy', '-k', Z.keyfile, '--pool', String(F)]);
  refuse('buy into a sold-out pool', ['buy', '-k', R2.keyfile, '--pool', String(F)], 'SoldOut');
  // G: open, one buyer and a sponsor – the admin cancels it, the refunds follow (v4, M8: the sponsor's too)
  const G = admintool(mkArgs('8h', PRICE, 5, 0, 2, 900, 1200)).poolId;
  admintool(['buy', '-k', R3.keyfile, '--pool', String(G)]);
  admintool(['sponsor', '--pool', String(G), '--lamports', '20000000', '-k', S.keyfile]);
  refuse('refund_sponsor of a pool that still sells', ['refund-sponsor', '--pool', String(G), '--sponsor', S.wallet, '-k', Z.keyfile], 'NotRefunding');
  refuse('cancel_pool by a stranger', ['cancel-pool', '--pool', String(G), '-k', Z.keyfile], 'Unauthorized');
  admintool(['cancel-pool', '--pool', String(G), ...adm]);
  check('cancel_pool: G refunding', (await poolAcc(G)).status === 2);
  refuse('buy into a cancelled pool', ['buy', '-k', R4.keyfile, '--pool', String(G)], 'PoolNotOpen');
  refuse('record_ride_attestation in a pool that never went live (refunding)', ['record-ride-attestation', '--pool', String(G), '--ride', aRide, '--driver', R3.wallet, '--km', '1', ...adm], 'PoolNotActive');
  refuse('pay_prize from a refunding pool', ['pay-prize', '--pool', String(G), '--winners', `${R3.wallet}:1000000`, '--rank', '1', '-k', Z.keyfile], 'PoolNotActive');
  refuse('commit_winners on a refunding pool', ['commit-winners', '--pool', String(G), '--winners', `${R3.wallet}:1000000`, ...adm], 'PoolNotActive');
  refuse('close_pool before every ticket is refunded', ['close-pool', '--pool', String(G), '-k', Z.keyfile], 'RefundsPending');
  before = await bals({ r3: R3.wallet });
  admintool(['refund', '--pool', String(G), '--buyer', R3.wallet, '-k', Z.keyfile]);
  check('refund by a stranger: R3 + price + its own Ticket rent', (await bal(R3.wallet)) - before.r3 === PRICE + ticketRent);
  refuse('the same refund again', ['refund', '--pool', String(G), '--buyer', R3.wallet, '--rent-payer', R3.wallet, '-k', Z.keyfile], 'AlreadyRefunded');
  refuse('close_pool before the sponsor is refunded (v4, M8)', ['close-pool', '--pool', String(G), '-k', Z.keyfile], 'SponsorRefundsPending');
  before = await bals({ s: S.wallet });
  admintool(['refund-sponsor', '--pool', String(G), '--sponsor', S.wallet, '-k', Z.keyfile]);
  check('refund_sponsor by a stranger: the sponsor gets its 0.02 SOL + the receipt\'s rent back', (await bal(S.wallet)) - before.s === 20_000_000 + receiptRent && (await poolAcc(G)).sponsorRefunded === 20_000_000, `${(await bal(S.wallet)) - before.s}`);
  admintool(['close-pool', '--pool', String(G), '-k', Z.keyfile]);
  check('G closed by a stranger: cancelled, vault 0', (await poolAcc(G)).status === 4 && (await bal(codec.vaultPda(G))) === 0);
  refuse('close_sponsor_receipt of a cancelled pool (refunded, the receipt is gone)', ['close-sponsor-receipt', '--pool', String(G), '--sponsor', S.wallet, '-k', Z.keyfile], 'AccountNotInitialized');
  await untilChain(Number((await poolAcc(F)).playDeadline.getTime() / 1000), 'pool F play deadline');
  const pf0 = await poolAcc(F), fv = await bal(codec.vaultPda(F));
  const fLegs = closeSplit({ priceLamports: PRICE, ticketsSold: 1, sponsored: 0, prizeBps: SPLIT[0], seedBps: SPLIT[1], platformFeeBps: PLAT_BPS, ...(pf0.maxPlayerShareBps !== undefined ? { maxPlayerShareBps: pf0.maxPlayerShareBps } : {}), prizesPaid: 0, vaultLamports: fv, cancelled: false, rentMin: RENT0 });
  refuse('close_pool of an active pool with no winners root', ['close-pool', '--pool', String(F), ...adm], 'WinnersNotCommitted');
  const fc = admintool(['commit-winners', '--pool', String(F), '--winners', 'none', ...adm]).pool;
  check('commit_winners with no winner (count 0): the pool may close, its prize share unclaimed', fc.winnersCount === 0 && ms(fc.committedAt) > 0 && fc.winnersTotal === 0, JSON.stringify({ count: fc.winnersCount, at: fc.committedAt }));
  before = await bals({ seed: addr('seed'), fee: addr('fee') });
  admintool(['close-pool', '--pool', String(F), ...adm]);
  after = await bals({ seed: addr('seed'), fee: addr('fee') });
  check('the admin closes F without paying a prize: the whole pot goes to the seed (unclaimed + ticket excess above the sponsorship cap)', (await poolAcc(F)).status === 3 && after.seed - before.seed === fLegs.seed && fLegs.seed === PRICE && after.fee - before.fee === fLegs.fee);
  // v4 (L4): a pool nobody sealed in time – phase 1's REARM pool (never sealed; the crank leaves it alone, see localnet-fixtures.mjs): its seal slot has left
  // the SlotHashes window, so the first seal_road can only re-arm it a few slots ahead; the next one seals it
  const FX = process.env.FIXTURES ? JSON.parse(readFileSync(process.env.FIXTURES, 'utf8')) : null;
  if (FX?.rearmPool !== undefined) {
    const RA = FX.rearmPool, p0 = await poolAcc(RA);
    let slot = await conn.getSlot('confirmed');
    if (slot <= Number(p0.sealSlot) + 520) { console.log(`     … waiting for slot ${Number(p0.sealSlot) + 520} (the seal slot leaves the SlotHashes window)`); while ((slot = await conn.getSlot('confirmed')) <= Number(p0.sealSlot) + 520) await sleep(2000); }
    check(`pool ${RA} (opened in phase 1, never sealed): open, its seal slot ${p0.sealSlot} has left the 512-slot SlotHashes window (slot ${slot})`, p0.status === 1 && Number(p0.sealSlot) > 0 && /^A+=*$/.test(p0.seedCommitment));
    const rr = admintool(['seal-road', '--pool', String(RA), '-k', Z.keyfile]);
    const lines = codec.programData((await conn.getTransaction(rr.signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 })).meta.logMessages);
    const evs = lines === 'truncated' ? [] : lines.map(l => codec.decodeEvent(l.bytes)).filter(Boolean);
    const re = evs.find(e => e.name === 'SealRearmed')?.fields;
    check('seal_road re-arms it (SealRearmed): a new target a few slots ahead, still no road', !!re && re.sealSlot === Number(rr.pool.sealSlot) && Number(rr.pool.sealSlot) > slot && !evs.some(e => e.name === 'RoadSealed') && /^A+=*$/.test(rr.pool.seedCommitment), JSON.stringify({ re, seal: rr.pool.sealSlot, slot }));
    const rs = await sealRoad({ conn, codec, admintool, id: RA, keyfile: Z.keyfile });
    check('…the next seal_road past the new target seals it (RoadSealed from a slot at or after it)', Number(rs?.pool.sealSlot) === 0 && Number(rs.pool.seedSlot) >= Number(rr.pool.sealSlot) && !/^A+=*$/.test(rs.pool.seedCommitment), JSON.stringify(rs?.pool && { seal: rs.pool.sealSlot, slot: rs.pool.seedSlot }));
    admintool(['cancel-pool', '--pool', String(RA), ...adm]); admintool(['close-pool', '--pool', String(RA), '-k', Z.keyfile]);
    check(`pool ${RA} cancelled and closed (nothing sold)`, (await poolAcc(RA)).status === 4 && (await bal(codec.vaultPda(RA).toBase58())) === 0);
  }
  admintool(['cancel-pool', '--pool', String(L), ...adm]); admintool(['close-pool', '--pool', String(L), '-k', Z.keyfile]);   // the late-sealed pool L: nothing sold
  // the authority handover, there and back
  const admin2 = await player('admin2');
  refuse('accept_authority with nothing proposed', ['accept-authority', '-k', admin2.keyfile], 'NoPendingAuthority');
  admintool(['propose-authority', '--new', admin2.wallet, ...adm]);
  refuse('accept_authority by someone not proposed', ['accept-authority', '-k', Z.keyfile], 'Unauthorized');
  admintool(['accept-authority', '-k', admin2.keyfile]);
  check('authority handed over to admin2', (await account('Config', codec.configPda())).authority === admin2.wallet);
  refuse('the old admin is no admin any more', ['set-config', '--paused', 'true', ...adm], 'Unauthorized');
  admintool(['propose-authority', '--new', ADMIN, '-k', admin2.keyfile]);
  admintool(['accept-authority', ...adm]);
  check('…and back to the admin (the server\'s TREASURY_PUBKEY)', (await account('Config', codec.configPda())).authority === ADMIN);

  const noise = p => !/favicon|status of 409|status of 404|road plan: server error 404/.test(p);
  const probs = browsers.flatMap(h => h.filt().filter(noise));
  check('no page errors (lobby + game)', probs.length === 0, probs.slice(0, 5).join(' | '));
  console.log(`screenshots: ${browsers[0]?.SHOTS}`);
} catch (e) {
  check('scenario threw', false, `${e?.stack ?? e}${e?.cause ? ` – cause: ${e.cause.code ?? ''} ${e.cause.message ?? e.cause}` : ''}`);
}
console.log(fails.length ? `\n✗ ${fails.length} failed: ${fails.join(' · ')}` : '\n✓ ten riders paid by the program, every lamport accounted for');
const code = fails.length ? 1 : 0;
for (const h of browsers) h.finish(code, 300);
if (!browsers.length) process.exit(code);
