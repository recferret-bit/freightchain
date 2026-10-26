// Ticket reconcile on the real server, in headless Chrome.
// PAYMENT_MODE=program. SOLANA_RPC is a local validator with the pinned pools program already loaded
// (not a devnet deploy) and a sellable pool registered in this database. The watcher is off, so the
// owner's POST /api/tickets/orders/:id/reconcile is what credits the ticket. Another wallet is 404 not_found.
// Run through scripts/blinks-localnet.mjs (also in e2e.sh blinks): owns the validator, pool, API and database.
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { Keypair, Connection, Transaction, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { PrismaClient } from '@prisma/client';
import { launch, sleep } from '../../../frontend/client/tools/cdp.mjs';

const BASE = process.env.BASE || 'http://127.0.0.1:3103';
const RPC = process.env.RPC;
if (!RPC || new URL(RPC).hostname !== '127.0.0.1' || process.env.WATCH_INTERVAL_MS !== '0') throw new Error('manual reconcile acceptance requires an explicit scratch RPC and disabled watcher');
const PORT = +(process.env.CHROME_PORT || 9233);
const POOL_ID = process.env.POOL_ID ? Number(process.env.POOL_ID) : null;
const fails = [];
const check = (name, ok, extra = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' – ' + extra : ''}`); if (!ok) fails.push(name); };
const until = async (fn, ms = 30000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) return false; await sleep(250); } };
const expected = (p) => /status of 404/.test(p) && /\/api\/tickets\/orders\//.test(p);
const pageErrors = (h) => h.filt().filter((p) => /^(EXCEPTION|console\.error|log\.error|EVAL)/.test(p) && !expected(p));

function walletOf(kp) {
  const naclKp = nacl.sign.keyPair.fromSeed(kp.secretKey.slice(0, 32));
  const address = bs58.encode(naclKp.publicKey);
  if (address !== kp.publicKey.toBase58()) throw new Error('nacl seed does not match the solana pubkey');
  return { kp, naclKp, address };
}
async function call(method, path, { body, cookie } = {}) {
  const r = await fetch(`${BASE}/api/${path}`, {
    method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, j: await r.json().catch(() => ({})), cookie: r.headers.get('set-cookie')?.split(';')[0] ?? '' };
}
async function signIn(naclKp, address) {
  const { j } = await call('POST', 'auth/nonce', { body: { wallet: address } });
  const res = await call('POST', 'auth/verify', { body: { wallet: address, signature: bs58.encode(nacl.sign.detached(new TextEncoder().encode(j.message), naclKp.secretKey)) } });
  if (!res.cookie) throw new Error(`sign-in failed for ${address}: ${res.status} ${JSON.stringify(res.j)}`);
  return res.cookie;
}

const buyer = walletOf(Keypair.generate());
const otherKp = nacl.sign.keyPair();
const other = { address: bs58.encode(otherKp.publicKey), naclKp: otherKp };
const connection = new Connection(RPC, 'confirmed');
const buyerCookie = await signIn(buyer.naclKp, buyer.address);
const otherCookie = await signIn(other.naclKp, other.address);
const agreed = await call('PUT', 'profile/agreements', { body: { age18: true, loss: true }, cookie: buyerCookie });
if (agreed.status !== 200) {
  console.error('agreements failed', agreed.status, JSON.stringify(agreed.j));
  process.exit(1);
}
const airdrop = await connection.requestAirdrop(buyer.kp.publicKey, 2 * LAMPORTS_PER_SOL);
async function confirm(signature) {
  const ok = await until(async () => { const st = (await connection.getSignatureStatuses([signature])).value[0]; if (st?.err) throw new Error(JSON.stringify(st.err)); return ['confirmed', 'finalized'].includes(st?.confirmationStatus); });
  if (!ok) throw new Error('local transaction confirmation timed out');
}
await confirm(airdrop);

const listed = await call('GET', 'pools');
const pool = (listed.j.pools ?? []).find((p) => (POOL_ID == null || p.id === POOL_ID) && (p.status === 'open' || p.status === 'active') && p.prepDeadline > Date.now());
if (!pool) {
  console.error('no sellable pool', JSON.stringify(listed.j).slice(0, 400));
  process.exit(1);
}
const ordered = await call('POST', 'tickets', { body: { poolId: pool.id, qty: 1, burnWarningAccepted: true }, cookie: buyerCookie });
if (ordered.status !== 200 || !ordered.j?.id || !ordered.j.reference) {
  console.error('order failed', ordered.status, JSON.stringify(ordered.j));
  process.exit(1);
}
const orderId = ordered.j.id;

const prisma = new PrismaClient();
let signature;
const tab = await launch({ port: PORT, shotsDir: 'fc-tickets-shots', evalProblems: true });
try {
  await tab.send('Network.enable');
  await tab.send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 800, deviceScaleFactor: 1, mobile: false });
  const [name, otherValue] = otherCookie.split('=');
  await tab.send('Network.setCookie', { name, value: otherValue, url: BASE, httpOnly: true });
  await tab.send('Page.navigate', { url: `${BASE}/lobby.html` });
  check('lobby loaded for the other wallet', await until(async () => await tab.ev('!!document.getElementById("chip-wallet")')));
  const foreign = await tab.ev(`(async () => { const r = await fetch('/api/tickets/orders/${orderId}/reconcile', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: '{}' }); const j = await r.json(); const p = document.createElement('p'); p.id = 'reconcile-foreign'; p.textContent = r.status + ' ' + (j.code || ''); document.body.append(p); return { status: r.status, code: j.code || null, detail: j.detail || '' }; })()`);
  check('a foreign reconcile is 404 not_found (not 403)', foreign?.status === 404 && foreign.code === 'not_found', JSON.stringify(foreign));
  check('the page shows the 404 without throwing', (await tab.ev('document.getElementById("reconcile-foreign")?.textContent || ""')) === '404 not_found');

  await tab.send('Network.setCookie', { name, value: buyerCookie.split('=')[1], url: BASE, httpOnly: true });
  await tab.send('Page.navigate', { url: `${BASE}/lobby.html#new` });
  check('owner sees the unpaid order and CHECK AGAIN button', await until(() => tab.ev('document.querySelector("#orderbox button")?.textContent === "CHECK AGAIN"')));
  const pay = await call('GET', `tickets/orders/${orderId}/payment`, { cookie: buyerCookie });
  if (pay.status !== 200 || !pay.j.transaction) {
    throw new Error(`payment failed: ${pay.status} ${JSON.stringify(pay.j)}`);
  }
  const tx = Transaction.from(Buffer.from(pay.j.transaction, 'base64'));
  tx.partialSign(buyer.kp);

  try {
    signature = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false });
    await confirm(signature);
  } catch (error) {
    throw new Error(`buy_ticket failed: ${error?.message || error}`);
  }
  console.log(`buy_ticket ${signature} pool ${pool.id} order ${orderId}`);
  await sleep(1000);
  const unpaid = await prisma.ticketOrder.findUnique({ where: { id: orderId } });
  const before = await prisma.rideTicket.findUnique({ where: { wallet_poolId: { wallet: buyer.address, poolId: pool.id } } });
  check('a confirmed payment stays uncredited while the watcher is disabled', unpaid?.status === 'awaiting_payment' && !before, JSON.stringify({ order: unpaid?.status, ticket: before?.balance ?? null }));
  await tab.ev('document.querySelector("#orderbox button").click()');
  check('owner CHECK AGAIN reconciles the actual confirmed transaction', await until(async () => (await prisma.ticketOrder.findUnique({ where: { id: orderId } }))?.status === 'paid'));
  check('successful reconciliation clears the unfinished-order banner', await until(() => tab.ev('document.querySelector("#orderbox")?.textContent === ""')));
  const chip = await until(async () => /1 paid ride ticket/.test(await tab.ev('document.getElementById("chip-paid")?.textContent || ""')) ? await tab.ev('document.getElementById("chip-paid")?.textContent || ""') : null, 20000);
  check('the lobby shows the credited ticket', chip === '1 paid ride ticket' || chip === '1 paid ride ticket · waiting', String(chip));
  const mine = await until(async () => (await tab.ev(`document.querySelector("#tier-${pool.tier} .mine b")?.textContent || ""`)) === '1' ? '1' : null, 15000);
  check('the tier card shows one ticket held', mine === '1', String(mine));

  for (let i = 0; i < 2; i++) {
    const duplicate = await tab.ev(`(async()=>{const {reconcileOrder}=await import('/site/tickets-api.js');return reconcileOrder(${JSON.stringify(orderId)});})()`);
    check(`repeat owner reconcile ${i + 1} stays paid`, duplicate?.status === 'paid');
  }
  const receipt = await connection.getTransaction(signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
  const rent = await connection.getMinimumBalanceForRentExemption(87);
  check('buyer pays exactly ticket price plus its own rent and fee', receipt?.meta?.err === null && receipt.meta.preBalances[0] - receipt.meta.postBalances[0] === ordered.j.lamports + rent + receipt.meta.fee);
  check('duplicate reconciliation creates exactly one payment grant', await prisma.ticketGrant.count({ where: { wallet: buyer.address, poolId: pool.id, source: 'payment' } }) === 1);
  const row = await prisma.ticketOrder.findUnique({ where: { id: orderId } });
  const ticket = await prisma.rideTicket.findUnique({ where: { wallet_poolId: { wallet: buyer.address, poolId: pool.id } } });
  const grant = await prisma.ticketGrant.findFirst({ where: { wallet: buyer.address, poolId: pool.id, source: 'payment' } });
  check('DB order is paid from the buy_ticket signature', row?.status === 'paid' && row.signature === signature && row.paymentReference === ordered.j.reference, JSON.stringify({ status: row?.status, signature: row?.signature }));
  check('DB ride ticket balance is the credit', ticket?.balance === 1 && ticket?.bought === 1, JSON.stringify(ticket));
  check('DB payment grant is +1', grant?.delta === 1 && grant?.ref === signature, JSON.stringify(grant && { delta: grant.delta, ref: grant.ref, source: grant.source }));
  const errors = pageErrors(tab);
  check('no unhandled page errors', errors.length === 0, errors.join(' | '));
  await tab.shot('tickets-paid');
} finally {
  await prisma.$disconnect().catch(() => {});
  await tab.close();
}
if (fails.length) { console.error(`FAILED ${fails.length}: ${fails.join(', ')}`); process.exit(1); }
console.log('e2e-tickets passed');
process.exit(0);
