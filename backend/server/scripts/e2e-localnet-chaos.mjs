// CHAOS on the local chain: the server's view of the chain is made flaky (scripts/localnet-fault-proxy.mjs) and several servers / crankers work on the same pools
// at once. Started by .claude/skills/localnet-e2e/run.sh (SCENARIO=chaos); the scenario itself talks to the validator DIRECTLY (balances, the clock, pool-admin), only
// the servers it spawns here (S1, S2 – same database, own proxies) and the crank CLIs see the faults. Every assertion is money or a mirror, never a log line.
//   T1  one landed purchase confirmed / settled / webhooked on two servers, repeatedly        → credited once
//   T2  S1 blind (getSignaturesForAddress refused), S2's websocket dead                       → S2's polling alone credits a purchase nobody told it about
//   T3  nobody is watching, then S2 restarts                                                  → the boot poll catches up; the whole provider down (429) for a while → recovers
//   T4  (was: gasless /submit through a flaky send path – the gas sponsor and its route are gone: every wallet signs AND sends its own transaction)
//   T5  the crank's send path swallows 2 sends AND getProgramAccounts is refused              → the re-send loop still lands each step once; one pool's failure must not stop the others; the fallback RPC finishes the refunds
//   T6  three crankers + a stranger refunding at once on a 10-ticket pool                      → every buyer refunded exactly once (a step that lost the race is retried by the next pass), the crank key paid only fees, pool closed once
// env: RPC, KEYS (scratch keypairs), WEBHOOK_SECRET + the server env run.sh exported (DATABASE_URL, PAYMENT_MODE, …).
import nacl from 'tweetnacl'; import bs58 from 'bs58'; import { readFileSync, writeFileSync, openSync } from 'node:fs'; import { execFile, execFileSync, spawn } from 'node:child_process'; import { dirname } from 'node:path';
import net from 'node:net';
import { Connection, Keypair, PublicKey, SYSVAR_CLOCK_PUBKEY, Transaction } from '@solana/web3.js';
import { PoolProgramCodec } from '../dist/infrastructure/solana/pool-program.codec.js';
import { POOL_PROGRAM_IDL } from '../dist/infrastructure/solana/pool-program.idl.js';
import { startFaultProxy } from './localnet-fault-proxy.mjs';
import { sealRoad } from './localnet-seal.mjs';

const { RPC, KEYS, WEBHOOK_SECRET } = process.env;
if (!RPC || !KEYS) { console.error('run it through .claude/skills/localnet-e2e/run.sh (SCENARIO=chaos)'); process.exit(2); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
const T0 = Date.now(), fails = [];
const check = (n, ok, x = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} [${((Date.now() - T0) / 1000).toFixed(0)} s] ${n}${x ? ' – ' + x : ''}`); if (!ok) fails.push(n); return ok; };
const note = t => console.log(`NOTE ${t}`);
const until = async (fn, ms = 30000, step = 500) => { for (let i = 0; i <= ms / step; i++) { const v = await fn(); if (v) return v; await sleep(step); } return false; };
const conn = new Connection(RPC, 'confirmed');
const codec = new PoolProgramCodec(POOL_PROGRAM_IDL.address);
const key = name => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(`${KEYS}/${name}.json`, 'utf8'))));
const addr = name => key(name).publicKey.toBase58();
const bal = a => conn.getBalance(new PublicKey(a), 'confirmed');
const chainNow = async () => Number((await conn.getAccountInfo(SYSVAR_CLOCK_PUBKEY, 'confirmed')).data.readBigInt64LE(32));
const untilChain = async (ts, what) => { const left = ts - (await chainNow()); if (left > 0) console.log(`     … waiting ${left} s for ${what} (chain clock)`); while ((await chainNow()) < ts + 2) await sleep(1000); };
const account = async (name, a) => { const i = await conn.getAccountInfo(a, 'confirmed'); return i ? codec.decodeAccount(name, i.data) : null; };
const poolAcc = id => account('Pool', codec.poolPda(id));
const ticketRent = await conn.getMinimumBalanceForRentExemption(8 + 79);
const RENT0 = await conn.getMinimumBalanceForRentExemption(0);
const fee = async sig => (await conn.getTransaction(sig, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 })).meta.fee;
const admintool = args => JSON.parse(execFileSync('node', ['scripts/pool-admin.mjs', ...args, '--url', RPC], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim().split('\n').pop());
const admintoolAsync = args => new Promise((res, rej) => execFile('node', ['scripts/pool-admin.mjs', ...args, '--url', RPC], { encoding: 'utf8' }, (e, out) => e ? rej(e) : res(JSON.parse(out.trim().split('\n').pop()))));
const tmp = dirname(KEYS);

// ── the faulty views: S1 ← P1, S2 ← P2, the crank CLIs ← PC (each its own rules)
const P1 = await startFaultProxy({ target: RPC }), P2 = await startFaultProxy({ target: RPC }), PC = await startFaultProxy({ target: RPC });
const freePort = () => new Promise(r => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const JWT = Buffer.from(nacl.randomBytes(24)).toString('base64url');
const servers = [];
async function spawnServer(name, { rpc, ws }) {
  const port = await freePort(), log = openSync(`${tmp}/chaos-${name}.log`, 'a');
  const child = spawn('node', ['dist/main.js'], { stdio: ['ignore', log, log], env: { ...process.env, PORT: String(port), SOLANA_RPC: rpc, SOLANA_WS: ws, SOLANA_RPC_FALLBACKS: '', WATCH_INTERVAL_MS: '2000', CRANK_INTERVAL_MS: '0', JWT_SECRET: JWT } });
  const s = { name, base: `http://127.0.0.1:${port}`, child, kill: () => new Promise(r => { child.once('exit', r); child.kill(); }) };
  servers.push(s);
  if (!(await until(async () => (await fetch(`${s.base}/api/health/live`).catch(() => null))?.ok, 40000, 300))) throw new Error(`server ${name} did not start (see ${tmp}/chaos-${name}.log)`);
  return s;
}
const api = async (s, path, { body, cookie, method, headers } = {}) => {
  const r = await fetch(`${s.base}/api/${path}`, { method: method ?? (body ? 'POST' : 'GET'), headers: { 'content-type': 'application/json', ...(cookie && { cookie }), ...headers }, body: body ? JSON.stringify(body) : undefined }).catch(e => ({ status: 0, ok: false, json: async () => ({ code: 'fetch_failed', detail: String(e) }) }));
  return { status: r.status, ok: r.ok, j: await r.json().catch(() => ({})) };
};
const signIn = async (s, kp) => {
  const wallet = kp.publicKey.toBase58(), { j } = await api(s, 'auth/nonce', { body: { wallet } });
  const r = await fetch(`${s.base}/api/auth/verify`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ wallet, signature: bs58.encode(nacl.sign.detached(new TextEncoder().encode(j.message), kp.secretKey)) }) });
  if (!r.ok) throw new Error(`sign-in failed: ${r.status}`);
  const cookie = r.headers.get('set-cookie').split(';')[0];
  const offer = await api(s, 'profile/agreements', { body: { age18: true, loss: true }, cookie, method: 'PUT' });   // paid play (tickets) needs the 18+ and loss offer
  if (!offer.ok) throw new Error(`agreements failed: ${offer.status}`);
  return cookie;
};
async function player(on, lamports = 3e9) {
  const kp = Keypair.generate(), wallet = kp.publicKey.toBase58();
  await conn.confirmTransaction(await conn.requestAirdrop(kp.publicKey, lamports), 'confirmed');
  const keyfile = `${KEYS}/chaos-${wallet.slice(0, 8)}.json`; writeFileSync(keyfile, JSON.stringify([...kp.secretKey]));
  const cookies = {}; for (const s of on) cookies[s.name] = await signIn(s, kp);
  return { kp, wallet, keyfile, cookies };
}
const signedB64 = (b64, kp) => { const tx = Transaction.from(Buffer.from(b64, 'base64')); tx.partialSign(kp); return tx; };
const sendDirect = async tx => {   // straight to the validator (the scenario's own view), re-sent until confirmed
  const raw = tx.serialize(), sig = await conn.sendRawTransaction(raw);
  for (let i = 0; i < 40; i++) { const st = (await conn.getSignatureStatuses([sig])).value[0]; if (st?.err) throw new Error(`failed ${JSON.stringify(st.err)}`); if (st?.confirmationStatus === 'confirmed' || st?.confirmationStatus === 'finalized') return sig; await sleep(1000); await conn.sendRawTransaction(raw, { skipPreflight: true }).catch(() => undefined); }
  throw new Error('not confirmed');
};
/** a self-paid purchase signed and sent DIRECTLY to the chain – nobody tells a server about it (no /confirm) */
async function landSelfPaid(s, p, poolId, qty = 1) {
  const o = await api(s, 'tickets', { body: { poolId, qty, burnWarningAccepted: true }, cookie: p.cookies[s.name] });
  const pay = await api(s, `tickets/orders/${o.j.id}/payment?selfPaid=1`, { cookie: p.cookies[s.name] });
  return { orderId: o.j.id, sig: await sendDirect(signedB64(pay.j.transaction, p.kp)) };
}
const serverPool = async (s, id) => (await api(s, `pools/${id}`)).j;
const held = async (s, p, poolId) => ((await api(s, 'me', { cookie: p.cookies[s.name] })).j.tickets ?? []).find(t => t.poolId === poolId)?.balance ?? 0;
const orderStatus = async (s, p, id) => (await api(s, `tickets/orders/${id}`, { cookie: p.cookies[s.name] })).j.status;
const webhook = (s, sigs) => api(s, 'chain/webhook', { body: { signatures: sigs }, headers: { 'x-webhook-secret': WEBHOOK_SECRET } });
const cranker = (extraEnv = {}) => new Promise(res => execFile('node', ['dist/cli/index.js', 'pool:crank'], { env: { ...process.env, SOLANA_RPC: PC.url, SOLANA_RPC_FALLBACKS: '', ...extraEnv }, encoding: 'utf8' }, (err, out, errout) => {
  let json = null; try { json = JSON.parse(out); } catch { /* no JSON: the pass threw */ }
  res({ ok: !err && !!json, actions: json?.actions ?? [], stderr: String(errout).split('\n').filter(Boolean).slice(-2).join(' | ') });
}));
const stepsOf = (pass, id) => pass.actions.filter(a => a.poolId === id).map(a => `${a.step}${a.error ? '✗' : ''}`).join(' ');

try {
  // ── 0. two servers on one database (S2's websocket is dead on purpose), the treasuries, the pools
  const S1 = await spawnServer('s1', { rpc: P1.url, ws: process.env.SOLANA_WS || 'ws://127.0.0.1:1' });
  const S2 = await spawnServer('s2', { rpc: P2.url, ws: 'ws://127.0.0.1:1' });
  check('two servers on one database, each behind its own faulty RPC proxy', (await api(S1, 'tiers')).j.paymentMode === 'program' && (await api(S2, 'tiers')).j.paymentMode === 'program');
  note('draining the baked / left-over pools first (a direct crank pass) so this scenario meets only its own pools');
  execFileSync('node', ['dist/cli/index.js', 'pool:crank'], { stdio: 'ignore' });
  const treas = ['--fee-treasury', addr('fee'), '--seed-treasury', addr('seed'), '-k', `${KEYS}/admin.json`];
  const PRICE = 40_000_000;
  const mk = (min, prep, perWallet = 4) => admintool(['create-pool', '--tier', '8h', '--price', String(PRICE), '--min', String(min), '--max', '0', '--per-wallet', String(perWallet), '--prep', `+${prep}`, '--play', `+${prep + 60}`, '--split', '7000/2000/1000', ...treas]).poolId;
  const X = mk(1000, 900), Y = mk(5, 125), W = mk(5, 125), Z = mk(50, 235, 2);   // X stays open for the purchase tests; Y + W fail first (W has no tickets, id after Y); Z = the race
  // v4 (L4): every road sealed (the crank would do it first otherwise – its first steps here must be the ones under test), then registered
  for (const id of [X, Y, W, Z]) { await sealRoad({ conn, codec, admintool, id, keyfile: `${KEYS}/admin.json` }); execFileSync('node', ['dist/cli/index.js', 'pool:register', String(id), '--label', `CHAOS ${id}`], { stdio: 'ignore' }); }
  check('pools X (purchases), Y + W (a crank pass with a refused read), Z (the race) created', [X, Y, W, Z].every((id, i, a) => i === 0 || id === a[i - 1] + 1), `${X} ${Y} ${W} ${Z}`);
  const [P1w, P5w, P6w] = [await player([S1, S2]), await player([S1, S2]), await player([S1, S2])];
  const buy = (p, pool) => admintoolAsync(['buy', '--pool', String(pool), '--qty', '1', '-k', p.keyfile]);   // pool-admin: the buyer pays its own fee + rent
  const [y1, y2, ys] = [await player([S1]), await player([S1]), await player([S1])];
  await Promise.all([buy(y1, Y), buy(y2, Y)]);
  const SPONSOR_Y = 15_000_000;
  await admintoolAsync(['sponsor', '--pool', String(Y), '--lamports', String(SPONSOR_Y), '-k', ys.keyfile]);   // v4 (M8): a failed pool owes its sponsor too
  const ysRent = await conn.getMinimumBalanceForRentExemption((await conn.getAccountInfo(codec.sponsorReceiptPda(Y, ys.wallet), 'confirmed')).data.length);
  const zs = []; for (let i = 0; i < 10; i++) zs.push(await player([S1]));
  const strangerW = await player([S1]);
  await Promise.all(zs.map(p => buy(p, Z)));
  check('Y holds 2 tickets, W none, Z 10 – all on chain', (await poolAcc(Y)).ticketsSold === 2 && (await poolAcc(W)).ticketsSold === 0 && (await poolAcc(Z)).ticketsSold === 10);

  // ── T1. one landed purchase, told to two servers over every path, repeatedly
  let before = await bal(P1w.wallet);
  const l1 = await landSelfPaid(S1, P1w, X);
  const settleOn = async s => (await api(s, 'chain/settle', { body: { signature: l1.sig }, cookie: P1w.cookies[s.name] })).j.status;
  const paths = await Promise.all([api(S1, `tickets/orders/${l1.orderId}/confirm`, { body: { signature: l1.sig }, cookie: P1w.cookies.s1 }), settleOn(S1), settleOn(S2), webhook(S1, [l1.sig]), webhook(S2, [l1.sig]), api(S1, `tickets/orders/${l1.orderId}/confirm`, { body: { signature: l1.sig }, cookie: P1w.cookies.s1 })]);
  await sleep(4000);   // both watchers poll it as well
  check('T1 confirm ×2 + settle on both servers + the webhook on both + both watchers, at once: 1 ticket, 1 sold (never doubled)', await held(S1, P1w, X) === 1 && (await serverPool(S2, X)).sold === 1 && (await poolAcc(X)).ticketsSold === 1, `${paths.map(p => (typeof p === 'string' ? p : p.status)).join(',')}`);
  check('…the order is paid once and the buyer paid price + fee + rent exactly', await orderStatus(S2, P1w, l1.orderId) === 'paid' && before - (await bal(P1w.wallet)) === PRICE + (await fee(l1.sig)) + ticketRent);

  // ── T2. S1 blind, S2's websocket dead: the polling of S2 alone must find a purchase nobody announced
  const blind = P1.fault({ method: 'getSignaturesForAddress', mode: 'error' });
  await landSelfPaid(S2, P5w, X);
  const seen = await until(async () => await held(S2, P5w, X) === 1, 25000, 1000);
  await sleep(3000);   // a full poll interval of S1 – it must have run into the refusal, so only S2 can have credited the purchase
  check('T2 S1 blind (its polls refused) + S2 without a websocket: S2\'s polling credits a purchase nobody confirmed, no API call', seen && blind.hits > 0 && (await serverPool(S2, X)).sold === 2, `held ${await held(S2, P5w, X)}, S1 refused ${blind.hits} polls`);

  // ── T3. nobody watching → a restart catches up; then the whole provider down
  await S2.kill(); servers.splice(servers.indexOf(S2), 1);
  await landSelfPaid(S1, P6w, X);
  await sleep(7000);
  check('T3 control: with S2 down and S1 blind the purchase stays uncredited', await held(S1, P6w, X) === 0 && (await poolAcc(X)).ticketsSold === 3);
  const S2b = await spawnServer('s2', { rpc: P2.url, ws: 'ws://127.0.0.1:1' });
  check('T3 S2 restarted: its boot poll credits the purchase made while nobody watched, no API call', await until(async () => (await serverPool(S2b, X)).sold === 3, 25000, 1000) && await held(S2b, P6w, X) === 1);
  blind.off();
  const outA = P1.fault({ method: '*', mode: 'http', status: 429 }), outB = P2.fault({ method: '*', mode: 'http', status: 429 });
  const wl = await player([S1, S2b]); const l7a = await landSelfPaid(S2b, wl, X).catch(e => ({ err: e }));   // building the order needs the RPC: it may be refused
  const healthDuring = (await api(S1, 'tiers')).status;
  outA.off(); outB.off();
  note(`T3 provider outage: order building during it ${l7a.err ? 'refused (as it should)' : 'went through'}, /api/tiers answered ${healthDuring}`);
  const l7 = l7a.err ? await landSelfPaid(S2b, wl, X) : l7a;
  check('T3 after a total provider outage (every RPC call 429) both servers are alive and a purchase is credited', (await api(S1, 'tiers')).ok && await until(async () => await held(S2b, wl, X) === 1, 25000, 1000), `held ${await held(S2b, wl, X)} sig ${l7.sig?.slice(0, 8)}`);
  check('…the pool counts every ticket exactly once: 4 sold on chain and in the mirror', (await poolAcc(X)).ticketsSold === 4 && (await serverPool(S1, X)).sold === 4);

  // ── T5. getProgramAccounts refused: pool Y needs refunds (a read of its tickets), pool W (after it) only fail_pool + close_pool
  await untilChain(Number((await poolAcc(Y)).prepDeadline.getTime() / 1000), 'pool Y / W prep deadline');
  const gpa = PC.fault({ method: 'getProgramAccounts', mode: 'error' });
  const swallow = PC.fault({ method: 'sendTransaction', mode: 'blackhole', times: 2 });   // the crank's first two sends are "accepted" and never forwarded
  const yb = { y1: await bal(y1.wallet), y2: await bal(y2.wallet), ys: await bal(ys.wallet) };
  const pass5 = await cranker();
  note(`T5 crank pass with getProgramAccounts refused: ${pass5.ok ? pass5.actions.filter(a => [Y, W].includes(a.poolId)).map(a => `${a.step}#${a.poolId}${a.error ? ' ✗ ' + a.error.slice(0, 60) : ''}`).join(', ') : 'the pass THREW – ' + pass5.stderr}`);
  check('T5 the pass survives the refused read (it does not throw) and reports pool Y\'s refund as failed', pass5.ok && stepsOf(pass5, Y).includes('refund✗'), stepsOf(pass5, Y) || pass5.stderr);
  check('T5 …and the pools after Y are still served: W failed + closed in the same pass', stepsOf(pass5, W) === 'fail_pool close_pool' && (await poolAcc(W)).status === 4, stepsOf(pass5, W));
  check('T5 the first two sends were swallowed (the crank was told "accepted"): its re-send loop still landed each step, exactly once', swallow.hits === 2 && (await poolAcc(Y)).status !== 0 && (await poolAcc(W)).status === 4, `swallowed ${swallow.hits}`);
  swallow.off();
  check('T5 pool Y is left refunding (failed, nothing refunded, nothing closed)', (await poolAcc(Y)).status === 2 && (await poolAcc(Y)).refunded === 0);
  const pass5b = await cranker({ SOLANA_RPC_FALLBACKS: RPC });
  check('T5 primary refuses getProgramAccounts but a fallback RPC answers: the next pass refunds both tickets, the sponsor (v4, M8) and closes Y', pass5b.ok && stepsOf(pass5b, Y) === 'refund refund_sponsor close_pool' && (await poolAcc(Y)).status === 4, stepsOf(pass5b, Y) || pass5b.stderr);
  check('T5 …each buyer got the price + its own Ticket rent back, the sponsor its sponsorship + its receipt\'s rent, exactly (the crank paid the fees)', (await bal(y1.wallet)) - yb.y1 === PRICE + ticketRent && (await bal(y2.wallet)) - yb.y2 === PRICE + ticketRent
    && (await bal(ys.wallet)) - yb.ys === SPONSOR_Y + ysRent, `${(await bal(ys.wallet)) - yb.ys} vs ${SPONSOR_Y + ysRent}`);
  gpa.off();

  // ── T6. the race: Z has 10 tickets (two refund batches of 8). Three crank CLIs + a stranger's refund at once.
  await untilChain(Number((await poolAcc(Z)).prepDeadline.getTime() / 1000), 'pool Z prep deadline');
  const zb = await Promise.all(zs.map(p => bal(p.wallet))), crank0 = await bal(addr('crank')), admin0 = await bal(addr('admin')), seed0 = await bal(addr('seed'));
  // the stranger fails the pool first (permissionless, so the crankers would otherwise all lose that very first step to it): the race is then over the refund batches
  const failedBy = await admintoolAsync(['fail-pool', '--pool', String(Z), '-k', strangerW.keyfile]);
  check('T6 a stranger\'s fail_pool puts Z into refunding (anyone may)', (await poolAcc(Z)).status === 2 && !!failedBy.signature);
  const stranger = admintoolAsync(['refund', '--pool', String(Z), '--buyer', zs[1].wallet, '-k', strangerW.keyfile]).catch(e => ({ refused: String(e.stderr ?? e).slice(0, 80) }));   // a wallet that bought nothing: its own fees are not the buyers'
  const passes = await Promise.all([cranker(), cranker({ SOLANA_RPC: P2.url }), cranker({ SOLANA_RPC: RPC }), stranger]);
  const crankPasses = passes.slice(0, 3);
  note(`T6 the three crankers: ${crankPasses.map(p => p.ok ? p.actions.map(a => `${a.step}${a.error ? '✗' : ''}`).join(' ') : 'threw: ' + p.stderr).join('  |  ')}; the stranger's refund of one buyer: ${passes[3].refused ? 'refused (' + passes[3].refused + ')' : 'landed'}`);
  check('T6 every cranker finished its pass without throwing', crankPasses.every(p => p.ok));
  let follow = 0;   // a step that lost a race is reported and retried by the NEXT pass – never left undone
  for (; follow < 4; follow++) { const p = await cranker({ SOLANA_RPC: RPC }); if (!p.ok || !p.actions.some(a => a.poolId === Z)) break; }
  note(`T6 follow-up passes until Z had nothing left: ${follow}`);
  const zp = await poolAcc(Z);
  check('T6 pool Z ends closed (cancelled) on chain, vault empty', zp.status === 4 && (await bal(codec.vaultPda(Z))) === 0, JSON.stringify({ status: zp.status }));
  const za = await Promise.all(zs.map(p => bal(p.wallet)));
  check('T6 every one of the 10 buyers was refunded EXACTLY once: +price +its own Ticket rent', za.every((a, i) => a - zb[i] === PRICE + ticketRent), za.map((a, i) => a - zb[i]).join(','));
  const sigs = await conn.getSignaturesForAddress(codec.poolPda(Z), { limit: 200 }, 'confirmed'); let crankFees = 0, failedByCrank = 0;
  for (const s of sigs) { const t = await conn.getTransaction(s.signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 }); if (t && t.transaction.message.staticAccountKeys[0].toBase58() === addr('crank')) { crankFees += t.meta.fee; if (t.meta.err) failedByCrank++; } }   // a transaction that LANDED but failed (a batch that lost the race) still pays its fee
  check('T6 the crank key paid only fees – of every transaction that landed, the ones that lost the race included (no lamport lost or doubled)', crank0 - (await bal(addr('crank'))) === crankFees && crankFees > 0, `${crank0 - (await bal(addr('crank')))} vs ${crankFees} (${failedByCrank} landed failed)`);
  check('T6 the creator got the vault rent minimum once, the seed nothing', (await bal(addr('admin'))) - admin0 === RENT0 && (await bal(addr('seed'))) === seed0, `${(await bal(addr('admin'))) - admin0}`);
  check('T6 the server mirror agrees on both servers: cancelled', await until(async () => (await serverPool(S1, Z)).status === 'cancelled' && (await serverPool(S2b, Z)).status === 'cancelled', 30000, 1000));
  const after6 = await cranker({ SOLANA_RPC: RPC });
  check('T6 …and then a pass has nothing to do for Z', after6.ok && after6.actions.filter(a => a.poolId === Z).length === 0 && follow < 4);
  const refundedFlags = (await Promise.all(zs.map(async p => (await api(S1, 'me', { cookie: p.cookies.s1 })).j.tickets?.find(t => t.poolId === Z)))).map(t => t?.balance ?? 0);
  check('T6 no rider still holds a usable ticket of Z', refundedFlags.every(b => b === 0), refundedFlags.join(','));
  note(`proxy views – S1: ${JSON.stringify(P1.stats().injected)}  S2: ${JSON.stringify(P2.stats().injected)}  crank: ${JSON.stringify(PC.stats().injected)}`);
} catch (e) {
  check('the chaos scenario ran to the end', false, String(e?.stack ?? e).split('\n').slice(0, 4).join(' | '));
} finally {
  for (const s of servers) s.child.kill();
  await Promise.all([P1.close(), P2.close(), PC.close()]);
}
console.log(fails.length ? `\n✗ ${fails.length} check(s) failed:\n  - ${fails.join('\n  - ')}\n(server logs: ${tmp}/chaos-s1.log, chaos-s2.log)` : '\n✓ the chain misbehaved and every lamport and ticket still came out exactly once');
process.exit(fails.length ? 1 : 0);
