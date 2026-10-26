import { acceptLocalTestTerms } from './local-test-terms.mjs';
// Full normal-length MEDIUM or paid 1h: synthetic keyboard input, real physics/hashing and enforced verdict.
// PIKE uses direct application handlers/internal payment codes; screen interaction is covered by e2e controls.
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { readFileSync } from 'node:fs';
import { Connection, Keypair, Transaction, sendAndConfirmRawTransaction } from '@solana/web3.js';
import { honkBalance as readHonk, emissionBalance as readEmission, mintState as readMint } from './honk-program.mjs';
import { launch, sleep, answerPrompts } from '../../../frontend/client/tools/cdp.mjs';
import { finishFor } from '../../../frontend/client/shared/finish-for.js';
import { boundedFetch, withDeadline } from './normal-drive-support.mjs';
import { installKeyboardDriver } from './keyboard-driver.mjs';

const honkBalance = args => withDeadline(() => readHonk(args), 15_000, 'token balance');
const emissionBalance = args => withDeadline(() => readEmission(args), 15_000, 'emission balance');
const mintState = args => withDeadline(() => readMint(args), 15_000, 'mint supply');
const BASE = process.env.BASE;
if (!BASE || !['localhost', '127.0.0.1'].includes(new URL(BASE).hostname)) throw new Error('normal-drive requires an isolated loopback API');
let cookie;
const call = async (method, path, body) => {
  const response = await boundedFetch(`${BASE}/api/${path}`, { method, headers: { 'content-type': 'application/json', ...(cookie && { cookie }) }, ...(body && { body: JSON.stringify(body) }) });
  const data = await response.json();
  if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${JSON.stringify(data)}`);
  if (path === 'auth/verify') cookie = response.headers.get('set-cookie')?.split(';')[0];
  return data;
};
const paid = !!process.env.NORMAL_PAID_KEY, rpc = process.env.RPC;
if (paid && (!rpc || !['localhost', '127.0.0.1'].includes(new URL(rpc).hostname))) throw new Error('paid proof needs its scratch loopback validator');
const kp = paid ? Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(process.env.NORMAL_PAID_KEY, 'utf8')))) : Keypair.generate();
const keypair = nacl.sign.keyPair.fromSecretKey(kp.secretKey), wallet = bs58.encode(keypair.publicKey);
let beforeChain, beforeEmission, beforeSupply, beforeLedger, order, signature;
const challenge = await call('POST', 'auth/nonce', { wallet });
await call('POST', 'auth/verify', { wallet, signature: bs58.encode(nacl.sign.detached(new TextEncoder().encode(challenge.message), keypair.secretKey)) });
await acceptLocalTestTerms(BASE, cookie);
if (paid) {
  await call('PUT', 'profile/agreements', { age18: true, loss: true });
  order = await call('POST', 'tickets', { poolId: Number(process.env.NORMAL_PAID_POOL), qty: 1, burnWarningAccepted: true });
  const payment = await call('GET', `tickets/orders/${order.id}/payment`);
  const tx = Transaction.from(Buffer.from(payment.transaction, 'base64')); tx.partialSign(kp);
  signature = await withDeadline(() => sendAndConfirmRawTransaction(new Connection(rpc, { commitment: 'confirmed', fetch: boundedFetch, disableRetryOnRateLimit: true }), tx.serialize(), { commitment: 'confirmed' }), 90_000, 'ticket confirmation');
  const confirmation = await call('POST', `tickets/orders/${order.id}/confirm`, { signature });
  if (confirmation.status !== 'paid') throw new Error('signed chain ticket was not credited');
  const me = await call('GET', 'me');
  if (!me.tickets.some(t => t.poolId === Number(process.env.NORMAL_PAID_POOL) && t.balance === 1 && t.bought === 1)) throw new Error('ticket mirror does not match purchase');
  beforeChain = await honkBalance({ rpc, owner: kp.publicKey }); beforeEmission = await emissionBalance({ rpc });
  beforeSupply = (await mintState({ rpc })).supply; beforeLedger = await call('GET', 'honk');
  console.log(JSON.stringify({ purchase: { orderId: order.id, signature, wallet } }));
}
const ride = await call('POST', 'rides', paid ? { tier: '1h' } : { tier: 'free', level: 2, assist: false, tutorial: false });
if (ride.minSeconds !== (paid ? 3600 : 300) || ride.timeScale !== 1 || Math.abs(ride.completeDist - (paid ? finishFor(ride.seed, ride.trip).finishS : 3360)) > 1e-6) throw new Error(`expected normal course: ${JSON.stringify(ride)}`);
if (paid && (ride.poolId !== Number(process.env.NORMAL_PAID_POOL) || ride.weeklyGrant || ride.promo)) throw new Error('paid ride did not use the purchased pool ticket');
console.log(JSON.stringify({ createdRide: ride }));
const tab = await launch({ port: +process.env.CHROME_PORT || 19387, shotsDir: 'fc-normal-drive-shots', evalProblems: true, args: process.env.NORMAL_DRIVE_ANGLE === 'metal' ? ['--use-angle=metal'] : [] });
let stopPrompts = () => {};
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { stopPrompts(); void tab.close().finally(() => process.exit(signal === 'SIGINT' ? 130 : 143)); });
try {
  await tab.send('Emulation.setDeviceMetricsOverride', { width: 640, height: 360, deviceScaleFactor: .5, mobile: false });
  if (paid) await tab.send('Page.addScriptToEvaluateOnNewDocument', { source: `const originalFetch = window.fetch.bind(window); window.fetch = (url, init) => originalFetch(String(url).startsWith('https://api.devnet.solana.com') ? ${JSON.stringify(rpc)} : url, init);` });
  const [name, value] = cookie.split('=');
  await tab.send('Network.setCookie', { name, value, url: BASE, httpOnly: true });
  await tab.send('Page.navigate', { url: `${BASE}/play.html?ride=${ride.id}` });
  const bootBy = Date.now() + 60_000;
  while (!await tab.ev('!!window.__game && !!__game.online.ride && !document.getElementById("go").disabled')) {
    if (Date.now() > bootBy) throw new Error('game did not boot');
    await sleep(200);
  }
  if (paid) await tab.ev('(() => { const box = document.getElementById("ranked-toggle"); if (!box) throw new Error("ranked entry unavailable"); if (!box.checked) box.click(); })()');
  await tab.ev('document.getElementById("go").click()');
  const startBy = Date.now() + 30_000;
  while (!await tab.ev('__game.telemetry.on && __game.st.mode === "drive"')) {
    if (Date.now() > startBy) throw new Error('ride did not start');
    await sleep(200);
  }
  if ((await call('GET', `rides/${ride.id}`)).trafficVersion !== 1 || !await tab.ev('__game.telemetry.trafficVersion === 1')) throw new Error('traffic frame proof must be required');
  if (paid && (!(await call('GET', `rides/${ride.id}`)).ranked || !await tab.ev('document.getElementById("chain")?.textContent.includes("✓ on chain")'))) throw new Error('paid ride must start ranked with its road seal independently checked on chain');
  const settings = await tab.ev('JSON.stringify(__game.CFG)');
  await tab.ev(`(${installKeyboardDriver.toString()})()`);
  stopPrompts = answerPrompts(tab);
  const finishBy = Date.now() + (paid ? 100 : 45) * 60_000;
  for (;;) {
    await sleep(5000);
    const state = await tab.ev('({s:__game.st.s,t:__game.st.t,hull:__game.st.hull,v:__game.st.v,mode:__game.st.mode,d:__game.st.d,gear:__game.st.gear,driver:__keyboardDriver})');
    console.log(JSON.stringify(state));
    if (state.driver.error) throw new Error(state.driver.error);
    if (state.mode !== 'drive') break;
    if (Date.now() > finishBy) throw new Error('normal ride timed out');
  }
  await tab.ev('__stopKeyboardDriver()');
  stopPrompts();
  const flushBy = Date.now() + 120_000;
  let ended;
  do { ended = await call('GET', `rides/${ride.id}`); if (ended.verdict && await tab.ev('__game.telemetry.queue.length === 0 && !__game.telemetry.sending')) break; await sleep(1000); } while (Date.now() < flushBy);
  await tab.shot('normal-drive-result');
  console.log(JSON.stringify({ ride: ended, telemetry: await tab.ev('({seq:__game.telemetry.seq,queue:__game.telemetry.queue.length,refused:__game.telemetry.refused})'), problems: tab.filt() }));
  if (await tab.ev('JSON.stringify(__game.CFG)') !== settings) throw new Error('game configuration changed during the ride');
  if (ended.status !== 'completed' || ended.distance < Math.round(ride.completeDist) || !await tab.ev(`__game.st.s >= ${ride.completeDist}`) || ended.verdict?.status !== 'verified') throw new Error(`normal ride not verified: ${ended.status} ${JSON.stringify(ended.verdict)}`);
  if (!await tab.ev('__game.telemetry.queue.length === 0 && __game.telemetry.refused === null') || tab.filt().length) throw new Error('recording upload or browser errors');
  if (paid) {
    const rewardBy = Date.now() + 120_000;
    let chain;
    do { chain = await honkBalance({ rpc, owner: kp.publicKey }); if (chain - beforeChain === 100_000_000n) break; await sleep(1000); } while (Date.now() < rewardBy);
    const ledger = await call('GET', 'honk');
    if (chain - beforeChain !== 100_000_000n || Number(ledger.minted) - Number(beforeLedger.minted) !== 100 || beforeEmission - await emissionBalance({ rpc }) !== 100_000_000n || (await mintState({ rpc })).supply !== beforeSupply) throw new Error('paid reward must be 100 TEN4 from emission with unchanged supply');
    if ((await call('POST', `tickets/orders/${order.id}/confirm`, { signature })).status !== 'paid') throw new Error('duplicate confirmation must remain paid');
    const duplicate = await boundedFetch(`${BASE}/api/rides/${ride.id}/end`, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ outcome: 'shift', s: ended.distance, t: ended.driveSeconds, hull: 100 }) });
    if (duplicate.status !== 409) throw new Error(`duplicate end must conflict: ${duplicate.status} ${await duplicate.text()}`);
    // Include at least one 60-second release-worker interval: an immediate balance check can miss queued duplicates.
    await sleep(65_000);
    if (beforeEmission - await emissionBalance({ rpc }) !== 100_000_000n || (await mintState({ rpc })).supply !== beforeSupply || await honkBalance({ rpc, owner: kp.publicKey }) !== chain || Number((await call('GET', 'honk')).minted) !== Number(ledger.minted)) throw new Error('duplicate end/confirm changed rewards');
    console.log(JSON.stringify({ reward: { ledgerDelta: 100, chainBaseUnits: String(chain - beforeChain), supplyUnchanged: true, duplicateEndStatus: duplicate.status } }));
  }
  console.log(`PASS normal-duration ${paid ? 'paid 1h' : 'MEDIUM'}: normal physics, enforced verdict and complete traffic proof`);
} finally { stopPrompts(); await tab.close(); }
