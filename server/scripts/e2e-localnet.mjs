// The money flows end to end on a LOCAL chain – real program transactions, real lamports, every balance asserted. Started by .claude/skills/localnet-e2e/run.sh
// (validator + program + initialize + server in program mode on a throwaway DB); env: BASE, RPC, KEYS (scratch keypair dir), CHROME_PORT.
//   pool A (1h, min 3): P1 buys 2 in the LOBBY (fake Phantom signs, the sponsor pays fee + rent) → P2 buys 1 self-paid from Node (signs + sends + /confirm)
//                       → live → P1 rides twice, P2 once in the real game (verified recordings) → play deadline → the admin pays the ranked prizes
//                       (GET payout → sign pay_prize → settle) → close_pool → fee / platform / seed / creator legs exact, vault 0, server = chain.
//   pool B (4h, min 5): P3 buys 1 gasless from Node (/submit), P4 1 self-paid → prep deadline missed → P4 refunds through the API (fail_pool + refund in one
//                       transaction) → the pool is refunding → P3 CLAIM REFUND in the lobby → anyone closes it → cancelled, vault 0.
// Deadlines run on the validator's clock (no warp): the run is paced by them (PREP_A / PLAY_A / PREP_B seconds, defaults below).
import nacl from 'tweetnacl'; import bs58 from 'bs58'; import { readFileSync } from 'node:fs'; import { execFileSync } from 'node:child_process';
import { Connection, Keypair, PublicKey, SYSVAR_CLOCK_PUBKEY, Transaction } from '@solana/web3.js';
import { launch, sleep } from '../../client/tools/cdp.mjs';
import { PoolProgramCodec } from '../dist/infrastructure/solana/pool-program.codec.js';
import { POOL_PROGRAM_IDL } from '../dist/infrastructure/solana/pool-program.idl.js';
import { closeSplit, prizeBound, VAULT_RENT_MIN_LAMPORTS } from '../dist/domain/economy/vault-split.js';
import { poolPayouts } from '../dist/domain/economy/pool-payouts.js';

const { BASE, RPC, KEYS } = process.env;
if (!BASE || !RPC || !KEYS) { console.error('run it through .claude/skills/localnet-e2e/run.sh (needs BASE, RPC, KEYS)'); process.exit(2); }
const CDP = +(process.env.CHROME_PORT || 9371);
const PREP_A = +(process.env.PREP_A || 100), PLAY_A = +(process.env.PLAY_A || 150), PREP_B = +(process.env.PREP_B || 45);
const PRICE_A = 100_000_000, PRICE_B = 50_000_000;   // 0.1 / 0.05 SOL
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
const untilChain = async (ts, what) => { const left = ts - (await chainNow()); if (left > 0) console.log(`     … waiting ${left} s for ${what} (chain clock)`); while ((await chainNow()) < ts + 2) await sleep(1000); };
const account = async (name, a) => { const i = await conn.getAccountInfo(a, 'confirmed'); return i ? codec.decodeAccount(name, i.data) : null; };
const poolAcc = id => account('Pool', codec.poolPda(id));
const ticketRent = await conn.getMinimumBalanceForRentExemption(8 + 79);
const admintool = args => JSON.parse(execFileSync('node', ['scripts/pool-admin.mjs', ...args, '--url', RPC], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim().split('\n').pop());

// ── HTTP as a wallet (the session cookie of a nacl sign-in, like the other e2e scripts)
const api = async (path, { body, cookie, method } = {}) => {
  const r = await fetch(`${BASE}/api/${path}`, { method: method ?? (body ? 'POST' : 'GET'), headers: { 'content-type': 'application/json', ...(cookie && { cookie }) }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, ok: r.ok, j };
};
async function player(lamports = 5e9) {
  const kp = Keypair.generate(), wallet = kp.publicKey.toBase58();
  await conn.confirmTransaction(await conn.requestAirdrop(kp.publicKey, lamports), 'confirmed');
  const { j } = await api('auth/nonce', { body: { wallet } });
  const r = await fetch(`${BASE}/api/auth/verify`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ wallet, signature: bs58.encode(nacl.sign.detached(new TextEncoder().encode(j.message), kp.secretKey)) }) });
  if (!r.ok) throw new Error(`sign-in failed: ${r.status} ${await r.text()}`);
  return { kp, wallet, cookie: r.headers.get('set-cookie').split(';')[0] };
}
const signedB64 = (b64, kp) => { const tx = Transaction.from(Buffer.from(b64, 'base64')); tx.partialSign(kp); return tx; };
const sendSigned = async tx => { const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false }); await conn.confirmTransaction(sig, 'confirmed'); return sig; };
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
  h.lobby = async () => { await h.send('Page.navigate', { url: `${BASE}/lobby.html#new` }); return until(async () => (await h.ev('document.querySelectorAll(".tier").length')) >= 3, 20000); };
  return h;
}
// a ticket ride in the real game (the e2e-browser.mjs recipe): START, distance under the governor on the game clock, human-ish key presses, END SHIFT → server verdict
async function ride(h, p, tier) {
  const r = await api('rides', { body: { tier }, cookie: p.cookie });
  if (!check(`${tier} ride created with a ticket (${p.wallet.slice(0, 6)}…)`, r.ok && r.j.status === 'created', `${r.status} ${JSON.stringify(r.j).slice(0, 200)}`)) return null;
  await h.send('Page.navigate', { url: `${BASE}/play.html?ride=${r.j.id}` });
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
  await h.ev('document.dispatchEvent(new KeyboardEvent("keydown", { key: "p", code: "KeyP", bubbles: true })); window.dispatchEvent(new KeyboardEvent("keydown", { key: "p", code: "KeyP", bubbles: true }))'); await sleep(500);
  await h.ev('document.getElementById("endshift")?.click()');
  const done = await until(async () => { const s = (await api(`rides/${r.j.id}`, { cookie: p.cookie })).j; return s.verdict ? s : null; }, 30000, 1000);
  check(`…ride completed and VERIFIED (${p.wallet.slice(0, 6)}…)`, done?.status === 'completed' && done?.verdict?.status === 'verified', JSON.stringify({ status: done?.status, verdict: done?.verdict?.status, reasons: done?.verdict?.reasons }));
  return r.j.id;
}

try {
  // ── 0. the stack
  const tiers = (await api('tiers')).j;
  check('server sells tickets through the program (paymentMode = program)', tiers.paymentMode === 'program', String(tiers.paymentMode));
  const cfg = await account('Config', codec.configPda());
  check('Config: admin = TREASURY_PUBKEY (named by the upgrade authority), platform cut 500 bps', cfg?.authority === addr('admin') && cfg?.platformFeeBps === 500, JSON.stringify(cfg));

  // ── 1. pools, created by the admin and registered on the server
  const treas = ['--fee-treasury', addr('fee'), '--seed-treasury', addr('seed'), '-k', `${KEYS}/admin.json`];
  const A = admintool(['create-pool', '--tier', '1h', '--price', String(PRICE_A), '--min', '3', '--max', '10', '--per-wallet', '3', '--prep', `+${PREP_A}`, '--play', `+${PLAY_A}`, '--split', '7000/2000/1000', ...treas]).poolId;
  const B = admintool(['create-pool', '--tier', '4h', '--price', String(PRICE_B), '--min', '5', '--max', '0', '--per-wallet', '2', '--prep', `+${PREP_B}`, '--play', `+${PREP_B + 60}`, '--split', '6000/2500/1500', ...treas]).poolId;
  for (const [id, label] of [[A, 'LOCAL 1H'], [B, 'LOCAL 4H']]) execFileSync('node', ['dist/cli/index.js', 'pool:register', String(id), '--label', label], { stdio: 'ignore' });
  const pa = await poolAcc(A), pb = await poolAcc(B);
  check('two pools on chain (open), vaults hold exactly the rent minimum', pa?.status === 0 && pb?.status === 0 && (await bal(codec.vaultPda(A))) === VAULT_RENT_MIN_LAMPORTS && (await bal(codec.vaultPda(B))) === VAULT_RENT_MIN_LAMPORTS);
  check('…and registered on the server', (await serverPool(A)).status === 'open' && (await serverPool(B)).status === 'open', `${(await serverPool(A)).status} / ${(await serverPool(B)).status}`);

  const [P1, P2, P3, P4] = [await player(), await player(), await player(), await player()];
  const vA = codec.vaultPda(A).toBase58(), vB = codec.vaultPda(B).toBase58();

  // ── 2. P1 buys 2 tickets of pool A in the LOBBY: gasless (the wallet only signs, the server adds the sponsor and sends)
  const h1 = await browser(P1, CDP);
  check('lobby: the pooled tier cards render', await h1.lobby());
  let before = await bals({ p1: P1.wallet, sp: addr('sponsor'), vault: vA });
  await h1.ev('document.querySelector("#tier-1h .qty button:last-child").click()');
  check('lobby: BUY 2 TICKETS · 0.200 SOL', /BUY 2 TICKETS · 0\.200 SOL/.test(await h1.txt('#tier-1h .buyb')), await h1.txt('#tier-1h .buyb'));
  await h1.ev('document.querySelector("#tier-1h .buyb").click()');
  check('lobby: paid + 2 tickets credited', await until(async () => /Paid – 2 tickets credited/.test(await h1.txt('#msg-1h')), 60000), await h1.txt('#msg-1h'));
  check('…the wallet was only asked to SIGN (gasless)', (await h1.ev('JSON.stringify(__asked)')) === '["signTransaction"]', await h1.ev('JSON.stringify(__asked)'));
  await h1.shot('1-lobby-bought');
  let after = await bals({ p1: P1.wallet, sp: addr('sponsor'), vault: vA });
  const t1 = await account('Ticket', codec.ticketPda(A, P1.wallet));
  check('P1 paid exactly 2 × price, not a lamport more', before.p1 - after.p1 === 2 * PRICE_A, `${before.p1 - after.p1}`);
  check('vault A += 2 × price', after.vault - before.vault === 2 * PRICE_A, `${after.vault - before.vault}`);
  check('the sponsor paid the network fee + the Ticket rent', before.sp - after.sp > ticketRent && before.sp - after.sp < ticketRent + 100_000, `${before.sp - after.sp} (rent ${ticketRent})`);
  check('Ticket account: qty 2, rent_payer = the sponsor', t1?.qty === 2 && t1?.rentPayer === addr('sponsor'), JSON.stringify(t1));
  check('chain: pool A still open (2 < min 3)', (await poolAcc(A)).status === 0);

  // ── 3. P2 buys 1 self-paid from Node: signs AND sends, then /confirm – the purchase that takes pool A live
  before = await bals({ p2: P2.wallet, vault: vA });
  const o2 = await api('tickets', { body: { poolId: A, qty: 1 }, cookie: P2.cookie });
  const pay2 = await api(`tickets/orders/${o2.j.id}/payment?selfPaid=1`, { cookie: P2.cookie });
  check('self-paid order: the buyer is the fee payer', o2.ok && pay2.ok && pay2.j.feePayer === P2.wallet && pay2.j.sponsored === false, JSON.stringify(pay2.j).slice(0, 200));
  const sig2 = await sendSigned(signedB64(pay2.j.transaction, P2.kp));
  const c2 = await until(async () => { const r = await api(`tickets/orders/${o2.j.id}/confirm`, { body: { signature: sig2 }, cookie: P2.cookie }); return r.j.status === 'paid' ? r : null; });
  check('…/confirm credits it', !!c2);
  after = await bals({ p2: P2.wallet, vault: vA });
  const f2 = await fee(sig2);
  check('P2 paid price + fee + Ticket rent, exactly', before.p2 - after.p2 === PRICE_A + f2 + ticketRent, `${before.p2 - after.p2} vs ${PRICE_A}+${f2}+${ticketRent}`);
  check('chain: pool A ACTIVE (3 ≥ min 3)', (await poolAcc(A)).status === 1);
  check('server: pool A active, 3 sold', await until(async () => { const s = await serverPool(A); return s.status === 'active' && s.sold === 3; }), JSON.stringify(await serverPool(A)).slice(0, 200));
  check('server: P1 holds 2 ridable, P2 1', (await myTickets(P1, A))?.balance === 2 && (await myTickets(P2, A))?.balance === 1);

  // ── 4. pool B: P3 gasless from Node (/submit), P4 self-paid – it will miss its minimum of 5
  const o3 = await api('tickets', { body: { poolId: B, qty: 1 }, cookie: P3.cookie });
  const pay3 = await api(`tickets/orders/${o3.j.id}/payment`, { cookie: P3.cookie });
  check('gasless order: the sponsor is the fee payer', pay3.j.sponsored === true && pay3.j.feePayer === addr('sponsor'), JSON.stringify(pay3.j).slice(0, 160));
  before = await bals({ p3: P3.wallet });
  const s3 = await api(`tickets/orders/${o3.j.id}/submit`, { body: { signedTransaction: signedB64(pay3.j.transaction, P3.kp).serialize({ requireAllSignatures: false }).toString('base64') }, cookie: P3.cookie });
  check('/submit: the server co-signs, sends, credits', s3.ok && (s3.j.status === 'paid' || !!(await until(async () => (await api(`tickets/orders/${o3.j.id}`, { cookie: P3.cookie })).j.status === 'paid'))), `${s3.status} ${JSON.stringify(s3.j).slice(0, 160)}`);
  check('P3 paid exactly the price (gasless)', before.p3 - (await bal(P3.wallet)) === PRICE_B);
  const o4 = await api('tickets', { body: { poolId: B, qty: 1 }, cookie: P4.cookie });
  const pay4 = await api(`tickets/orders/${o4.j.id}/payment?selfPaid=1`, { cookie: P4.cookie });
  const sig4 = await sendSigned(signedB64(pay4.j.transaction, P4.kp));
  check('P4 bought 1 self-paid', !!(await until(async () => (await api(`tickets/orders/${o4.j.id}/confirm`, { body: { signature: sig4 }, cookie: P4.cookie })).j.status === 'paid')));
  // a fresh wallet: the refused order stays pending until its TTL (the lobby would show it as "in flight")
  const X = await player(), spX = await bal(addr('sponsor'));
  check('a tampered transaction is refused by the sponsor boundary (/submit with other bytes), nothing sent', await (async () => {
    const o = await api('tickets', { body: { poolId: B, qty: 1 }, cookie: X.cookie }); const pay = await api(`tickets/orders/${o.j.id}/payment`, { cookie: X.cookie });
    const tx = Transaction.from(Buffer.from(pay.j.transaction, 'base64')); tx.instructions[tx.instructions.length - 1].data[8] ^= 1; tx.partialSign(X.kp);
    const r = await api(`tickets/orders/${o.j.id}/submit`, { body: { signedTransaction: tx.serialize({ requireAllSignatures: false }).toString('base64') }, cookie: X.cookie });
    return r.status === 400 && (await bal(addr('sponsor'))) === spX && (await bal(codec.vaultPda(B))) === VAULT_RENT_MIN_LAMPORTS + 2 * PRICE_B;
  })());

  // ── 5. rides on pool A in the real game: P1 twice, P2 once (verified recordings rank)
  await ride(h1, P1, '1h'); await ride(h1, P1, '1h');
  const h2 = await browser(P2, CDP + 1);
  await ride(h2, P2, '1h');
  check('server: the tickets were spent', (await myTickets(P1, A))?.balance === 0 && (await myTickets(P2, A))?.balance === 0);

  // ── 6. pool B misses its goal: P4 refunds through the API (fail_pool + refund in one transaction, anyone may fail it)
  await untilChain(Number((await poolAcc(B)).prepDeadline.getTime() / 1000), 'pool B prep deadline');
  before = await bals({ p4: P4.wallet, vault: vB });
  const rf4 = await api(`pools/${B}/refund`, { cookie: P4.cookie });
  check('refund tx for a pool still open past its deadline bundles fail_pool', rf4.ok && rf4.j.needsFail === true && rf4.j.lamports === PRICE_B, JSON.stringify(rf4.j).slice(0, 160));
  const sigR4 = await sendSigned(signedB64(rf4.j.transaction, P4.kp));
  check('…settled on the server', !!(await settle(sigR4, P4.cookie)));
  after = await bals({ p4: P4.wallet, vault: vB });
  check('P4 got the price + its own Ticket rent back, minus the fee', after.p4 - before.p4 === PRICE_B + ticketRent - (await fee(sigR4)), `${after.p4 - before.p4}`);
  check('chain: pool B refunding, P4 ticket closed', (await poolAcc(B)).status === 2 && !(await conn.getAccountInfo(codec.ticketPda(B, P4.wallet))));
  check('server: pool B refunding', await until(async () => (await serverPool(B)).status === 'refunding'));

  // ── 7. P3 claims in the LOBBY. A refunding pool is no longer the tier's live pool (the 4h card falls back to buy-and-ride), so the claim sits in the
  //       refunds strip ("failed pools no tier card shows"): CLAIM REFUND → signAndSend → settle; the Ticket rent goes back to the sponsor that paid it
  const h3 = await browser(P3, CDP + 2);
  await h3.lobby();
  check('lobby: the failed pool sits in the refunds strip with CLAIM REFUND', await until(async () => /CLAIM REFUND/.test(await h3.txt('#refunds')), 20000), await h3.txt('#refunds'));
  check('…and the 4h card no longer sells into it', !/CLAIM REFUND/.test(await h3.txt('#tier-4h')), await h3.txt('#tier-4h .go'));
  before = await bals({ p3: P3.wallet, sp: addr('sponsor') });
  await h3.ev('document.querySelector("#refunds button").click()');
  const msg = `#msg-refund-${B}`;
  check('lobby: refunded', await until(async () => /Refunded/.test(await h3.txt(msg)) || (await h3.txt('#refunds')) === '', 60000), `${await h3.txt(msg)} | ${await h3.txt('#refunds')}`);
  await h3.shot('2-lobby-refunded');
  const ask = JSON.parse(await h3.ev('JSON.stringify(__asked)'));
  check('…the wallet was asked to sign AND send (self-paid)', ask.join() === 'signAndSendTransaction', ask.join());
  const sigR3 = (await conn.getSignaturesForAddress(P3.kp.publicKey, { limit: 1 }, 'confirmed'))[0]?.signature;
  after = await bals({ p3: P3.wallet, sp: addr('sponsor') });
  check('P3 got the price back minus the fee; the sponsor got its Ticket rent back', !!sigR3 && after.p3 - before.p3 === PRICE_B - (await fee(sigR3)) && after.sp - before.sp === ticketRent, `${after.p3 - before.p3} / ${after.sp - before.sp}`);
  check('chain: every ticket of pool B refunded', (await poolAcc(B)).refunded === 2 * PRICE_B, `${(await poolAcc(B)).refunded}`);

  // ── 8. anyone closes the refunded pool: cancelled, vault 0, the creator gets the rent minimum back
  before = await bals({ admin: addr('admin'), seed: addr('seed') });
  let cb = null;
  try { cb = admintool(['close-pool', '--pool', String(B), '-k', `${KEYS}/mint.json`]); } catch (e) { check('pool B closed by a stranger', false, String(e.stderr ?? e).split('\n')[0]); }
  if (cb) {
    after = await bals({ admin: addr('admin'), seed: addr('seed') });
    check('pool B closed by a stranger: cancelled, vault 0', cb.pool.status === 4 && cb.vaultLamports === 0, JSON.stringify({ status: cb.pool.status, vault: cb.vaultLamports }));
    check('…creator +rent minimum, nothing else left to sweep', after.admin - before.admin === VAULT_RENT_MIN_LAMPORTS && after.seed === before.seed, `${after.admin - before.admin} / ${after.seed - before.seed}`);
    await settle(cb.signature, P3.cookie);
    check('server: pool B cancelled', await until(async () => (await serverPool(B)).status === 'cancelled'), (await serverPool(B)).status);
  }

  // ── 9. pool A after its play deadline: the admin pays the ranked prizes, then closes (all signed by the admin key, as Phantom would)
  await untilChain(Number((await poolAcc(A)).playDeadline.getTime() / 1000), 'pool A play deadline');
  const ADM = { kp: admin, wallet: addr('admin') };
  const { j: an } = await api('auth/nonce', { body: { wallet: ADM.wallet } });
  ADM.cookie = (await fetch(`${BASE}/api/auth/verify`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ wallet: ADM.wallet, signature: bs58.encode(nacl.sign.detached(new TextEncoder().encode(an.message), admin.secretKey)) }) })).headers.get('set-cookie').split(';')[0];
  check('payouts are refused to a player (403)', (await api(`pools/${A}/payout`, { cookie: P1.cookie })).status === 403);
  const po = await api(`pools/${A}/payout`, { cookie: ADM.cookie });
  const chainA = await poolAcc(A);
  const bound = prizeBound({ priceLamports: PRICE_A, ticketsSold: 3, sponsored: 0, prizeBps: 7000, seedBps: 2000 });
  const want = poolPayouts(bound, [P1.wallet, P2.wallet]);
  check('ranking: P1 (2 rides) first, P2 second; amounts = the payout table', po.ok && po.j.ranks.map(r => r.wallet).join() === [P1.wallet, P2.wallet].join() && po.j.transactions.map(t => t.lamports).join() === want.map(w => w.lamports).join() && po.j.prizeLamports === bound, JSON.stringify(po.j.ranks ?? po.j).slice(0, 300));
  check('…no close_pool offered while ranks are unpaid', po.j.close === null);
  let paidTotal = 0;
  for (const t of po.j.transactions ?? []) {
    const b0 = await bal(t.to), sig = await sendSigned(signedB64(t.transaction, admin)); await settle(sig, ADM.cookie);
    check(`pay_prize rank ${t.rank}: the winner got exactly ${t.lamports} lamports`, (await bal(t.to)) - b0 === t.lamports, `${(await bal(t.to)) - b0}`);
    paidTotal += t.lamports;
  }
  const po2 = await api(`pools/${A}/payout`, { cookie: ADM.cookie });
  check('every rank paid → close_pool offered', po2.j.close && po2.j.transactions.length === 0 && po2.j.ranks.every(r => r.paid));
  const vaultBefore = await bal(vA), paidOnChain = (await poolAcc(A)).prizesPaid;
  const legs = closeSplit({ priceLamports: PRICE_A, ticketsSold: chainA.ticketsSold, sponsored: chainA.sponsored, prizeBps: 7000, seedBps: 2000, platformFeeBps: 500, prizesPaid: paidOnChain, vaultLamports: vaultBefore, cancelled: false });
  before = await bals({ fee: addr('fee'), plat: addr('plat'), seed: addr('seed'), admin: addr('admin') });
  const sigC = await sendSigned(signedB64(po2.j.close.transaction, admin)); await settle(sigC, ADM.cookie);
  after = await bals({ fee: addr('fee'), plat: addr('plat'), seed: addr('seed'), admin: addr('admin') });
  check('prizes on chain = what was paid', paidOnChain === paidTotal, `${paidOnChain} vs ${paidTotal}`);
  check('close_pool: fee treasury exact', after.fee - before.fee === legs.fee, `${after.fee - before.fee} vs ${legs.fee}`);
  check('close_pool: platform treasury exact (500 bps of the fee share)', after.plat - before.plat === legs.platformFee && legs.platformFee > 0, `${after.plat - before.plat} vs ${legs.platformFee}`);
  check('close_pool: seed treasury = seed share + unclaimed prize', after.seed - before.seed === legs.seed && legs.unclaimed === bound - paidTotal, `${after.seed - before.seed} vs ${legs.seed} (unclaimed ${legs.unclaimed})`);
  check('close_pool: creator +rent minimum − the close fee', after.admin - before.admin === VAULT_RENT_MIN_LAMPORTS - (await fee(sigC)), `${after.admin - before.admin}`);
  check('vault A = 0, pool settled on chain', (await bal(vA)) === 0 && (await poolAcc(A)).status === 3);
  check('server: pool A settled', await until(async () => (await serverPool(A)).status === 'settled'), (await serverPool(A)).status);
  check('conservation: everything that entered vault A left it (tickets = prizes + legs)', 3 * PRICE_A === paidTotal + legs.fee + legs.platformFee + legs.seed, `${3 * PRICE_A} vs ${paidTotal + legs.fee + legs.platformFee + legs.seed}`);

  const noise = p => !/favicon|status of 409|status of 404/.test(p);
  const probs = browsers.flatMap(h => h.filt().filter(noise));
  check('no page errors (lobby + game, 3 browsers)', probs.length === 0, probs.slice(0, 5).join(' | '));
  console.log(`screenshots: ${browsers[0]?.SHOTS}`);
} catch (e) {
  check('scenario threw', false, e?.stack ?? String(e));
}
console.log(fails.length ? `\n✗ ${fails.length} failed: ${fails.join(' · ')}` : '\n✓ all money flows verified on the local chain');
const code = fails.length ? 1 : 0;
for (const h of browsers) h.finish(code, 300);
if (!browsers.length) process.exit(code);
