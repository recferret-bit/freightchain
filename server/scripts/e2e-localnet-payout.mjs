// TEN riders, one escrowed pool, the whole money loop on a LOCAL chain – started by .claude/skills/localnet-e2e/run.sh after e2e-localnet.mjs (or alone:
// SCENARIO=payout). Real program transactions, real lamports, every balance asserted; explained in docs/localnet-e2e/index.html ("Ten riders").
//   1. pool D (1h, min 10, ≤ 2 per wallet) – 10 wallets buy 11 tickets: the lobby in headless Chrome and Node wallets (every wallet signs AND
//      sends, pays its own fee and Ticket rent; /confirm), one wallet 2 at once; open at 9, live at 10+; a sponsorship
//   2. the rides – the FINISHED RIDES are made through the same API the game uses (no admin back door: a server that let an admin write recordings would let
//      it mint winners): every bot signs in, spends its ticket, starts, heartbeats (answers the dispatch prompts), uploads hash-chained 10 Hz recordings that
//      take the damage of the server's planned holes, and ends. One ride is the real game in Chrome. Mixed on purpose: 6 honest, one wallet with 2 rides,
//      one FLAGGED (an unhashed batch) that the admin ACCEPTS with a signed review, one cheater (a teleport → REJECTED), one crash (never completes)
//   3. "cron": `verdict:rejudge --status all` re-judges every completed ride from its telemetry (nothing may change, the admin's decision stays), and a
//      `pool:crank` pass must leave the live pool alone
//   4. after the play deadline: the payout job (devnet-payout.mjs – signs as the program authority what GET /api/pools/:id/payout builds): each ranked
//      wallet gets exactly its share, the cheater and the crash get nothing, then close_pool: fee / platform / seed (= the next pool's jackpot) / creator legs
//   5. every Ticket rent back to whoever advanced it (close_ticket – nothing in the server does this yet: docs/escrow-open-items.md)
//   6. the jackpot rolls on: the seed treasury sponsors the next 1h pool with exactly what pool D left it; the lobby shows it
//   7. the rest of the program on the validator: pause, sold out, cancel_pool + refunds, an unpaid pool closed by the admin, the authority handover and
//      every error code the validator can reach – recorded into COVERAGE (scripts/localnet-coverage.mjs) for the 100 % report
// env: BASE, RPC, KEYS, CHROME_PORT, COVERAGE (file), PREP_D / PLAY_D (seconds from pool D's creation)
import { createHash } from 'node:crypto';
import nacl from 'tweetnacl'; import bs58 from 'bs58'; import { readFileSync, writeFileSync } from 'node:fs'; import { execFileSync } from 'node:child_process';
import { Connection, Keypair, PublicKey, SYSVAR_CLOCK_PUBKEY, Transaction } from '@solana/web3.js';
import { launch, sleep } from '../../client/tools/cdp.mjs';
import { PoolProgramCodec } from '../dist/infrastructure/solana/pool-program.codec.js';
import { POOL_PROGRAM_IDL } from '../dist/infrastructure/solana/pool-program.idl.js';
import { closeSplit, prizeBound } from '../dist/domain/economy/vault-split.js';
import { poolPayouts } from '../dist/domain/economy/pool-payouts.js';
import { honestRoad } from './road-damage.mjs';
import { coverage } from './localnet-coverage.mjs';

const { BASE, RPC, KEYS } = process.env;
if (!BASE || !RPC || !KEYS) { console.error('run it through .claude/skills/localnet-e2e/run.sh (needs BASE, RPC, KEYS)'); process.exit(2); }
const CDP = +(process.env.CHROME_PORT || 9391);
const PREP_D = +(process.env.PREP_D || 150), PLAY_D = +(process.env.PLAY_D || 270);
const PRICE = 100_000_000, SPONSOR = 50_000_000, SPLIT = [7000, 2000, 1000];   // 0.1 SOL a ticket, 0.05 SOL sponsored
const cov = coverage(process.env.COVERAGE || `${KEYS}/../coverage.json`);
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

// ── HTTP as a wallet
// a socket the server closed while idle (its keep-alive timeout, 5 s – the crank / CLI steps leave such gaps) fails the next request before it is sent: once more
const fetchy = (url, init) => fetch(url, init).catch(e => { if (!/fetch failed/.test(e?.message)) throw e; console.log(`     (retry ${url.replace(BASE, '')}: ${e.cause?.code ?? e.cause?.message ?? e.message})`); return fetch(url, init); });
const api = async (path, { body, cookie, method } = {}) => {
  const res = await fetchy(`${BASE}/api/${path}`, { method: method ?? (body ? 'POST' : 'GET'), headers: { 'content-type': 'application/json', ...(cookie && { cookie }) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, ok: res.ok, j: await res.json().catch(() => ({})) };
};
async function signIn(kp) {
  const wallet = kp.publicKey.toBase58(), { j } = await api('auth/nonce', { body: { wallet } });
  const res = await fetchy(`${BASE}/api/auth/verify`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ wallet, signature: bs58.encode(nacl.sign.detached(new TextEncoder().encode(j.message), kp.secretKey)) }) });
  if (!res.ok) throw new Error(`sign-in failed: ${res.status} ${await res.text()}`);
  return res.headers.get('set-cookie').split(';')[0];
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
  const o = await api('tickets', { body: { poolId, qty }, cookie: p.cookie });
  const pay = await api(`tickets/orders/${o.j.id}/payment`, { cookie: p.cookie });
  const sig = await sendSigned(signedB64(pay.j.transaction, p.kp));
  return { sig, paid: !!(await until(async () => (await api(`tickets/orders/${o.j.id}/confirm`, { body: { signature: sig }, cookie: p.cookie })).j.status === 'paid')) };
}

// ── a FINISHED RIDE made over the player API (the verified-play bots' recipe, scripts/e2e-verified-play.mjs apiDrive): the ticket is spent by POST /rides
//    `mutate(batch)` edits a batch before it is hashed, `hashOf` overrides the hash (null = an unhashed batch), `crashAt` ends it as failed at that second
async function apiRide(p, { seconds = 20, speed = 15, mutate = () => null, hashOf = (_b, text) => sha256(text), crashAt = 0 } = {}) {
  const made = await api('rides', { body: { tier: '1h' }, cookie: p.cookie });
  if (!made.ok) return { error: `${made.status} ${JSON.stringify(made.j).slice(0, 160)}` };
  const ride = made.j;
  await api(`rides/${ride.id}/start`, { body: {}, cookie: p.cookie });
  const d = { id: ride.id, t0: Date.now(), t: 0, s: 0, seq: 0, prevHash: ride.id, samples: [], inputs: [], bt0: 0, prompts: [], road: honestRoad(BASE, ride.id) };
  const row = (t, s, v) => [r(t, 2), r(s, 1), 2.4, 0, r(v, 2), Math.round(900 + v * 50), 6, 100, 0.6, 0, 0, 0, 12, 1 | 2 | 8];
  const cut = async () => {
    await d.road.take(d.samples);
    const base = { seq: d.seq++, prevHash: d.prevHash, t0: r(d.bt0, 2), t1: r(d.t, 2), samples: d.samples, inputs: d.inputs };
    const body = mutate(base) ?? base;
    const text = JSON.stringify({ seq: body.seq, prevHash: body.prevHash, t0: body.t0, t1: body.t1, samples: body.samples, inputs: body.inputs });
    const hash = hashOf(body, text);
    d.prevHash = hash ?? `unhashed-${body.seq}`; d.samples = []; d.inputs = []; d.bt0 = d.t;
    await api(`rides/${d.id}/batches`, { body: { ...body, hash }, cookie: p.cookie });
  };
  const heartbeat = async () => {   // a dispatch prompt in the response is answered like a person, ~0.5–1.2 s later
    const { j } = await api(`rides/${d.id}/heartbeat`, { body: { s: d.s, t: d.t, hull: 100, paused: false, route: 'route66', night: false }, cookie: p.cookie });
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
    if (ms >= nextKey) {   // gas in long jittered holds, a steering tap now and then
      if (!gasDown) { d.inputs.push([r(ms, 1), 'KeyW', 1]); gasDown = true; nextKey = ms + 1500 + Math.random() * 3000; }
      else { d.inputs.push([r(ms, 1), 'KeyW', 0]); gasDown = false; const tap = Math.random() < .5 ? 'KeyA' : 'KeyD'; const at = r(ms + 100 + Math.random() * 300, 1); d.inputs.push([at, tap, 1], [r(at + 120 + Math.random() * 400, 1), tap, 0]); nextKey = ms + 400 + Math.random() * 900; }
    }
    if (d.t - d.bt0 >= 15) await cut();
    if (now - lastBeat >= 5_000) { lastBeat = now; await heartbeat(); }
    if (crashAt ? d.t >= crashAt : d.t >= seconds) break;
  }
  await cut(); await heartbeat();
  const end = await api(`rides/${d.id}/end`, { body: crashAt ? { outcome: 'failed', s: d.s, t: d.t, hull: 0, reason: 'direct hit – a bus' } : { outcome: 'shift', s: d.s, t: d.t, hull: 100 }, cookie: p.cookie });
  return { id: d.id, end: end.j };
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
  h.lobby = async () => { await h.send('Page.navigate', { url: `${BASE}/lobby.html#new` }); return until(async () => (await h.ev('document.querySelectorAll(".tier").length')) >= 3, 20000); };
  return h;
}
async function gameRide(h, p) {
  const made = await api('rides', { body: { tier: '1h' }, cookie: p.cookie });
  if (!made.ok) return { error: `${made.status} ${JSON.stringify(made.j).slice(0, 160)}` };
  await h.send('Page.navigate', { url: `${BASE}/play.html?ride=${made.j.id}` });
  await until(() => h.ev('!!window.__game'), 30000, 200);
  await h.ev('document.getElementById("go").click()'); await sleep(800);
  await h.ev('(() => { let last = __game.st.t; setInterval(() => { const g = __game.st; if (g.mode === "drive") g.s += 20 * Math.max(0, g.t - last); last = g.t; }, 50); })()');
  const KEYS_ = [['KeyW', 'w'], ['KeyA', 'a'], ['KeyD', 'd'], ['KeyW', 'w'], ['ArrowUp', 'ArrowUp']];
  const t0 = Date.now();
  for (let i = 0; (i < 12 || !(await h.ev('__game.st.complete'))) && Date.now() - t0 < 60000; i++) {
    const [code, k] = KEYS_[i % KEYS_.length];
    await h.send('Input.dispatchKeyEvent', { type: 'keyDown', code, key: k }); await sleep(60 + Math.floor(Math.random() * 140));
    await h.send('Input.dispatchKeyEvent', { type: 'keyUp', code, key: k }); await sleep(150 + Math.floor(Math.random() * 350));
  }
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
  const mkArgs = (tier, price, min, max, per, prep, play, split = SPLIT.join('/'), t = treas) => ['create-pool', '--tier', tier, '--price', String(price), '--min', String(min), '--max', String(max), '--per-wallet', String(per), '--prep', `+${prep}`, '--play', `+${play}`, '--split', split, ...t, '-k', `${KEYS}/admin.json`];
  refuse('create_pool: shares that do not add up to 100 %', mkArgs('1h', PRICE, 10, 0, 2, 60, 120, '7000/2000/2000'), 'BpsSum');
  refuse('create_pool: a price below the rent minimum (a refund could not land)', mkArgs('1h', 1000, 10, 0, 2, 60, 120), 'PriceBelowRentMin');
  const empty = Keypair.generate().publicKey.toBase58();
  refuse('create_pool: a fee treasury that is not rent-exempt', mkArgs('1h', PRICE, 10, 0, 2, 60, 120, SPLIT.join('/'), ['--fee-treasury', empty, '--seed-treasury', addr('seed')]), 'TreasuryNotRentExempt');
  const D = admintool(mkArgs('1h', PRICE, 10, 0, 2, PREP_D, PLAY_D)).poolId;
  execFileSync('node', ['dist/cli/index.js', 'pool:register', String(D), '--label', 'TEN RIDERS'], { stdio: 'ignore' });
  const vD = codec.vaultPda(D).toBase58();
  check(`pool D (#${D}, 1h, min 10, ≤ 2 per wallet): open on chain and on the server, vault = rent minimum`, (await poolAcc(D)).status === 0 && (await serverPool(D)).status === 'open' && (await bal(vD)) === RENT0);

  // ── 2. ten wallets buy eleven tickets
  const R = []; for (let i = 1; i <= 10; i++) R.push(await player(`r${i}`));
  const [R1, R2, R3, R4, R5, R6, R7, R8, R9, R10] = R;
  const S = await player('sponsor-fan'), Z = await player('stranger');
  // R1 in the LOBBY (headless Chrome, the wallet signs AND sends)
  const h1 = await browser(R1, CDP);
  check('lobby: the 1h card offers pool D', await h1.lobby() && /BUY 1 TICKET/.test(await h1.txt('#tier-1h .buyb')), await h1.txt('#tier-1h .buyb'));
  let before = await bals({ r1: R1.wallet, vault: vD });
  await h1.ev('document.querySelector("#tier-1h .buyb").click()');
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
  check('chain: 9 tickets sold, pool D still OPEN (9 < min 10)', pd.ticketsSold === 9 && pd.status === 0, JSON.stringify({ sold: pd.ticketsSold, status: pd.status }));
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
  check('a fan sponsors 0.05 SOL: −(amount + fee), the vault holds it', before.s - after.s === SPONSOR + (await fee(sp.signature)) && after.vault - before.vault === SPONSOR);
  check('server mirror: active, 11 sold, the sponsorship counted', await until(async () => { const s = await serverPool(D); return s.status === 'active' && s.sold === 11 && s.sponsoredLamports === SPONSOR; }, 20000), JSON.stringify(await serverPool(D)).slice(0, 200));
  check('every wallet holds its tickets on the server', (await Promise.all(R.map(async p => (await myTickets(p, D))?.balance === (p === R8 ? 2 : 1)))).every(Boolean));
  check(`vault D = rent + 11 × price + sponsorship`, (await bal(vD)) === RENT0 + 11 * PRICE + SPONSOR);
  // a live pool is nobody's to fail, cancel, refund or settle early
  refuse('fail_pool on the live pool D', ['fail-pool', '--pool', String(D), '-k', Z.keyfile], 'NotFailable');
  refuse('cancel_pool on the live pool D (only an open pool)', ['cancel-pool', '--pool', String(D), '-k', `${KEYS}/admin.json`], 'PoolNotOpen');
  refuse('refund from the live pool D', ['refund', '--pool', String(D), '--buyer', R5.wallet, '-k', Z.keyfile], 'NotRefunding');
  refuse('close_ticket in the live pool D (only once settled)', ['close-ticket', '--pool', String(D), '--buyer', R5.wallet, '-k', Z.keyfile], 'NotSettled');
  refuse('pay_prize before the play deadline', ['pay-prize', '--pool', String(D), '--to', R2.wallet, '--lamports', '1000000', '-k', `${KEYS}/admin.json`], 'TooEarly');

  // ── 3. the rides: finished rides over the player API (+ one in the real game), all at once
  console.log('     … 11 rides: the real game in Chrome + 10 recordings over the API (≈ 30 s)');
  const plan = {
    [R2.wallet]: [{ speed: 13 }], [R3.wallet]: [{ speed: 15 }], [R4.wallet]: [{ speed: 17 }], [R5.wallet]: [{ speed: 19 }], [R6.wallet]: [{ speed: 21 }],
    [R7.wallet]: [{ speed: 20, crashAt: 4 }],                       // crashes: the ride fails, never completes
    [R8.wallet]: [{ speed: 11 }, { speed: 12 }],                    // two tickets, two rides – the ranking sums them
    [R9.wallet]: [{ speed: 25, hashOf: unhashed }],                 // one batch the client "could not hash" → FLAGGED, the admin reviews it
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

  // ── 4. "cron": re-judge every completed ride from its telemetry, then a crank pass
  const rj = cli('verdict:rejudge', '--status', 'all');
  const after9 = (await api(`rides/${rides[R9.wallet][0].id}`, { cookie: R9.cookie })).j.verdict, after10 = (await api(`rides/${rides[R10.wallet][0].id}`, { cookie: R10.cookie })).j.verdict;
  check('cron verdict:rejudge --status all: re-judged the completed rides; R9 keeps the admin\'s decision, R10 stays rejected', after9?.status === 'verified' && after9?.override && after10?.status === 'rejected', JSON.stringify(rj).slice(0, 300));
  const crank = cli('pool:crank');
  check('cron pool:crank: nothing to do for the live pool D', !crank.actions.some(a => a.poolId === D), JSON.stringify(crank.actions));
  check('GET payout before the play deadline: 409 too_early (admin), 403 (a rider)', (await api(`pools/${D}/payout`, { cookie: await signIn(admin) })).status === 409 && (await api(`pools/${D}/payout`, { cookie: R1.cookie })).status === 403);

  // ── 5. the play deadline passes: nothing more goes in, the admin's limits hold, the payout job pays
  await untilChain(Number((await poolAcc(D)).playDeadline.getTime() / 1000), 'pool D play deadline');
  refuse('buy into pool D after its play deadline', ['buy', '-k', Z.keyfile, '--pool', String(D)], 'TooLate');
  pd = await poolAcc(D);
  const bound = prizeBound({ priceLamports: PRICE, ticketsSold: 11, sponsored: SPONSOR, prizeBps: SPLIT[0], seedBps: SPLIT[1] });
  check('the pot counts EVERY ticket – the crash\'s and the cheater\'s money stays in it', pd.ticketsSold === 11 && pd.sponsored === SPONSOR && bound === Math.floor((11 * PRICE + SPONSOR) * SPLIT[0] / 10_000));
  refuse('pay_prize by a stranger', ['pay-prize', '--pool', String(D), '--to', Z.wallet, '--lamports', '1000000', '-k', Z.keyfile], 'Unauthorized');
  refuse('pay_prize above the prize share', ['pay-prize', '--pool', String(D), '--to', R2.wallet, '--lamports', String(bound + 1), '-k', `${KEYS}/admin.json`], 'PrizeExceedsShare');
  refuse('pay_prize into the vault itself', ['pay-prize', '--pool', String(D), '--to', vD, '--lamports', '1000000', '-k', `${KEYS}/admin.json`], 'AccountMismatch');
  refuse('pay_prize that leaves an empty wallet below the rent minimum', ['pay-prize', '--pool', String(D), '--to', Keypair.generate().publicKey.toBase58(), '--lamports', '1000', '-k', `${KEYS}/admin.json`], 'BelowRentMin');
  // the expected ranking, from what each wallet drove in its counted rides (completed + verified, R9 by the admin's decision)
  const counted = [R1, R2, R3, R4, R5, R6, R8, R9];
  const dist = p => rides[p.wallet].reduce((a, x) => a + (x.end?.distance ?? 0), 0);
  const want = counted.slice().sort((a, b) => dist(b) - dist(a));
  const payouts = poolPayouts(bound, want.map(p => p.wallet));
  const po = await api(`pools/${D}/payout`, { cookie: await signIn(admin) });
  check('GET payout: 8 ranked wallets by distance (crash + cheater out), amounts = the payout table, cap = the prize share', po.ok && po.j.prizeLamports === bound && po.j.ranks.map(x => x.wallet).join() === want.map(p => p.wallet).join()
    && po.j.ranks.map(x => x.lamports).join() === payouts.map(x => x.lamports).join(), JSON.stringify((po.j.ranks ?? po.j)).slice(0, 400));
  console.log(`     ranking: ${want.map((p, i) => `#${i + 1} ${p.name} ${Math.round(dist(p))} m → ${payouts[i].lamports}`).join(' · ')}`);
  const everyone = { ...Object.fromEntries(R.map(p => [p.name, p.wallet])), fee: addr('fee'), plat: addr('plat'), seed: addr('seed'), admin: ADMIN, vault: vD };
  before = await bals(everyone);
  const vaultBefore = before.vault;
  const job = execFileSync('node', ['scripts/devnet-payout.mjs', String(D), '--yes'], { encoding: 'utf8', env: { ...process.env, BASE, RPC, ADMIN: `${KEYS}/admin.json` } });
  after = await bals(everyone);
  const d = delta(before, after);
  const sigs = [...job.matchAll(/: ([1-9A-HJ-NP-Za-km-z]{80,90})$/gm)].map(m => m[1]);
  check('payout job: 8 pay_prize + close_pool sent', sigs.length === 9, job.trim().split('\n').slice(-3).join(' | '));
  for (const [i, p] of want.entries()) check(`rank ${i + 1} ${p.name} received exactly ${payouts[i].lamports} lamports`, d[p.name] === payouts[i].lamports, `${d[p.name]}`);
  check('R7 (crash) and R10 (cheater) received nothing', d.r7 === 0 && d.r10 === 0, `${d.r7} / ${d.r10}`);
  const paid = payouts.reduce((a, x) => a + x.lamports, 0);
  pd = await poolAcc(D);
  const legs = closeSplit({ priceLamports: PRICE, ticketsSold: 11, sponsored: SPONSOR, prizeBps: SPLIT[0], seedBps: SPLIT[1], platformFeeBps: PLAT_BPS, prizesPaid: paid, vaultLamports: vaultBefore - paid, cancelled: false, rentMin: RENT0 });
  const adminFees = (await Promise.all(sigs.map(fee))).reduce((a, b) => a + b, 0);
  check('prizes on chain = the table, ≤ the prize share; the rounding stays unclaimed', pd.prizesPaid === paid && paid <= bound && legs.unclaimed === bound - paid, `${pd.prizesPaid} / ${paid} / ${bound}`);
  check('fee treasury: exactly its leg', d.fee === legs.fee && legs.fee > 0, `${d.fee} vs ${legs.fee}`);
  check(`platform treasury: exactly ${PLAT_BPS} bps of the fee share`, d.plat === legs.platformFee && (PLAT_BPS === 0 || legs.platformFee > 0), `${d.plat} vs ${legs.platformFee}`);
  check('seed treasury (the next pool\'s jackpot): seed share + unclaimed prize', d.seed === legs.seed && legs.seed > 0, `${d.seed} vs ${legs.seed}`);
  check('creator (admin): + the vault rent minimum − the fees of the 9 transactions it signed', d.admin === RENT0 - adminFees, `${d.admin} vs ${RENT0 - adminFees}`);
  check('vault D = 0, settled on chain and on the server', after.vault === 0 && pd.status === 3 && await until(async () => (await serverPool(D)).status === 'settled'));
  check('conservation: 11 tickets + sponsorship = prizes + fee + platform + seed', 11 * PRICE + SPONSOR === paid + legs.fee + legs.platformFee + legs.seed, `${11 * PRICE + SPONSOR} vs ${paid + legs.fee + legs.platformFee + legs.seed}`);
  refuse('pay_prize on the settled pool D', ['pay-prize', '--pool', String(D), '--to', R2.wallet, '--lamports', '1000000', '-k', `${KEYS}/admin.json`], 'PoolNotActive');

  // ── 6. the Ticket rents: close_ticket (permissionless) gives each back to whoever paid it – the buyer
  const payers = { ...Object.fromEntries(R.map(p => [p.name, p.wallet])), z: Z.wallet };
  before = await bals(payers);
  const ctSigs = []; for (const p of R) ctSigs.push(admintool(['close-ticket', '--pool', String(D), '--buyer', p.wallet, '-k', Z.keyfile]).signature);
  after = await bals(payers);
  const dt = delta(before, after);
  check('close_ticket ×10 by a stranger: every buyer got its own Ticket rent back', R.every(p => dt[p.name] === ticketRent), JSON.stringify(dt));
  check('…the stranger paid only the fees; every Ticket account is gone', -dt.z === (await Promise.all(ctSigs.map(fee))).reduce((a, b) => a + b, 0) && (await Promise.all(R.map(p => conn.getAccountInfo(codec.ticketPda(D, p.wallet))))).every(x => x === null));

  // ── 7. the jackpot rolls on: the seed treasury sponsors the next 1h pool with what pool D left it (an operator step – no code moves it by itself)
  const E = admintool(mkArgs('1h', PRICE, 2, 0, 2, 900, 1200)).poolId;
  execFileSync('node', ['dist/cli/index.js', 'pool:register', String(E), '--label', 'NEXT WEEK'], { stdio: 'ignore' });
  const seedFromD = d.seed;
  before = await bals({ seed: addr('seed'), vault: codec.vaultPda(E).toBase58() });
  const se = admintool(['sponsor', '--pool', String(E), '--lamports', String(seedFromD), '-k', `${KEYS}/seed.json`]);
  after = await bals({ seed: addr('seed'), vault: codec.vaultPda(E).toBase58() });
  check('the seed treasury sponsors pool E with exactly pool D\'s seed leg', after.vault - before.vault === seedFromD && before.seed - after.seed === seedFromD + (await fee(se.signature)) && se.pool.sponsored === seedFromD);
  const eBound = prizeBound({ priceLamports: PRICE, ticketsSold: 0, sponsored: seedFromD, prizeBps: SPLIT[0], seedBps: SPLIT[1] });
  check(`pool E's prize cap before a single ticket: ${eBound} lamports (70 % of the rolled-over seed)`, eBound === Math.floor(seedFromD * SPLIT[0] / 10_000) && eBound > 0);
  check('server mirror: pool E open with the sponsorship', await until(async () => { const s = await serverPool(E); return s.status === 'open' && s.sponsoredLamports === seedFromD; }, 20000), JSON.stringify(await serverPool(E)).slice(0, 200));
  await h1.lobby();
  const seedTxt = `sponsored ${(seedFromD / 1e9).toFixed(seedFromD >= 1e9 ? 2 : 3)} SOL`;
  check(`lobby: the 1h card shows the next pool with "${seedTxt}"`, !!(await until(async () => (await h1.txt('#tier-1h')).includes(seedTxt), 15000)), (await h1.txt('#tier-1h')).slice(0, 240));
  await h1.shot('payout-2-next-jackpot');

  // ── 8. the rest of the program on the validator (coverage): pause, sold out, cancel + refunds, an unpaid pool closed by the admin, the handover
  const adm = ['-k', `${KEYS}/admin.json`];
  admintool(['set-config', '--paused', 'true', ...adm]);
  check('set_config: paused', (await account('Config', codec.configPda())).paused === true);
  refuse('buy while paused', ['buy', '-k', Z.keyfile, '--pool', String(E)], 'Paused');
  refuse('create_pool while paused', mkArgs('4h', PRICE, 1, 1, 1, 30, 40), 'Paused');
  admintool(['set-config', '--paused', 'false', ...adm]);
  check('set_config: running again', (await account('Config', codec.configPda())).paused === false);
  // F: one ticket max – sold out at the second; never paid a prize: the admin closes it after the deadline (the prize share goes to the seed)
  const F = admintool(mkArgs('4h', PRICE, 1, 1, 1, 25, 35)).poolId;
  admintool(['buy', '-k', Z.keyfile, '--pool', String(F)]);
  refuse('buy into a sold-out pool', ['buy', '-k', R2.keyfile, '--pool', String(F)], 'SoldOut');
  // G: open, one buyer – the admin cancels it, the refunds follow
  const G = admintool(mkArgs('8h', PRICE, 5, 0, 2, 900, 1200)).poolId;
  admintool(['buy', '-k', R3.keyfile, '--pool', String(G)]);
  refuse('cancel_pool by a stranger', ['cancel-pool', '--pool', String(G), '-k', Z.keyfile], 'Unauthorized');
  admintool(['cancel-pool', '--pool', String(G), ...adm]);
  check('cancel_pool: G refunding', (await poolAcc(G)).status === 2);
  refuse('buy into a cancelled pool', ['buy', '-k', R4.keyfile, '--pool', String(G)], 'PoolNotOpen');
  refuse('pay_prize from a refunding pool', ['pay-prize', '--pool', String(G), '--to', R3.wallet, '--lamports', '1000000', ...adm], 'PoolNotActive');
  refuse('close_pool before every ticket is refunded', ['close-pool', '--pool', String(G), '-k', Z.keyfile], 'RefundsPending');
  before = await bals({ r3: R3.wallet });
  admintool(['refund', '--pool', String(G), '--buyer', R3.wallet, '-k', Z.keyfile]);
  check('refund by a stranger: R3 + price + its own Ticket rent', (await bal(R3.wallet)) - before.r3 === PRICE + ticketRent);
  refuse('the same refund again', ['refund', '--pool', String(G), '--buyer', R3.wallet, '--rent-payer', R3.wallet, '-k', Z.keyfile], 'AlreadyRefunded');
  admintool(['close-pool', '--pool', String(G), '-k', Z.keyfile]);
  check('G closed by a stranger: cancelled, vault 0', (await poolAcc(G)).status === 4 && (await bal(codec.vaultPda(G))) === 0);
  await untilChain(Number((await poolAcc(F)).playDeadline.getTime() / 1000), 'pool F play deadline');
  const fv = await bal(codec.vaultPda(F)), fLegs = closeSplit({ priceLamports: PRICE, ticketsSold: 1, sponsored: 0, prizeBps: SPLIT[0], seedBps: SPLIT[1], platformFeeBps: PLAT_BPS, prizesPaid: 0, vaultLamports: fv, cancelled: false, rentMin: RENT0 });
  before = await bals({ seed: addr('seed'), fee: addr('fee') });
  admintool(['close-pool', '--pool', String(F), ...adm]);
  after = await bals({ seed: addr('seed'), fee: addr('fee') });
  check('the admin closes F without paying a prize: the whole prize share goes to the seed as unclaimed', (await poolAcc(F)).status === 3 && after.seed - before.seed === fLegs.seed && fLegs.unclaimed === Math.floor(PRICE * SPLIT[0] / 10_000) && after.fee - before.fee === fLegs.fee);
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

  const noise = p => !/favicon|status of 409|status of 404/.test(p);
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
