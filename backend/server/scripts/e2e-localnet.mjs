// The money flows end to end on a LOCAL chain – real program transactions, real lamports, every balance asserted. Started by .claude/skills/localnet-e2e/run.sh
// (phase 1: fixtures made by the real program; phase 2: validator + program + the baked accounts + the server in program mode on a throwaway DB).
// env: BASE, RPC, KEYS (scratch keypair dir), FIXTURES (phase 1's fixtures.json), CHROME_PORT. Explained in docs/tech/localnet-e2e/index.html.
//   pool A (1h, min 3): lobby buy ×2 (the wallet signs AND sends, it pays its own fee + Ticket rent) → Node buy → live → a sponsorship → 3 verified rides → play deadline → ranked payouts → close (+ sponsorship)
//   pool B (4h, min 5): two chain buys (HTTP orders are 400 tier_retired) → missed goal, nobody failed it → lobby CLAIM REFUND on the refunds strip (no 4h card) → API refund → anyone closes →
//                       GET /api/tiers omits 4h and 8h; POST /api/rides 400 tier_retired
//   pool C (8h, min 5) + the baked "three weeks old" pools: the crank (pool:crank) fails C and expires the unpaid baked pool, refunds both, closes both;
//                       the baked pool that paid a prize is closed by a stranger after the grace (MustExpire refused for the unpaid one)
// Deadlines run on the validator's clock (no warp): the run is paced by them (PREP_A / PLAY_A / PREP_B / PREP_C seconds, defaults below).
import nacl from 'tweetnacl'; import bs58 from 'bs58'; import { readFileSync, writeFileSync } from 'node:fs'; import { execFileSync } from 'node:child_process';
import { Connection, Keypair, PublicKey, SYSVAR_CLOCK_PUBKEY, SystemProgram, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import { launch, sleep, driveHook } from '../../../frontend/client/tools/cdp.mjs';
import { PoolProgramCodec } from '../dist/infrastructure/solana/pool-program.codec.js';
import { POOL_PROGRAM_IDL } from '../dist/infrastructure/solana/pool-program.idl.js';
import { closeSplit, prizeBound } from '../dist/domain/economy/vault-split.js';
import { poolPayouts } from '../dist/domain/economy/pool-payouts.js';
import { rankedWallets } from './localnet-rank.mjs';
import { coverage } from './localnet-coverage.mjs';
import { sealRoad } from './localnet-seal.mjs';

const { BASE, RPC, KEYS } = process.env;
if (!BASE || !RPC || !KEYS) { console.error('run it through .claude/skills/localnet-e2e/run.sh (needs BASE, RPC, KEYS)'); process.exit(2); }
const CDP = +(process.env.CHROME_PORT || 9371);
const PREP_A = +(process.env.PREP_A || 170), PLAY_A = +(process.env.PLAY_A || 240), PREP_B = +(process.env.PREP_B || 60), PREP_C = +(process.env.PREP_C || 65);   // PREP_A: pool A's rides (step 6) must start inside its sale – no new rides after it
// amounts: localnet defaults; TARGET=devnet passes small ones (devnet SOL is scarce) – a price must stay ≥ the 890 880-lamport rent minimum
const PRICE_A = +(process.env.PRICE_A || 100_000_000), PRICE_B = +(process.env.PRICE_B || 50_000_000);   // 0.1 / 0.05 SOL
const SPONSOR_A = +(process.env.SPONSOR_A || Math.ceil(3 * PRICE_A * 5260 / 4740)), SPONSOR_C = +(process.env.SPONSOR_C || 20_000_000);
const solTxt = l => `${(l / 1e9).toFixed(l >= 1e9 ? 2 : 3)} SOL`;   // the lobby's format
const ON_DEVNET = !!process.env.FUND_FROM;   // devnet: other pools may exist, players are funded by transfer and swept back
BigInt.prototype.toJSON ??= function () { return String(this); };   // the codec decodes Pool.paid_mask (u64 bit mask) as a BigInt
const T0 = Date.now(), fails = [];
const check = (n, ok, x = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} [${((Date.now() - T0) / 1000).toFixed(0)} s] ${n}${x ? ' – ' + x : ''}`); if (!ok) fails.push(n); return ok; };
const until = async (fn, ms = 30000, step = 500) => { for (let i = 0; i <= ms / step; i++) { const v = await fn(); if (v) return v; await sleep(step); } return false; };
const conn = new Connection(RPC, 'confirmed');
const codec = new PoolProgramCodec(POOL_PROGRAM_IDL.address);
const key = name => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(`${KEYS}/${name}.json`, 'utf8'))));
const admin = key('admin');
const addr = name => key(name).publicKey.toBase58();
const bal = a => conn.getBalance(new PublicKey(a), 'confirmed');
const bals = async list => Object.fromEntries(await Promise.all(Object.entries(list).map(async ([k, a]) => [k, await bal(a)])));
const fee = async sig => (await conn.getTransaction(sig, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 })).meta.fee;
const chainNow = async () => Number((await conn.getAccountInfo(SYSVAR_CLOCK_PUBKEY, 'confirmed')).data.readBigInt64LE(32));
const untilChain = async (ts, what) => { const left = ts - (await chainNow()); if (left > 0) console.log(`     … waiting ${left} s for ${what} (chain clock)`); while ((await chainNow()) < ts + 2) await sleep(process.env.FUND_FROM ? 3000 : 1000); };   // devnet: gentler on the provider's rate limit
const account = async (name, a) => { const i = await conn.getAccountInfo(a, 'confirmed'); return i ? codec.decodeAccount(name, i.data) : null; };
const poolAcc = id => account('Pool', codec.poolPda(id));
const ticketRent = await conn.getMinimumBalanceForRentExemption(8 + 79);
const RENT0 = await conn.getMinimumBalanceForRentExemption(0);   // the vault's rent minimum – the cluster's own (devnet's is lower than mainnet's)
const admintool = args => JSON.parse(execFileSync('node', ['scripts/pool-admin.mjs', ...args, '--url', RPC], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim().split('\n').pop());

// ── HTTP as a wallet (the session cookie of a nacl sign-in, like the other e2e scripts)
const fetchy = async (url, init) => {
  let last;
  for (let i = 0; i < 4; i++) {
    try { return await fetch(url, init); }
    catch (e) { last = e; if (!/fetch failed/.test(e?.message) || i === 3) throw e; await sleep(400 * (i + 1)); }
  }
  throw last;
};
const api = async (path, { body, cookie, method } = {}) => {
  const r = await fetchy(`${BASE}/api/${path}`, { method: method ?? (body ? 'POST' : 'GET'), headers: { 'content-type': 'application/json', ...(cookie && { cookie }) }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, ok: r.ok, j };
};
const players = [];
const funder = process.env.FUND_FROM ? Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(process.env.FUND_FROM, 'utf8')))) : null;
async function player(lamports = +(process.env.FUND_LAMPORTS || 5e9)) {
  const kp = Keypair.generate(), wallet = kp.publicKey.toBase58();
  if (funder) { const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed'); const t = new Transaction({ feePayer: funder.publicKey, blockhash, lastValidBlockHeight }).add(SystemProgram.transfer({ fromPubkey: funder.publicKey, toPubkey: kp.publicKey, lamports })); t.sign(funder); await sendSigned(t); }
  else await conn.confirmTransaction(await conn.requestAirdrop(kp.publicKey, lamports), 'confirmed');
  players.push(kp);
  const { j } = await api('auth/nonce', { body: { wallet } });
  const r = await fetch(`${BASE}/api/auth/verify`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ wallet, signature: bs58.encode(nacl.sign.detached(new TextEncoder().encode(j.message), kp.secretKey)) }) });
  if (!r.ok) throw new Error(`sign-in failed: ${r.status} ${await r.text()}`);
  const cookie = r.headers.get('set-cookie').split(';')[0];
  const offer = await api('profile/agreements', { body: { age18: true, loss: true }, cookie, method: 'PUT' });
  if (!offer.ok) throw new Error(`agreements failed: ${offer.status}`);
  const keyfile = `${KEYS}/player-${wallet.slice(0, 8)}.json`; writeFileSync(keyfile, JSON.stringify([...kp.secretKey]));   // for pool-admin (pool sponsorship, buys)
  return { kp, wallet, keyfile, cookie };
}
const signedB64 = (b64, kp) => { const tx = Transaction.from(Buffer.from(b64, 'base64')); tx.partialSign(kp); return tx; };
// send + re-send every 2 s until confirmed (a real cluster drops some transactions; the blockhash bounds it)
const sendSigned = async tx => {
  const raw = tx.serialize(), sig = await conn.sendRawTransaction(raw, { skipPreflight: false });
  for (let i = 0; i < 60; i++) {
    const st = (await conn.getSignatureStatuses([sig])).value[0];
    if (st?.err) throw new Error(`transaction ${sig} failed: ${JSON.stringify(st.err)}`);
    if (st?.confirmationStatus === 'confirmed' || st?.confirmationStatus === 'finalized') return sig;
    await sleep(2000); await conn.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 }).catch(() => undefined);
  }
  throw new Error(`transaction ${sig} not confirmed in 2 minutes`);
};
const settle = async (sig, cookie) => until(async () => (await api('chain/settle', { body: { signature: sig }, cookie })).j.status === 'done', 30000, 1000);
const serverPool = async id => (await api(`pools/${id}`)).j;
const myTickets = async (p, poolId) => ((await api('me', { cookie: p.cookie })).j.tickets ?? []).find(t => t.poolId === poolId);

// ── a fake Phantom for the lobby: signs with the player's real (throwaway) key, sends to the local validator (its RPC allows any origin)
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
// a ticket ride in the real game (the e2e-browser.mjs recipe): START, distance under the governor on the game clock, human-ish key presses, END SHIFT → server verdict
async function ride(h, p, tier) {
  const r = await api('rides', { body: { tier }, cookie: p.cookie });
  if (!check(`${tier} ride created with a ticket (${p.wallet.slice(0, 6)}…)`, r.ok && r.j.status === 'created', `${r.status} ${JSON.stringify(r.j).slice(0, 200)}`)) return null;
  await h.send('Page.navigate', { url: `${BASE}/play.html?ride=${r.j.id}` });
  await until(() => h.ev('!!window.__game'), 30000, 200);
  await h.ev('document.getElementById("go").click()'); await sleep(800);
  // Speed stays pinned at 20. A pedal-up recording of that is coasting. The verdict also rejects a moved ride whose batches have no gas key (`no-throttle-input`), and setting input.gas does not write that key. Hold KeyW through CDP for the whole roll.
  await h.ev(driveHook(20, '__game.st.park=false;__game.st.keyOn=true;__game.st.engineOn=true;__game.st.ign=null;__game.st.gear=7;__game.st.clutch=0;__game.st.brake=0;__game.input.gas=1;__game.input.brake=0;__game.input.clutch=0;__game.st.coldT=0;__game.st.strain=0;__game.st.noStall=2;'));
  await h.send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'KeyW', key: 'w' });
  const t0 = Date.now();
  while (Date.now() - t0 < 90000) {
    let done = false;
    try { done = await h.ev('__game.st.complete || __game.st.mode === "done" || __game.st.mode === "dead"'); }
    catch (e) { if (!/timed out/.test(String(e?.message))) throw e; }
    if (done) break;
    await sleep(250);
  }
  await h.send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'KeyW', key: 'w' });
  await h.ev('document.dispatchEvent(new KeyboardEvent("keydown", { key: "p", code: "KeyP", bubbles: true })); window.dispatchEvent(new KeyboardEvent("keydown", { key: "p", code: "KeyP", bubbles: true }))'); await sleep(500);
  await h.ev('document.getElementById("endshift")?.click()');
  const done = await until(async () => { const s = (await api(`rides/${r.j.id}`, { cookie: p.cookie })).j; return s.verdict ? s : null; }, 60000, 1000);
  check(`…ride completed and VERIFIED (${p.wallet.slice(0, 6)}…)`, done?.status === 'completed' && done?.verdict?.status === 'verified', JSON.stringify({ status: done?.status, verdict: done?.verdict?.status, reasons: done?.verdict?.reasons }));
  return r.j.id;
}

// The lobby opens the burn dialog before it creates an order. The checkbox has to be on or BUY stays disabled.
async function acceptBurn(h) {
  const up = await until(async () => !!(await h.ev('document.getElementById("burn-warning")')), 10000);
  if (!up) return false;
  return h.ev('(() => { const box = document.getElementById("burn-warning"); box.checked = true; box.dispatchEvent(new Event("change", { bubbles: true })); document.getElementById("burn-warning-accept").click(); return true; })()');
}
// buy helper (Node wallets): the wallet signs AND sends its own transaction (it pays the network fee and the Ticket rent), then /confirm
async function buySelf(p, poolId, qty = 1) {
  const o = await api('tickets', { body: { poolId, qty, burnWarningAccepted: true }, cookie: p.cookie });
  const pay = await api(`tickets/orders/${o.j.id}/payment`, { cookie: p.cookie });
  const sig = await sendSigned(signedB64(pay.j.transaction, p.kp));
  const paid = !!(await until(async () => (await api(`tickets/orders/${o.j.id}/confirm`, { body: { signature: sig }, cookie: p.cookie })).j.status === 'paid'));
  return { order: o, pay, sig, paid };
}
// 4h and 8h are not sold over HTTP (400 tier_retired). The chain buy is credited by the program-log watcher, same as the webhook path below.
async function buyOnChain(p, poolId) {
  const direct = admintool(['buy', '-k', p.keyfile, '--pool', String(poolId)]);
  const credited = await until(async () => ((await myTickets(p, poolId))?.bought ?? 0) >= 1, 20000);
  return { sig: direct.signature, paid: !!credited };
}
const crankPass = () => JSON.parse(execFileSync('node', ['dist/cli/index.js', 'pool:crank'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
const cov = process.env.COVERAGE ? coverage(process.env.COVERAGE) : null;   // refusals never land: recorded for scripts/localnet-coverage.mjs
const refuses = (args, re, step = args.join(' ')) => {
  try { admintool(args); return false; }
  catch (e) {
    cov?.refused(step, e);
    const text = String(e.stderr ?? e);
    if (!re.test(text)) console.log(`     refused, but not ${re}: ${text.slice(0, 500)}`);
    return re.test(text);
  }
};

try {
  // ── 0. the stack, the baked "three weeks old" pools (phase 1 of run.sh made them with the real program, then moved their deadlines back)
  const FX = process.env.FIXTURES ? JSON.parse(readFileSync(process.env.FIXTURES, 'utf8')) : null;   // devnet: no baked pools
  const tiers = (await api('tiers')).j;
  check('server sells tickets through the program (paymentMode = program)', tiers.paymentMode === 'program', String(tiers.paymentMode));
  const cfg = await account('Config', codec.configPda());
  const PLAT_BPS = cfg?.platformFeeBps ?? 0;
  check(`Config: admin = TREASURY_PUBKEY (named by the upgrade authority), platform cut ${PLAT_BPS} bps`, cfg?.authority === addr('admin') && (!FX || (cfg.platformFeeBps === 500 && cfg.poolCount === FX.poolCount)), JSON.stringify(cfg));
  if (FX) {
    for (const [id, label] of [[FX.expirePool, 'BAKED EXPIRE'], [FX.gracePool, 'BAKED GRACE']]) execFileSync('node', ['dist/cli/index.js', 'pool:register', String(id), '--label', label], { stdio: 'ignore' });
    const [px, py] = [await poolAcc(FX.expirePool), await poolAcc(FX.gracePool)];
    check('baked pools: active on chain, play deadline 16 days ago, one with a prize paid', px?.status === 1 && py?.status === 1 && px.prizesPaid === 0 && py.prizesPaid === FX.prizePaid && px.playDeadline.getTime() === FX.back * 1000);
  }

  // ── 1. pools created now by the admin: A (1h, goes live), B (4h, misses its goal), C (8h, misses its goal – left to the crank)
  const treas = ['--fee-treasury', addr('fee'), '--seed-treasury', addr('seed'), '-k', `${KEYS}/admin.json`];
  const mk = (tier, price, min, prep, play, split, perWallet = 3) => admintool(['create-pool', '--tier', tier, '--price', String(price), '--min', '0', '--max', '0', '--per-wallet', String(perWallet), '--prep', `+${prep}`, '--play', `+${play}`, '--last-start', `+${play - 1}`, '--split', split, ...treas]).poolId;
  const A = mk('1h', PRICE_A, 3, PREP_A, PLAY_A, '7000/2000/1000');
  const B = mk('4h', PRICE_B, 5, PREP_B, PREP_B + 60, '6000/2500/1500', 2);
  const C = mk('8h', PRICE_B, 5, PREP_C, PREP_C + 60, '7000/2000/1000', 2);
  check('new pools get consecutive ids from Config.pool_count (after the baked ones on localnet)', (!FX || A === FX.poolCount) && C === A + 2, `${A} ${B} ${C}`);
  // v4 (L4): no ride is served before the road is sealed from a slot after the pool opened (the server's crank does it; here the scenario runs it by hand)
  const seals = []; for (const id of [A, B, C]) seals.push(await sealRoad({ conn, codec, admintool, id, keyfile: `${KEYS}/admin.json` }));
  check('seal_road A / B / C: each road sealed from a later slot (seal_slot 0, a seed commitment)', seals.every(x => x && Number(x.pool.sealSlot) === 0 && !/^A+=*$/.test(x.pool.seedCommitment) && Number(x.pool.seedSlot) > 0), JSON.stringify(seals.map(x => x?.pool && { seal: x.pool.sealSlot, slot: x.pool.seedSlot })));
  for (const [id, label] of [[A, 'LOCAL 1H'], [B, 'LOCAL 4H'], [C, 'LOCAL 8H']]) execFileSync('node', ['dist/cli/index.js', 'pool:register', String(id), '--label', label], { stdio: 'ignore' });
  check('…open on chain and on the server, vaults hold exactly the rent minimum', (await Promise.all([A, B, C].map(async id => (await poolAcc(id))?.status === 1 && (await serverPool(id)).status === 'active' && (await bal(codec.vaultPda(id))) === RENT0)))
    .every(Boolean));
  const vA = codec.vaultPda(A).toBase58(), vB = codec.vaultPda(B).toBase58(), vC = codec.vaultPda(C).toBase58();
  const [P1, P2, P3, P4, P5, P6, S, Z] = [await player(), await player(), await player(), await player(), await player(), await player(), await player(), await player()];   // Z = "anyone": closes pools it never paid into

  // ── 2. P1 buys 2 tickets of pool A in the LOBBY: the wallet signs AND sends (it pays its own network fee and the Ticket rent)
  const h1 = await browser(P1, CDP);
  check('lobby: the pooled tier cards render', await h1.lobby());
  let before = await bals({ p1: P1.wallet, vault: vA });
  // The + click re-renders the card. Reading the label in the same turn still sees "BUY 1 TICKET", and a second read while that render is in flight wedged Chrome.
  const twoTickets = `BUY 2 TICKETS · ${solTxt(2 * PRICE_A)}`;
  let buyLabel = '';
  const qtyReady = await until(async () => {
    buyLabel = await h1.txt('#tier-1h .buyb');
    if (buyLabel === twoTickets) return true;
    if (buyLabel.startsWith('BUY 1 TICKET')) await h1.ev('document.querySelector("#tier-1h .qty button:last-child")?.click()');
    return false;
  }, 20000);
  check(`lobby: ${twoTickets}`, qtyReady === true, buyLabel);
  await h1.ev('document.querySelector("#tier-1h .buyb").click()');
  await acceptBurn(h1);
  check('lobby: paid + 2 tickets credited', await until(async () => /Paid – 2 tickets credited/.test(await h1.txt('#msg-1h')), 60000), await h1.txt('#msg-1h'));
  check('…the wallet was asked to sign AND send (no fee sponsor: it pays its own fee)', (await h1.ev('JSON.stringify(__asked)')) === '["signAndSendTransaction"]', await h1.ev('JSON.stringify(__asked)'));
  await h1.shot('1-lobby-bought');
  let after = await bals({ p1: P1.wallet, vault: vA });
  const sigB1 = (await conn.getSignaturesForAddress(P1.kp.publicKey, { limit: 1 }, 'confirmed'))[0]?.signature;
  const t1 = await account('Ticket', codec.ticketPda(A, P1.wallet));
  check('P1 paid exactly 2 × price + its network fee + the Ticket rent, not a lamport more', !!sigB1 && before.p1 - after.p1 === 2 * PRICE_A + (await fee(sigB1)) + ticketRent, `${before.p1 - after.p1}`);
  check('vault A += 2 × price', after.vault - before.vault === 2 * PRICE_A, `${after.vault - before.vault}`);
  check('Ticket account: qty 2, rent_payer = the buyer', t1?.qty === 2 && t1?.rentPayer === P1.wallet, JSON.stringify(t1));
  check('chain: pool A remains active with two tickets', (await poolAcc(A)).status === 1);

  // ── 3. P2 buys 1 from Node – the purchase that takes pool A live
  before = await bals({ p2: P2.wallet });
  const b2 = await buySelf(P2, A);
  check('self-paid order: the buyer is the fee payer; /confirm credits it', b2.pay.j.feePayer === P2.wallet && b2.paid);
  check('P2 paid price + fee + Ticket rent, exactly', before.p2 - (await bal(P2.wallet)) === PRICE_A + (await fee(b2.sig)) + ticketRent, `${before.p2 - (await bal(P2.wallet))}`);
  check('chain: pool A ACTIVE with three tickets', (await poolAcc(A)).status === 1);
  check('server: pool A active, 3 sold; P1 holds 2 ridable, P2 1', await until(async () => { const s = await serverPool(A); return s.status === 'active' && s.sold === 3; }) && (await myTickets(P1, A))?.balance === 2 && (await myTickets(P2, A))?.balance === 1);

  // ── 4. SPONSOR (anyone, no ticket): pool A gets 0.03 SOL – split like ticket money, so the prize cap grows
  before = await bals({ s: S.wallet, vault: vA });
  const sp = admintool(['sponsor', '--pool', String(A), '--lamports', String(SPONSOR_A), '-k', S.keyfile]);
  after = await bals({ s: S.wallet, vault: vA });
  const receiptA = codec.sponsorReceiptPda(A, S.wallet), receiptRent = await conn.getMinimumBalanceForRentExemption((await conn.getAccountInfo(receiptA, 'confirmed')).data.length);
  const rcA = await account('SponsorReceipt', receiptA);
  check('sponsor: the sponsor paid the amount + fee + its SponsorReceipt\'s rent (v4, M8), the vault holds it, Pool.sponsored counts it', before.s - after.s === SPONSOR_A + (await fee(sp.signature)) + receiptRent && after.vault - before.vault === SPONSOR_A && sp.pool.sponsored === SPONSOR_A
    && rcA?.lamports === SPONSOR_A && rcA.sponsor === S.wallet, `${before.s - after.s} vs ${SPONSOR_A} + fee + ${receiptRent}`);
  check('…the server mirror shows it (Sponsored event via the watcher)', await until(async () => (await serverPool(A)).sponsoredLamports === SPONSOR_A, 20000), String((await serverPool(A)).sponsoredLamports));

  // ── 5. pools B and C take a few tickets, C a sponsorship – both will miss their minimum of 5
  check('P3 buys 1 of pool B: exactly price + fee + Ticket rent', await (async () => { const b = await bal(P3.wallet); const r = await buyOnChain(P3, B); return r.paid && b - (await bal(P3.wallet)) === PRICE_B + (await fee(r.sig)) + ticketRent; })());
  check('P4 buys 1 of pool B', (await buyOnChain(P4, B)).paid);
  check('P5 and P6 buy 1 each of pool C', (await buyOnChain(P5, C)).paid && (await buyOnChain(P6, C)).paid);
  admintool(['sponsor', '--pool', String(C), '--lamports', String(SPONSOR_C), '-k', S.keyfile]);
  // the WEBHOOK path (QuickNode Streams → POST /api/chain/webhook): a buy straight on chain (no order – nothing calls /confirm), the server told by the webhook
  const W = await player(), hookUrl = `${BASE}/api/chain/webhook`;
  const direct = admintool(['buy', '-k', W.keyfile, '--pool', String(C)]);
  const hook = (headers) => fetch(hookUrl, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify([{ signature: direct.signature }]) });
  check('webhook: refused without the secret (401) and with a wrong one', (await hook({})).status === 401 && (await hook({ 'x-webhook-secret': 'wrong-secret-wrong-secret' })).status === 401);
  const hr = await hook({ 'x-webhook-secret': process.env.WEBHOOK_SECRET });
  const hj = await hr.json().catch(() => ({}));
  check('webhook: with the secret the signature is read back from the chain and settled', hr.status === 200 && hj.received === 1, JSON.stringify(hj));
  check('…the on-chain buy (no order) is credited to the wallet', !!(await until(async () => (await myTickets(W, C))?.bought === 1, 20000)), JSON.stringify(await myTickets(W, C)));
  check('pool C: 3 tickets + a sponsorship in the vault', (await bal(vC)) === RENT0 + 3 * PRICE_B + SPONSOR_C);
  const X = await player();
  check('there is no gasless route any more: a 4h order is 400 tier_retired and POST /api/tickets/orders/:id/submit is a 404', await (async () => {
    const o = await api('tickets', { body: { poolId: B, qty: 1, burnWarningAccepted: true }, cookie: X.cookie });
    const r = await api('tickets/orders/missing/submit', { body: { signedTransaction: 'AAAA' }, cookie: X.cookie });
    return o.status === 400 && o.j.code === 'tier_retired' && r.status === 404 && (await bal(vB)) === RENT0 + 2 * PRICE_B;
  })());

  // ── 6. rides on pool A in the real game: P1 twice, P2 once (verified recordings rank)
  await ride(h1, P1, '1h'); await ride(h1, P1, '1h');
  const h2 = await browser(P2, CDP + 1);
  await ride(h2, P2, '1h');
  check('server: the tickets were spent', (await myTickets(P1, A))?.balance === 0 && (await myTickets(P2, A))?.balance === 0);

  // ── 7. pool B missed its goal and NOBODY failed it yet: the lobby offers CLAIM REFUND at once (the refund transaction bundles fail_pool)
  await untilChain(Number((await poolAcc(B)).prepDeadline.getTime() / 1000), 'pool B prep deadline');
  check('low sales do not fail pool B', (await poolAcc(B)).status === 1);
  check('fail_pool is disabled', refuses(['fail-pool', '--pool', String(B), '-k', Z.keyfile], /NotFailable/, 'v6 low-sales refusal'));
  admintool(['cancel-pool', '--pool', String(B), ...treas]);
  await until(async () => (await serverPool(B)).status === 'refunding');
  const h3 = await browser(P3, CDP + 2);
  await h3.lobby();
  // GET /api/tiers lists free and 1h only, so a retired tier's failed pool has no card and CLAIM REFUND sits in #refunds. A painted card still counts.
  const claimAt = await until(async () => (await h3.txt('#tier-4h .go')) === 'CLAIM REFUND' ? 'card' : /CLAIM REFUND/.test(await h3.txt('#refunds')) ? 'strip' : null, 20000);
  check(`lobby: the missed-goal pool offers CLAIM REFUND before anyone failed it (${claimAt || 'nowhere'})`, claimAt === 'card' || claimAt === 'strip', claimAt === 'strip' ? await h3.txt('#refunds') : await h3.txt('#tier-4h .go'));
  const claimBtn = claimAt === 'strip' ? '#refunds button' : '#tier-4h .go', claimMsg = claimAt === 'strip' ? `#msg-refund-${B}` : '#msg-4h';
  before = await bals({ p3: P3.wallet });
  await h3.ev(`document.querySelector(${JSON.stringify(claimBtn)}).click()`);
  check('lobby: admin-cancelled ticket refunded by the wallet', await until(async () => /Refund(ed| sent)/.test(await h3.txt(claimMsg)) || (claimAt === 'strip' && !/CLAIM REFUND/.test(await h3.txt('#refunds'))), 60000), await h3.txt(claimMsg));
  await h3.shot('2-lobby-refunded');
  check('…the wallet was asked to sign AND send (self-paid)', (await h3.ev('JSON.stringify(__asked)')) === '["signAndSendTransaction"]');
  const sigR3 = (await conn.getSignaturesForAddress(P3.kp.publicKey, { limit: 1 }, 'confirmed'))[0]?.signature;
  after = await bals({ p3: P3.wallet });
  check('P3 got the price + its own Ticket rent back, minus the fee', !!sigR3 && after.p3 - before.p3 === PRICE_B + ticketRent - (await fee(sigR3)), `${after.p3 - before.p3}`);
  check('chain + server: pool B refunding', (await poolAcc(B)).status === 2 && await until(async () => (await serverPool(B)).status === 'refunding'));
  // P4 through the API: the pool is failed now, so no fail_pool in the transaction
  before = await bals({ p4: P4.wallet });
  const rf4 = await api(`pools/${B}/refund`, { cookie: P4.cookie });
  check('API refund on a failed pool: no fail_pool bundled', rf4.ok && rf4.j.needsFail === false && rf4.j.lamports === PRICE_B, JSON.stringify(rf4.j).slice(0, 120));
  const sigR4 = await sendSigned(signedB64(rf4.j.transaction, P4.kp));
  check('…settled; P4 got the price + its own Ticket rent back, minus the fee', !!(await settle(sigR4, P4.cookie)) && (await bal(P4.wallet)) - before.p4 === PRICE_B + ticketRent - (await fee(sigR4)));
  before = await bals({ admin: addr('admin'), seed: addr('seed') });
  const cb = admintool(['close-pool', '--pool', String(B), '-k', Z.keyfile]);
  after = await bals({ admin: addr('admin'), seed: addr('seed') });
  check('pool B closed by a stranger: cancelled, vault 0, creator +rent minimum, nothing left for the seed', cb.pool.status === 4 && cb.vaultLamports === 0 && after.admin - before.admin === RENT0 && after.seed === before.seed);
  await settle(cb.signature, P3.cookie);
  check('server: pool B cancelled', await until(async () => (await serverPool(B)).status === 'cancelled'), (await serverPool(B)).status);

  // ── 8. ticket-only: 4h and 8h are retired. The tiers list is free and 1h. A 4h ride is refused. The lobby paints no 4h buy.
  const listed = (await api('tiers')).j.tiers ?? [];
  const t4 = listed.find(t => t.id === '4h');
  if (t4?.pool) console.log(`NOTE ticket-only checks skipped: another 4h pool (#${t4.pool.id}) is live on this cluster`);
  else {
    if (t4) check('GET /api/tiers: 4h not on sale, no pay-per-ride price', t4.available === false && t4.onSale === false && t4.lamports === null && t4.pool === null, JSON.stringify(t4));
    else check('GET /api/tiers omits retired 4h and 8h', listed.some(t => t.id === 'free') && listed.some(t => t.id === '1h') && listed.every(t => t.id === 'free' || t.id === '1h'), JSON.stringify(listed.map(t => t.id)));
    const refused4 = await api('rides', { body: { tier: '4h' }, cookie: P3.cookie });
    check('POST /api/rides 4h is 400 tier_retired', refused4.status === 400 && refused4.j.code === 'tier_retired', `${refused4.status} ${refused4.j?.code}`);
    await h3.lobby();
    const seen = await until(async () => h3.ev('(() => { const one = document.querySelector("#tier-1h"); if (!one) return null; const go = document.querySelector("#tier-4h .go"); const st = document.querySelector("#tier-4h .st"); return { four: document.querySelector("#tier-4h") !== null, go: go?.textContent ?? "", disabled: go ? go.disabled === true : null, st: st?.textContent ?? "" }; })()'), 15000);
    const noBuy = !!seen && (seen.four === false || (seen.disabled === true && /SOON|NO POOL|NEXT POOL/.test(`${seen.st}${seen.go}`) && !/BUY/.test(seen.go)));
    check('lobby: retired 4h is not a buy while 1h is on the page', noBuy, JSON.stringify(seen));
    await h3.shot('3-lobby-soon');
  }

  // ── 9. the CRANK (CRANK_SECRET, one pass from the CLI): fails pool C and refunds it (and on localnet expires the baked pool and refunds it), closes them
  await untilChain(Number((await poolAcc(C)).prepDeadline.getTime() / 1000), 'pool C prep deadline');
  if (FX) check('the baked unpaid pool: a stranger may not close it after the grace (MustExpire – it would sweep the prize share)', refuses(['close-pool', '--pool', String(FX.expirePool), '-k', Z.keyfile], /MustExpire|0x1787/, 'close_pool by a stranger of an unpaid pool after the grace'));
  // an unsponsored pool's prize share is 0 under the player-share cap, so a positive total is PrizeExceedsShare before rule f. An empty root still has to be in time.
  if (FX) check('the baked unpaid pool: a winners root committed now could not be paid before its grace (CommitTooLate, rule f)', refuses(['commit-winners', '--pool', String(FX.expirePool), '--winners', 'none', '-k', `${KEYS}/admin.json`], /CommitTooLate|0x1794/, 'commit_winners on a pool past its settle grace'));
  const xb = FX ? { e1: addr('expire-buyer-1'), e2: addr('expire-buyer-2') } : {};
  admintool(['cancel-pool', '--pool', String(C), ...treas]);
  before = await bals({ crank: addr('crank'), p5: P5.wallet, p6: P6.wallet, seed: addr('seed'), admin: addr('admin'), s: S.wallet, ...xb });
  const clockBefore = await chainNow();
  const pass = crankPass();
  after = await bals({ crank: addr('crank'), p5: P5.wallet, p6: P6.wallet, seed: addr('seed'), admin: addr('admin'), s: S.wallet, ...xb });
  const ours = new Set([C, ...(FX ? [FX.expirePool] : [])]);
  const stepsOf = id => pass.actions.filter(a => a.poolId === id).map(a => `${a.step}${a.error ? '✗' : ''}`).join(' ');
  const others = pass.actions.filter(a => !ours.has(a.poolId));
  check('crank pass: admin-cancelled pool C refund + refund_sponsor (v4, M8) + close' + (FX ? ', the baked pool expire + refund + close' : ''), stepsOf(C) === 'refund refund_sponsor close_pool' && (!FX || stepsOf(FX.expirePool) === 'expire_pool refund close_pool')
    && pass.actions.every(a => !a.error && a.settled === 'done'), pass.actions.map(a => `${a.step}#${a.poolId}${a.error ? `✗ ${a.error.slice(0, 200)}` : ''}`).join(' '));
  if (others.length) console.log(`NOTE the crank also handled other pools on this cluster: ${others.map(a => `${a.step}#${a.poolId}`).join(' ')} – the balance checks below are skipped where they would mix in`);
  // chainNow is read at the start of the pass. The transactions that follow move the validator clock, so the stamp has to sit between the read before the pass and the read after it.
  const clockAfter = await chainNow();
  check('…judged by the chain clock it reported', pass.chainNow / 1000 >= clockBefore - 2 && pass.chainNow / 1000 <= clockAfter + 2, `${pass.chainNow / 1000} not in [${clockBefore}, ${clockAfter}]`);
  const crankFees = (await Promise.all(pass.actions.filter(a => a.signature).map(a => fee(a.signature)))).reduce((a, b) => a + b, 0);
  check('the crank key paid every fee and nothing else', before.crank - after.crank === crankFees, `${before.crank - after.crank} vs ${crankFees}`);
  check('pool C refunds: P5 and P6 each +price +their own rent', after.p5 - before.p5 === PRICE_B + ticketRent && after.p6 - before.p6 === PRICE_B + ticketRent);
  if (FX) check('baked pool refunds: e1 and e2 each +price +their own rent', after.e1 - before.e1 === PRICE_B + ticketRent && after.e2 - before.e2 === PRICE_B + ticketRent);
  if (!others.length) {
    const creatorRents = FX ? 2 : 1;
    check('closes: C\'s sponsorship goes back to its sponsor with the receipt\'s rent (v4, M8 – the seed gets nothing of it), the creator the vault rent minimum(s)', after.s - before.s === SPONSOR_C + receiptRent && after.seed === before.seed && after.admin - before.admin === creatorRents * RENT0
      && (await conn.getAccountInfo(codec.sponsorReceiptPda(C, S.wallet), 'confirmed')) === null, `${after.s - before.s} / ${after.seed - before.seed} / ${after.admin - before.admin}`);
  }
  check('chain: cancelled, vault(s) 0', (await poolAcc(C)).status === 4 && (await bal(vC)) === 0 && (!FX || ((await poolAcc(FX.expirePool)).status === 4 && (await bal(codec.vaultPda(FX.expirePool))) === 0)));
  check('server mirror: cancelled', await until(async () => (await serverPool(C)).status === 'cancelled' && (!FX || (await serverPool(FX.expirePool)).status === 'cancelled')));
  check('a second crank pass has nothing to do for our pools', crankPass().actions.filter(a => ours.has(a.poolId)).length === 0);

  // ── 10. (localnet) the baked pool that paid a prize: after the grace ANYONE may close it – money only to the treasuries it declared
  if (FX) {
    check('the baked pool that paid a prize cannot be expired (the refund maths assumes nothing left the vault)', refuses(['expire-pool', '--pool', String(FX.gracePool), '-k', Z.keyfile], /PrizesAlreadyPaid|0x1785/, 'expire_pool on a pool that paid a prize'));
    const gy = await poolAcc(FX.gracePool), gyVault = await bal(codec.vaultPda(FX.gracePool));
    const gLegs = closeSplit({ priceLamports: gy.priceLamports, ticketsSold: gy.ticketsSold, sponsored: gy.sponsored, prizeBps: gy.prizeBps, seedBps: gy.seedBps, platformFeeBps: PLAT_BPS, ...(gy.maxPlayerShareBps !== undefined ? { maxPlayerShareBps: gy.maxPlayerShareBps } : {}), prizesPaid: gy.prizesPaid, vaultLamports: gyVault, cancelled: false, rentMin: RENT0 });
    const v3 = FX.v3Attestation, v3Args = ['close-attestation', '--pool', String(v3.pool), '--driver', v3.driver, '-k', Z.keyfile];
    check('a v3 Attestation of a pool still live cannot be closed (NotSettled)', refuses(v3Args, /NotSettled|0x177f/, 'close_attestation of a live pool\'s v3 attestation'));
    before = await bals({ fee: addr('fee'), plat: addr('plat'), seed: addr('seed'), admin: addr('admin'), stranger: Z.wallet });
    const cy = admintool(['close-pool', '--pool', String(FX.gracePool), '-k', Z.keyfile]);
    after = await bals({ fee: addr('fee'), plat: addr('plat'), seed: addr('seed'), admin: addr('admin'), stranger: Z.wallet });
    check('grace close by a stranger: settled, vault 0', cy.pool.status === 3 && cy.vaultLamports === 0);
    check('…legs exact (fee / platform / seed incl. the unclaimed prize / creator rent), the stranger only paid its fee', after.fee - before.fee === gLegs.fee && after.plat - before.plat === gLegs.platformFee && after.seed - before.seed === gLegs.seed
      && after.admin - before.admin === RENT0 && before.stranger - after.stranger === (await fee(cy.signature)),
      JSON.stringify({ got: Object.fromEntries(Object.keys(after).map(k => [k, after[k] - before[k]])), legs: gLegs, closeFee: await fee(cy.signature) }));
    // v4 (L7): the settled pool's v3 per-driver Attestation (what record_attestation left on a v3 deployment) gives its rent back – to the payout key, the admin when none is named
    const attAddr = codec.attestationPda(v3.pool, v3.driver), attLamports = await bal(attAddr.toBase58()), a0 = await bal(addr('admin'));
    const ca = admintool(v3Args);
    const caEv = (await conn.getTransaction(ca.signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 })).meta.logMessages;
    const closedEv = codec.programData(caEv).map?.(l => codec.decodeEvent(l.bytes)).find(e => e?.name === 'AttestationClosed')?.fields;
    check('close_attestation by a stranger: the v3 Attestation is gone, its rent to the admin (no payout key named), AttestationClosed', (await conn.getAccountInfo(attAddr, 'confirmed')) === null && (await bal(addr('admin'))) - a0 === attLamports && attLamports > 0
      && closedEv?.rentTo === addr('admin') && closedEv.lamports === attLamports, JSON.stringify({ got: (await bal(addr('admin'))) - a0, attLamports, closedEv }));
  }

  // ── 11. pool A after its play deadline: the admin pays the ranked prizes, then closes – the sponsorship is in the pot
  await untilChain(Number((await poolAcc(A)).playDeadline.getTime() / 1000), 'pool A play deadline');
  const ADM = { kp: admin, wallet: addr('admin') };
  const { j: an } = await api('auth/nonce', { body: { wallet: ADM.wallet } });
  ADM.cookie = (await fetch(`${BASE}/api/auth/verify`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ wallet: ADM.wallet, signature: bs58.encode(nacl.sign.detached(new TextEncoder().encode(an.message), admin.secretKey)) }) })).headers.get('set-cookie').split(';')[0];
  check('payouts are refused to a player (403)', (await api(`pools/${A}/payout`, { cookie: P1.cookie })).status === 403);
  // v4 (H5-B): the ranking is first COMMITTED as a winners root (public until its lock ends – here at once: no review window, floors 0), then each rank
  // is paid with its Merkle proof (anyone may send it), then the pool closes. No attestation stands in front of a prize any more.
  let po = await api(`pools/${A}/payout`, { cookie: ADM.cookie });
  const chainA = await poolAcc(A);
  const bound = prizeBound({ priceLamports: PRICE_A, ticketsSold: 3, sponsored: SPONSOR_A, prizeBps: 7000, seedBps: 2000, ...(chainA.maxPlayerShareBps !== undefined ? { maxPlayerShareBps: chainA.maxPlayerShareBps } : {}) });
  const order = await rankedWallets(A, [P1.wallet, P2.wallet]);
  const want = poolPayouts(bound, order);
  check('ranking: P1 and P2 once, in score-formula order; the prize cap includes the sponsorship; amounts = the payout table; nothing committed yet → commit_winners offered', order.length === 2 && po.ok && po.j.ranks.map(r => r.wallet).join() === order.join() && po.j.ranks.map(r => r.lamports).join() === want.map(w => w.lamports).join() && po.j.prizeLamports === bound
    && !!po.j.commit && po.j.committedRoot === null && po.j.transactions.length === 0 && po.j.close === null, JSON.stringify(po.j.ranks ?? po.j).slice(0, 300));
  const winnersArg = want.map(w => `${w.wallet}:${w.lamports}`).join(',');
  check('pay_prize before any commit → refused (WinnersNotCommitted)', refuses(['pay-prize', '--pool', String(A), '--winners', winnersArg, '--rank', '1', '-k', Z.keyfile], /WinnersNotCommitted|0x1792/, 'pay_prize before commit_winners'));
  const sigCommit = await sendSigned(signedB64(po.j.commit.transaction, admin)); await settle(sigCommit, ADM.cookie);
  const committed = await poolAcc(A);
  check('commit_winners (the admin signs what GET payout built): root, total = the plan, 2 ranks, nothing paid; pays from the commit (payout_at = play, floor 0)', committed.winnersCount === 2 && committed.winnersTotal === want.reduce((a, w) => a + w.lamports, 0) && Number(committed.paidMask) === 0
    && committed.payFrom.getTime() === committed.committedAt.getTime() && committed.committedAt.getTime() >= committed.playDeadline.getTime(), JSON.stringify({ count: committed.winnersCount, total: committed.winnersTotal, at: committed.committedAt, from: committed.payFrom }));
  check('…a second commit is refused (WinnersCommitted)', refuses(['commit-winners', '--pool', String(A), '--winners', winnersArg, '-k', `${KEYS}/admin.json`], /WinnersCommitted|0x1791/, 'commit_winners twice'));
  check('…close_pool before the committed ranks are paid → refused (PrizesUnpaid)', refuses(['close-pool', '--pool', String(A), '-k', `${KEYS}/admin.json`], /PrizesUnpaid|0x1798/, 'close_pool with committed ranks unpaid'));
  po = await until(async () => { const r = await api(`pools/${A}/payout`, { cookie: ADM.cookie }); return r.j.transactions?.length ? r : null; }, 20000, 1000);   // the server judges payFrom by its own clock
  check('GET payout after the commit: the committed root is the ranking, one pay_prize per rank, a veto still offered (nothing paid)', !!po && po.j.committedRoot === committed.winnersRoot && po.j.transactions.map(t => t.lamports).join() === want.map(w => w.lamports).join() && !!po.j.veto, JSON.stringify(po?.j ?? null).slice(0, 300));
  let paidTotal = 0;
  for (const t of po?.j.transactions ?? []) {
    const b0 = await bal(t.to), sig = await sendSigned(signedB64(t.transaction, admin)); await settle(sig, ADM.cookie);
    check(`pay_prize rank ${t.rank}: the winner got exactly ${t.lamports} lamports`, (await bal(t.to)) - b0 === t.lamports, `${(await bal(t.to)) - b0}`);
    paidTotal += t.lamports;
  }
  check('the same rank once more (anyone, with the committed list) → refused (RankAlreadyPaid)', refuses(['pay-prize', '--pool', String(A), '--winners', winnersArg, '--rank', '1', '-k', Z.keyfile], /RankAlreadyPaid|0x1796/, 'pay_prize of a paid rank'));
  const po2 = await api(`pools/${A}/payout`, { cookie: ADM.cookie });
  check('every rank paid → close_pool offered', po2.j.close && po2.j.transactions.length === 0 && po2.j.ranks.every(r => r.paid));
  const vaultBefore = await bal(vA), paidOnChain = (await poolAcc(A)).prizesPaid;
  const legs = closeSplit({ priceLamports: PRICE_A, ticketsSold: chainA.ticketsSold, sponsored: chainA.sponsored, prizeBps: 7000, seedBps: 2000, platformFeeBps: PLAT_BPS, ...(chainA.maxPlayerShareBps !== undefined ? { maxPlayerShareBps: chainA.maxPlayerShareBps } : {}), prizesPaid: paidOnChain, vaultLamports: vaultBefore, cancelled: false, rentMin: RENT0 });
  before = await bals({ fee: addr('fee'), plat: addr('plat'), seed: addr('seed'), admin: addr('admin') });
  const sigC = await sendSigned(signedB64(po2.j.close.transaction, admin)); await settle(sigC, ADM.cookie);
  after = await bals({ fee: addr('fee'), plat: addr('plat'), seed: addr('seed'), admin: addr('admin') });
  check('prizes on chain = what was paid', paidOnChain === paidTotal, `${paidOnChain} vs ${paidTotal}`);
  check('close_pool: fee treasury exact', after.fee - before.fee === legs.fee, `${after.fee - before.fee} vs ${legs.fee}`);
  check(`close_pool: platform treasury exact (${PLAT_BPS} bps of the fee share)`, after.plat - before.plat === legs.platformFee && (PLAT_BPS === 0 || legs.platformFee > 0), `${after.plat - before.plat} vs ${legs.platformFee}`);
  check('close_pool: seed treasury = seed share + unclaimed prize', after.seed - before.seed === legs.seed && legs.unclaimed === bound - paidTotal, `${after.seed - before.seed} vs ${legs.seed} (unclaimed ${legs.unclaimed})`);
  check('close_pool: creator +rent minimum − the close fee', after.admin - before.admin === RENT0 - (await fee(sigC)), `${after.admin - before.admin}`);
  check('vault A = 0, pool settled on chain and on the server', (await bal(vA)) === 0 && (await poolAcc(A)).status === 3 && await until(async () => (await serverPool(A)).status === 'settled'));
  // v4 (M8): the settled pool's sponsorship was in the split – its receipt only gives its rent back (anyone may send it)
  before = await bals({ s: S.wallet });
  admintool(['close-sponsor-receipt', '--pool', String(A), '--sponsor', S.wallet, '-k', Z.keyfile]);
  check('close_sponsor_receipt of the settled pool A by a stranger: the sponsor gets the receipt\'s rent back, the account is gone', (await bal(S.wallet)) - before.s === receiptRent && (await conn.getAccountInfo(receiptA, 'confirmed')) === null, `${(await bal(S.wallet)) - before.s}`);
  check('conservation: tickets + sponsorship = prizes + every close leg', 3 * PRICE_A + SPONSOR_A === paidTotal + legs.fee + legs.platformFee + legs.seed, `${3 * PRICE_A + SPONSOR_A} vs ${paidTotal + legs.fee + legs.platformFee + legs.seed}`);

  // The driver's first road-plan fetch is before the server starts the ride (404, then a retry). Chrome also logs that 404 as "status of 404".
  const noise = p => !/favicon|status of 409|status of 404|road plan: server error 404/.test(p);
  const probs = browsers.flatMap(h => h.filt().filter(noise));
  check('no page errors (lobby + game, 3 browsers)', probs.length === 0, probs.slice(0, 5).join(' | '));
  console.log(`screenshots: ${browsers[0]?.SHOTS}`);
} catch (e) {
  check('scenario threw', false, e?.stack ?? String(e));
}
if (process.env.SWEEP && funder) {   // devnet: what the throwaway players hold goes back to the funder (devnet SOL is scarce)
  let back = 0;
  for (const kp of players) {
    const l = await bal(kp.publicKey.toBase58()).catch(() => 0);
    if (l <= 5_000) continue;
    try { await sendAndConfirmTransaction(conn, new Transaction().add(SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: funder.publicKey, lamports: l - 5_000 })), [kp], { commitment: 'confirmed' }); back += l - 5_000; } catch { /* a ticket-rent account etc. – leave it */ }
  }
  console.log(`swept ${(back / 1e9).toFixed(4)} SOL back to the funder`);
}
console.log(fails.length ? `\n✗ ${fails.length} failed: ${fails.join(' · ')}` : '\n✓ all money flows verified on the local chain');
const code = fails.length ? 1 : 0;
for (const h of browsers) h.finish(code, 300);
if (!browsers.length) process.exit(code);
