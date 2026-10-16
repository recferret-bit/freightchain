// HONK on a local validator, through program GctCYSHbCnHN8sE1LjUL9cmSpFd5mcVdfaumRcaVWZZx. SCENARIO=chain | session | all.
// RPC, KEYS (payer.json, player.json, spectator.json). Session also needs BASE, DATABASE_URL, CHROME_PORT. The server mints no second NFT.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, createTransferInstruction, getAssociatedTokenAddressSync, getOrCreateAssociatedTokenAccount } from '@solana/spl-token';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { PrismaClient } from '@prisma/client';
import { launch, sleep } from '../../client/tools/cdp.mjs';
import { burn, buyPart, honkBalance, initialize, mintRide, mintState, pdas, poolLamports, releaseLp, swapHonkForSol, swapSolForHonk, tokenAccount, vaultBalance } from './honk-program.mjs';

const RPC = process.env.RPC;
const KEYS = process.env.KEYS;
const BASE = process.env.BASE;
const SCENARIO = process.env.SCENARIO || 'all';
const UNIT = 1_000_000n;
const GENESIS = 2_000_000n * UNIT;
const SERVER = fileURLToPath(new URL('..', import.meta.url));
const fails = [];
const show = (v) => JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? x.toString() : x));
const check = (name, ok, extra = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' – ' + extra : ''}`); if (!ok) fails.push(name); };

function load(name) {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(join(KEYS, `${name}.json`), 'utf8'))));
}

function walletOf(kp) {
  const naclKp = nacl.sign.keyPair.fromSeed(kp.secretKey.slice(0, 32));
  const address = bs58.encode(naclKp.publicKey);
  if (address !== kp.publicKey.toBase58()) throw new Error('nacl seed does not match the solana pubkey');
  return { kp, naclKp, address };
}

async function txErrorText(e) {
  let logs = e?.logs;
  if (!logs && typeof e?.getLogs === 'function') { try { logs = await e.getLogs(); } catch { logs = []; } }
  return `${e?.message || e}\n${(logs || []).join('\n')}`;
}

// Classic SPL. buy_part freezes the buyer's account, so a transfer must fail even though the mint is not Token-2022.
async function frozenTransferRefused({ payer, mint, owner, dest }) {
  const connection = new Connection(RPC, 'confirmed');
  const mintPk = new PublicKey(mint);
  const src = getAssociatedTokenAddressSync(mintPk, owner.publicKey, false, TOKEN_PROGRAM_ID);
  await getOrCreateAssociatedTokenAccount(connection, payer, mintPk, dest.publicKey, false, 'confirmed', { commitment: 'confirmed' }, TOKEN_PROGRAM_ID);
  const dst = getAssociatedTokenAddressSync(mintPk, dest.publicKey, false, TOKEN_PROGRAM_ID);
  const tx = new Transaction().add(createTransferInstruction(src, dst, owner.publicKey, 1n, [], TOKEN_PROGRAM_ID));
  try {
    await sendAndConfirmTransaction(connection, tx, [payer, owner], { commitment: 'confirmed' });
    return 'transfer landed';
  } catch (e) {
    const text = await txErrorText(e);
    return /frozen|0x11/i.test(text) ? '' : text.slice(0, 400);
  }
}

const outFor = (honkReserve, solReserve, solIn) => (honkReserve * solIn) / (solReserve + solIn);
const solFor = (honkReserve, solReserve, honkIn) => (solReserve * honkIn) / (honkReserve + honkIn);

async function chain() {
  const payer = load('payer');
  const player = load('player');
  const spectator = load('spectator');
  const ids = pdas();
  writeFileSync(join(KEYS, 'mint-address.txt'), `${ids.honkMint.toBase58()}\n`);
  const SOL = 1_000_000_000n;
  const opened = 10n * SOL;
  await initialize({ rpc: RPC, payer, solIn: opened });
  const minted = await mintState({ rpc: RPC });
  const vault0 = await vaultBalance({ rpc: RPC });
  const lamports = await poolLamports({ rpc: RPC });
  check('genesis supply', minted.supply === GENESIS, String(minted.supply));
  check('genesis vault', vault0 === GENESIS, String(vault0));
  check('mint authority', minted.mintAuthority === ids.authority.toBase58(), minted.mintAuthority || '');
  check('mint not freezable', minted.freezeAuthority === null, minted.freezeAuthority || '');
  check('pool sol', lamports >= Number(opened), String(lamports));
  const rideId = Buffer.alloc(16, 7);
  const vaultBeforeRide = await vaultBalance({ rpc: RPC });
  const supplyBeforeRide = minted.supply;
  await mintRide({ rpc: RPC, emitter: payer, rider: player.publicKey, rideId, amount: 100n * UNIT });
  const afterRide = await honkBalance({ rpc: RPC, owner: player.publicKey });
  const supplyAfterRide = (await mintState({ rpc: RPC })).supply;
  check('ride mint', afterRide === 100n * UNIT && supplyAfterRide === supplyBeforeRide + 100n * UNIT, `${afterRide} supply ${supplyAfterRide}`);
  check('ride mint leaves the vault', (await vaultBalance({ rpc: RPC })) === vaultBeforeRide, String(vaultBeforeRide));
  let replay = '';
  try { await mintRide({ rpc: RPC, emitter: payer, rider: player.publicKey, rideId, amount: 100n * UNIT }); replay = 'minted twice'; } catch (e) { replay = ''; }
  check('ride mint once', replay === '', replay);
  const playerIn = SOL;
  const playerOut = outFor(GENESIS, opened, playerIn);
  await swapSolForHonk({ rpc: RPC, user: player, solIn: playerIn, minOut: playerOut });
  const playerBal = await honkBalance({ rpc: RPC, owner: player.publicKey });
  const vault1 = await vaultBalance({ rpc: RPC });
  check('swap player', playerBal === playerOut + 100n * UNIT, `${playerBal} vs ${playerOut}`);
  check('swap vault', vault0 - vault1 === playerOut, `${vault0} -> ${vault1}`);
  const specIn = SOL / 10n;
  const specOut = outFor(GENESIS - playerOut, opened + playerIn, specIn);
  await swapSolForHonk({ rpc: RPC, user: spectator, solIn: specIn, minOut: specOut });
  const specBal = await honkBalance({ rpc: RPC, owner: spectator.publicKey });
  const vault2 = await vaultBalance({ rpc: RPC });
  check('swap spectator', specBal === specOut, `${specBal} vs ${specOut}`);
  check('swap spectator vault', vault1 - vault2 === specOut, `${vault1} -> ${vault2}`);
  await burn({ rpc: RPC, user: player, amount: 100n * UNIT });
  const burnedBal = await honkBalance({ rpc: RPC, owner: player.publicKey });
  const supplyAfter = await mintState({ rpc: RPC });
  const vault3 = await vaultBalance({ rpc: RPC });
  check('burn player', burnedBal === playerBal - 100n * UNIT, String(burnedBal));
  check('burn supply', supplyAfter.supply === GENESIS, String(supplyAfter.supply));
  check('burn vault', vault3 === vault2, `${vault2} -> ${vault3}`);
  const sellIn = UNIT;
  const honkReserve = GENESIS - playerOut - specOut;
  const solReserve = opened + playerIn + specIn;
  const solOut = solFor(honkReserve, solReserve, sellIn);
  const lamportsBeforeSell = await poolLamports({ rpc: RPC });
  let slipped = '';
  try { await swapHonkForSol({ rpc: RPC, user: player, honkIn: sellIn, minSolOut: solOut + 1n }); slipped = 'sell landed'; } catch (e) { slipped = await txErrorText(e); }
  check('sell under min is slippage', /Slippage|6004|0x1774/i.test(slipped), slipped.slice(0, 200));
  await swapHonkForSol({ rpc: RPC, user: player, honkIn: sellIn, minSolOut: solOut });
  const soldBal = await honkBalance({ rpc: RPC, owner: player.publicKey });
  const vaultSold = await vaultBalance({ rpc: RPC });
  check('sell honk back', soldBal === burnedBal - sellIn && vaultSold === vault3 + sellIn, `${burnedBal} -> ${soldBal} vault ${vaultSold}`);
  check('sell pays sol', (await poolLamports({ rpc: RPC })) === lamportsBeforeSell - Number(solOut), String(solOut));
  let early = '';
  try {
    await releaseLp({ rpc: RPC, payer });
    early = 'release landed';
  } catch (e) {
    early = await txErrorText(e);
  }
  check('release too early', /TooEarly|6002|0x1772/i.test(early), early.slice(0, 400));
  const beforePart = await honkBalance({ rpc: RPC, owner: player.publicKey });
  const bought = await buyPart({ rpc: RPC, buyer: player, slot: 'wheel', item: 'gold' });
  const afterPart = await honkBalance({ rpc: RPC, owner: player.publicKey });
  const nft = await mintState({ rpc: RPC, mint: bought.mint });
  const ata = await tokenAccount({ rpc: RPC, mint: bought.mint, owner: player.publicKey });
  check('gold part price', beforePart - afterPart === 260n * UNIT, `${beforePart} -> ${afterPart}`);
  check('gold part mint', nft.supply === 1n && nft.decimals === 0, `${nft.supply} decimals ${nft.decimals}`);
  check('gold part frozen', ata.isFrozen && ata.amount === 1n && ata.owner === player.publicKey.toBase58(), show(ata));
  const refused = await frozenTransferRefused({ payer, mint: bought.mint, owner: player, dest: spectator });
  check('gold part transfer refused', refused === '', refused);
}

const post = async (path, body, cookie) => {
  const r = await fetch(`${BASE}/api/${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(cookie && { cookie }) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let j = {};
  try { j = text ? JSON.parse(text) : {}; } catch { j = { raw: text }; }
  return { r, j };
};
const put = async (path, body, cookie) => {
  const r = await fetch(`${BASE}/api/${path}`, { method: 'PUT', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body) });
  const text = await r.text();
  let j = {};
  try { j = text ? JSON.parse(text) : {}; } catch { j = { raw: text }; }
  return { r, j };
};
const get = async (path, cookie) => {
  const r = await fetch(`${BASE}/api/${path}`, { headers: cookie ? { cookie } : {} });
  return r.json();
};
const whole = (s) => BigInt(String(s).split('.')[0]);

async function signIn(w) {
  const { j } = await post('auth/nonce', { wallet: w.address });
  const signature = bs58.encode(nacl.sign.detached(new TextEncoder().encode(j.message), w.naclKp.secretKey));
  const { r } = await post('auth/verify', { wallet: w.address, signature });
  const cookie = r.headers.get('set-cookie')?.split(';')[0];
  return { ...w, cookie };
}

async function creditHonk(wallet, honk) {
  const prisma = new PrismaClient();
  const amount = BigInt(honk) * UNIT;
  const updatedAt = new Date();
  try {
    await prisma.honkAccount.upsert({
      where: { wallet },
      create: { wallet, balance: amount, minted: 0n, burned: 0n, updatedAt },
      update: { balance: { increment: amount }, updatedAt },
    });
  } finally { await prisma.$disconnect(); }
}

const phantom = (kp, address) => `(() => {
  const SECRET = ${JSON.stringify([...kp.secretKey])}, PUB = ${JSON.stringify(address)}, RPC = ${JSON.stringify(RPC)};
  window.__HONK_RPC = RPC; window.__asked = [];
  const me = () => window.solanaWeb3.Keypair.fromSecretKey(Uint8Array.from(SECRET));
  const pk = { toString: () => PUB, toBase58: () => PUB };
  window.phantom = { solana: { isPhantom: true, publicKey: pk, connect: async () => ({ publicKey: pk }), disconnect: async () => {},
    signAndSendTransaction: async tx => { window.__asked.push('signAndSendTransaction'); tx.partialSign(me());
      let s = ''; for (const b of tx.serialize()) s += String.fromCharCode(b);
      const r = await (await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'sendTransaction', params: [btoa(s), { encoding: 'base64', preflightCommitment: 'confirmed' }] }) })).json();
      if (r.error) throw new Error(r.error.message);
      const sig = r.result;
      for (let i = 0; i < 40; i++) {
        const st = await (await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getSignatureStatuses', params: [[sig], { searchTransactionHistory: true }] }) })).json();
        const row = st.result?.value?.[0];
        if (row?.err) throw new Error(JSON.stringify(row.err));
        if (row && (row.confirmationStatus === 'confirmed' || row.confirmationStatus === 'finalized')) break;
        await new Promise(done => setTimeout(done, 250));
      }
      return { signature: sig }; } } };
})();`;

async function burned(owner, amount, label) {
  const before = await honkBalance({ rpc: RPC, owner: owner.publicKey });
  const signature = await burn({ rpc: RPC, user: owner, amount });
  const after = await honkBalance({ rpc: RPC, owner: owner.publicKey });
  check(label, before - after === amount, `${before} -> ${after}`);
  return signature;
}

async function session() {
  const player = await signIn(walletOf(load('player')));
  const spectator = await signIn(walletOf(load('spectator')));
  const agreedP = await put('profile/agreements', { age18: true, loss: true }, player.cookie);
  const agreedS = await put('profile/agreements', { age18: true, loss: true }, spectator.cookie);
  check('agreements', agreedP.r.ok && agreedS.r.ok, `${agreedP.r.status} ${agreedS.r.status}`);
  await creditHonk(player.address, 65);
  await creditHonk(spectator.address, 51); // 1 chat + 25 snow + 25 clear. Chain HONK already came from the swaps.
  try {
    execFileSync('node', ['dist/cli/index.js', 'pool:seed', '--id', '1', '--tier', '1h', '--status', 'active', '--min', '1'], { cwd: SERVER, env: process.env, stdio: 'pipe' });
  } catch (e) {
    const err = `${e.stderr || e.message}`;
    if (!/exist/i.test(err)) { check('pool seed', false, err.slice(0, 300)); return; }
  }
  const prisma = new PrismaClient();
  try {
    await prisma.rideTicket.upsert({
      where: { wallet_poolId: { wallet: player.address, poolId: 1 } },
      create: { wallet: player.address, poolId: 1, balance: 1, bought: 1 },
      update: { balance: 1, bought: 1 },
    });
  } finally { await prisma.$disconnect(); }
  const created = await post('rides', { tier: '1h' }, player.cookie);
  const ticket = await (async () => { const p = new PrismaClient(); try { return await p.rideTicket.findUnique({ where: { wallet_poolId: { wallet: player.address, poolId: 1 } } }); } finally { await p.$disconnect(); } })();
  check('ticket ride', created.r.ok && created.j.status === 'created' && created.j.poolId === 1 && ticket?.balance === 0, `${created.r.status} ${JSON.stringify(created.j).slice(0, 240)} ticket ${ticket?.balance}`);
  if (!created.j.id) return;
  const rideId = created.j.id;
  const port = +process.env.CHROME_PORT || 9341;
  // Headless Chrome throttles timers in a background tab. The driver's heartbeat is 10s and the sweeper ends the ride at 150s, so the cab never sees clear.
  const chromeArgs = ['--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'];
  const D = await launch({ port, shotsDir: 'fc-honk-shots', args: chromeArgs });
  const S = await launch({ port: port + 1, shotsDir: 'fc-honk-watch', args: chromeArgs });
  const G = await launch({ port: port + 2, shotsDir: 'fc-honk-garage', args: chromeArgs });
  let driving = true;
  try {
    await D.send('Page.addScriptToEvaluateOnNewDocument', { source: phantom(player.kp, player.address) });
    await S.send('Page.addScriptToEvaluateOnNewDocument', { source: phantom(spectator.kp, spectator.address) });
    await G.send('Page.addScriptToEvaluateOnNewDocument', { source: phantom(player.kp, player.address) });
    const [name, value] = player.cookie.split('=');
    await D.send('Network.setCookie', { name, value, url: BASE, httpOnly: true });
    await G.send('Network.setCookie', { name, value, url: BASE, httpOnly: true });
    const [sname, svalue] = spectator.cookie.split('=');
    await S.send('Network.setCookie', { name: sname, value: svalue, url: BASE, httpOnly: true });
    await D.send('Page.navigate', { url: `${BASE}/play.html?ride=${rideId}` });
    for (let i = 0; i < 100 && !(await D.ev('!!window.__game')); i++) await sleep(200);
    await D.ev('document.getElementById("go").click()');
    await sleep(800);
    const running = (await get(`watch/${rideId}`)).ride?.status === 'running';
    check('ride running', running);
    await D.ev('(() => { let last = __game.st.t; setInterval(() => { const g = __game.st; if (g.mode === "drive") g.s += 20 * Math.max(0, g.t - last); last = g.t; }, 50); })()');
    const keys = [['KeyW', 'w'], ['KeyA', 'a'], ['KeyD', 'd']];
    (async () => { for (let i = 0; driving; i++) { const [code, key] = keys[i % 3]; try { await D.send('Input.dispatchKeyEvent', { type: 'keyDown', code, key }); await sleep(80); await D.send('Input.dispatchKeyEvent', { type: 'keyUp', code, key }); await sleep(120); } catch { driving = false; } } })();
    await S.send('Page.navigate', { url: `${BASE}/play.html?watch=${rideId}` });
    const until = async (fn, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await sleep(300); } return false; };
    const click = async (id) => { check(id, await until(() => S.ev(`!!document.getElementById(${JSON.stringify(id)}) && !document.getElementById(${JSON.stringify(id)}).disabled`), 25_000)); await S.ev(`document.getElementById(${JSON.stringify(id)}).click()`); };
    const chainOf = async (owner) => honkBalance({ rpc: RPC, owner: owner.publicKey });
    const beforeHonk = await chainOf(spectator.kp);
    await click('w-honk');
    check('spectator burned 1', await until(async () => (await chainOf(spectator.kp)) === beforeHonk - 1n * UNIT, 25_000), String(await chainOf(spectator.kp)));
    const honkLanded = await until(async () => { const feed = await get(`watch/${rideId}`); return Array.isArray(feed.events) && feed.events.some((e) => e.text === 'HONK'); }, 20_000);
    const feed = await get(`watch/${rideId}`);
    check('honk pays 1', honkLanded, await S.ev('document.getElementById("w-msg")?.textContent ?? ""') + ' ' + JSON.stringify(feed.events || []).slice(0, 180));
    check('honk chat', Array.isArray(feed.events) && feed.events.some((e) => e.text === 'HONK'), JSON.stringify(feed.events || feed).slice(0, 240));
    const posted = Date.now();
    const beforeSnow = await chainOf(spectator.kp);
    await click('w-honk-snow');
    check('spectator burned 25', await until(async () => (await chainOf(spectator.kp)) === beforeSnow - 25n * UNIT, 25_000), String(await chainOf(spectator.kp)));
    const snowLanded = await until(async () => { const feed = await get(`watch/${rideId}`); return Array.isArray(feed.events) && feed.events.some((e) => e.kind === 'honk' && e.effect === 'snow'); }, 20_000);
    const snowFeed = await get(`watch/${rideId}`);
    check('snow pays 25', snowLanded, await S.ev('document.getElementById("w-msg")?.textContent ?? ""'));
    check('snow event', Array.isArray(snowFeed.events) && snowFeed.events.some((e) => e.kind === 'honk' && e.effect === 'snow'));
    check('cab snow', await until(() => D.ev('__game.st.mode === "drive" && __game.weather.snow === 1 && __game.weather.ambient <= -8'), 25_000), await D.ev('JSON.stringify({ mode: __game.st.mode, weather: __game.weather })'));
    const wait = 21_000 - (Date.now() - posted);
    if (wait > 0) await sleep(wait);
    const beforeClear = await chainOf(spectator.kp);
    await click('w-honk-clear');
    check('spectator burned 25 to clear', await until(async () => (await chainOf(spectator.kp)) === beforeClear - 25n * UNIT, 25_000), String(await chainOf(spectator.kp)));
    const clearLanded = await until(async () => { const feed = await get(`watch/${rideId}`); return Array.isArray(feed.events) && feed.events.some((e) => e.kind === 'honk' && e.effect === 'clear'); }, 20_000);
    check('clear effect', clearLanded, await S.ev('document.getElementById("w-msg")?.textContent ?? ""'));
    const donated = await post(`watch/${rideId}/donations`, { effect: 'snow' }, spectator.cookie);
    check('snow is not a donation', donated.r.status === 400, `${donated.r.status} ${JSON.stringify(donated.j).slice(0, 120)}`);
    const cabClear = () => D.ev('__game.weather.snow === 0 && __game.weather.ambient === __game.weather.baseAmbient');
    check('cab clear', await until(cabClear, 45_000) || await cabClear(), await D.ev('JSON.stringify(__game.weather)'));
    const before = await get('honk', player.cookie);
    const fungibleBefore = await chainOf(player.kp);
    await G.send('Page.navigate', { url: `${BASE}/lobby.html#garage` });
    check('garage blue', await until(() => G.ev('!!document.querySelector("[data-slot=truck_color] [data-item=blue]")'), 25_000));
    await G.ev('document.querySelector("[data-slot=truck_color] [data-item=blue]").click()');
    check('garage burn', await until(() => G.ev('!!document.getElementById("garage-burn") && !document.getElementById("garage-burn").disabled'), 15_000));
    await G.ev('document.getElementById("garage-burn").click()');
    check('player burned 65', await until(async () => (await chainOf(player.kp)) === fungibleBefore - 65n * UNIT, 30_000), String(await chainOf(player.kp)));
    let saved = null;
    check('chain mint saved', await until(async () => { const p = new PrismaClient(); try { saved = await p.honkVisual.findFirst({ where: { wallet: player.address, slot: 'truck_color', item: 'blue' } }); } finally { await p.$disconnect(); } return !!saved?.chainMint; }, 20_000), await G.ev('document.getElementById("garage-msg")?.textContent ?? ""'));
    const after = await get('honk', player.cookie);
    check('ledger dropped 65', whole(before.balance) - whole(after.balance) === 65n, `${before.balance} -> ${after.balance}`);
    if (!saved?.chainMint) return;
    const view = await mintState({ rpc: RPC, mint: saved.chainMint });
    const ata = await tokenAccount({ rpc: RPC, mint: saved.chainMint, owner: player.kp.publicKey });
    check('bought part', view.supply === 1n && view.decimals === 0 && ata.isFrozen && ata.amount === 1n && ata.owner === player.address, show({ ...view, frozen: ata.isFrozen, owner: ata.owner }));
    const refused = await frozenTransferRefused({ payer: player.kp, mint: saved.chainMint, owner: player.kp, dest: spectator.kp });
    check('bought transfer refused', refused === '', refused);
  } catch (e) {
    check('session', false, e?.stack || String(e));
  } finally {
    driving = false;
    D.finish(fails.length ? 1 : 0, 300);
  }
}

if (!RPC || !KEYS) { console.error('RPC and KEYS are required'); process.exit(2); }
if (SCENARIO !== 'chain' && SCENARIO !== 'session' && SCENARIO !== 'all') { console.error('SCENARIO must be chain, session or all'); process.exit(2); }
if (SCENARIO === 'chain' || SCENARIO === 'all') await chain();
if ((SCENARIO === 'session' || SCENARIO === 'all') && fails.length === 0) {
  if (!BASE || !process.env.DATABASE_URL) { console.error('session needs BASE and DATABASE_URL'); process.exit(2); }
  await session();
}
if (fails.length) process.exit(1);
