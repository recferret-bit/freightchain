import { api, b58, ensureAccount, payingWallet, provider } from './wallet.js';
import { API_BASE } from '../js/hosts.js';
import { chainFees, createOrder, getOrder, orderPayment, confirmOrder, refundTransaction, settleSignature } from './tickets-api.js';
import { sol } from './pools.js';
import { track } from '../js/analytics.js';
import { solanaPayUrl, ridePayPath, orderPayPath } from './solana-pay.js';

/* Paying: (legacy, a tier without a pool) `buyRide` – the server builds an unsigned SOL transfer (+ memo = ride id), the wallet signs and sends it, the server verifies it on chain;
   (escrowed pools) `buyTickets` / `claimRefund` – the server builds the program transaction, the wallet signs it, the program holds the money (routes in tickets-api.js).
   A Wallet Standard wallet takes the server's wire bytes as they are; web3.js (IIFE build) is only loaded for a legacy injected wallet, which wants a Transaction. */
const WEB3 = 'https://cdn.jsdelivr.net/npm/@solana/web3.js@1.99.0/lib/index.iife.min.js';
let web3;
const loadWeb3 = () => web3 ??= new Promise((ok, no) => {
  if (window.solanaWeb3) return ok(window.solanaWeb3);
  const s = document.createElement('script'); s.src = WEB3; s.onload = () => ok(window.solanaWeb3); s.onerror = () => { web3 = undefined; no(new Error('could not load web3.js (offline?)')); }; document.head.append(s);
});
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fromB64 = b => Uint8Array.from(atob(b), c => c.charCodeAt(0));
const noWallet = () => new Error('No Solana wallet found – install Phantom or Solflare (and switch it to Devnet)');
const shortVec = (b, o) => { let v = 0, s = 0; for (;;) { const x = b[o++]; v |= (x & 0x7f) << s; if (!(x & 0x80)) return [v, o]; s += 7; } };
/** The fee payer of a wire transaction (legacy or v0): the first account key of its message. The server builds every payment for the signed-in wallet as the fee payer. */
export function feePayerOf(bytes) {
  let [n, o] = shortVec(bytes, 0); o += 64 * n;
  if (bytes[o] & 0x80) o++;   // v0 message: version prefix
  [, o] = shortVec(bytes, o + 3);   // past the 3-byte header to the account keys
  return b58(bytes.slice(o, o + 32));
}
/** A wallet left on mainnet cannot find a devnet blockhash: say so instead of the RPC's words. A rejection keeps its own error (code 4001). */
const devnetHint = e => (/blockhash not found/i.test(e?.message ?? '') ? Object.assign(new Error('The wallet is not on devnet – switch it to Devnet (Phantom: Settings → Developer Settings → Testnet Mode) and try again.'), { code: 'wallet_wrong_cluster' }) : e);
/** Sign and send a transaction the SERVER built (base64 wire bytes, unsigned) on the account it was built for (`account`, default its fee payer), with the wallet that holds it → its signature (base58). */
async function selfPay(transactionB64, account = null) {
  const bytes = fromB64(transactionB64), address = account ?? feePayerOf(bytes);
  const p = await payingWallet(address);
  if (!p) throw Object.assign(noWallet(), { code: 'no_wallet' });
  await ensureAccount(p, address);
  try { const r = await p.signAndSendTransaction(p.standard ? bytes : (await loadWeb3()).Transaction.from(bytes)); return r.signature ?? r; }   // Phantom / Solflare: { signature }
  catch (e) { throw devnetHint(e); }
}
const httpStatus = e => typeof e?.status === 'number' ? e.status : null;
const problemCode = e => typeof e?.code === 'string' ? e.code : null;
const PHONE = 'Browser wallet closed. Scan the code with the phone wallet that holds this account (devnet)…';
/** What to say while the phone may still pay: the wallet's own reason when it is a mismatch / wrong cluster, else "closed". */
const phoneStep = e => (e?.code === 'wallet_account_mismatch' || e?.code === 'wallet_wrong_cluster' ? `${e.message} Or scan the code with the phone wallet that holds this account (devnet)…` : PHONE);
const payUrl = path => solanaPayUrl(API_BASE, typeof location === 'undefined' ? '' : location.origin, path);

/** Poll `load` until it returns a hit, `ms` passes, or `stop.done` (the desktop path finished). */
async function pollPaid(load, ms = 90000, stop = { done: false }) {
  const end = Date.now() + ms;
  while (!stop.done && Date.now() < end) {
    const hit = await load().catch(() => null);
    if (stop.done) return null;
    if (hit) return hit;
    await sleep(3000);
  }
  return null;
}

/** order → pay → wait for the server to see it on chain. Resolves to the ready (paid) ride. `onStep(text)` reports progress.
 *  `onPayLink(url|null)` is the phone QR: the same transaction, signed by the phone wallet that holds this account. */
export async function buyRide(tier, onStep = () => {}, onPayLink = () => {}) {
  const failed = (stage, err, rideId) => {
    const properties = { stage, tier_id: tier, http_status: httpStatus(err), code: problemCode(err) };
    if (rideId) properties.ride_id = rideId;
    track('payment_failed', properties);   // never e.message: the give-up string embeds the signature
  };
  const p = provider();
  if (p && !p.standard) { try { await loadWeb3(); } catch (e) { failed('web3_load_failed', e); throw e; } }   // before the order: a legacy wallet cannot pay without it
  onStep('Creating the order…');
  let ride;
  try { ride = await api('rides', { tier }, { report: false }); } catch (e) { failed('order_failed', e); throw e; }
  if (ride.status !== 'awaiting_payment') return ride;   // already paid / ready (e.g. an unstarted ride you already own)
  let transaction;
  try { ({ transaction } = await api(`rides/${ride.id}/payment`, undefined, { report: false })); } catch (e) { failed('instructions_failed', e, ride.id); throw e; }   // GET
  onPayLink(payUrl(ridePayPath(ride.id)));
  const stop = { done: false };
  const phone = () => pollPaid(async () => {
    const r = await api(`rides/${ride.id}/reconcile`, {});
    return r.status === 'paid' ? r.ride : null;
  }, 90000, stop);
  try {
    if (!p) {
      onStep('No browser wallet. Scan the code with the phone wallet that holds this account (devnet)…');
      const found = await phone();
      if (found) return found;
      const err = noWallet();
      failed('no_provider', err, ride.id);
      throw err;
    }
    onStep('Approve the payment in your wallet (devnet SOL)…');
    let res;
    try { res = await selfPay(transaction); }
    catch (e) {
      onStep(phoneStep(e));
      const found = await phone();
      if (found) return found;
      failed('wallet_rejected', e, ride.id);
      throw e;
    }
    track('payment_submitted', { ride_id: ride.id, tier_id: tier });   // no signature, even though it is in scope
    const signature = res;
    onStep('Waiting for the network to confirm…');
    let fromPhone = null;
    const phoneRide = phone().then(hit => { fromPhone = hit; return hit; });
    try {
      for (let i = 0; i < 60; i++) {
        if (fromPhone) return fromPhone;
        const r = await fetch(`${API_BASE}/api/rides/${ride.id}/confirm`, { credentials: 'include', method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ signature }) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw Object.assign(new Error(j.detail || j.title || `payment not accepted (${r.status})`), { status: r.status, code: j.code ?? null });   // RFC 9457 problem+json
        if (j.status === 'paid') return j.ride;
        if (j.status !== 'pending') throw new Error(`unexpected payment status: ${j.status}`);   // 'pending' = not on chain yet: ask again
        if (fromPhone) return fromPhone;
        await sleep(1500);
      }
    } catch (e) {
      const found = fromPhone ?? await phoneRide;
      if (found) return found;
      failed(typeof e.status === 'number' ? 'confirm_rejected' : 'unexpected_status', e, ride.id);
      throw e;
    }
    const found = fromPhone ?? await phoneRide;
    if (found) return found;
    track('payment_confirm_gave_up', { ride_id: ride.id, tier_id: tier, attempts: 60 });   // no signature
    throw new Error(`still not confirmed – your transaction ${signature} may land later; reopen the lobby (a paid ride is kept)`);
  } finally { stop.done = true; onPayLink(null); }
}

/* ───── escrowed pools (docs/agents/escrow.md) – the W3/W4 routes, all behind tickets-api.js ───── */

/** Keeps the signature of an order in flight, so the lobby's RETRY CONFIRM works after a reload (per-browser convenience; the watcher credits the payment anyway). */
export const ORDER_SIG = id => `freightchain.order.${id}`;
const remember = (id, sig) => { try { localStorage.setItem(ORDER_SIG(id), sig); } catch { /* private mode */ } };

/** Waits until the order is paid (90 s). With the signature of the wallet's own transaction it asks `confirm` (the fast path); without one (a reload lost it) it reads the order,
 *  which the program-log watcher credits when the transaction lands. Resolves `{ status: 'paid', order }` or `{ status: 'expired', order }` (the order lapsed – nothing was charged). */
export async function waitPaid(orderId, signature) {
  for (let i = 0; i < 60; i++) {
    const r = signature ? await confirmOrder(orderId, signature) : { status: 'pending', order: await getOrder(orderId) };
    const st = r.status === 'paid' ? 'paid' : r.order?.status;
    if (st === 'paid') return { status: 'paid', order: r.order };
    if (st === 'expired' || st === 'refunded') return { status: st, order: r.order };
    if (r.status !== 'pending') throw new Error(`unexpected order status: ${r.status}`);
    await sleep(1500);
  }
  throw new Error(`still not confirmed${signature ? ` – your transaction ${signature} may land later` : ''}; the tickets are credited when it does (reopen the lobby)`);
}

/** order → payment → the wallet signs AND sends it (it pays the network fee and the Ticket rent) → confirm → paid.
 *  An order that lapses is replaced ONCE automatically. Resolves `{ status: 'paid', order }`. `onStep(text)` reports progress. Rejects with `{ notConfigured: true }` while sales are off. */
export async function buyTickets(poolId, qty, onStep = () => {}, onPayLink = () => {}) {
  const p = provider();
  if (p && !p.standard) await loadWeb3();
  for (let attempt = 0; ; attempt++) {
    onStep('Creating the order…');
    const order = await createOrder(poolId, qty);
    const pay = await orderPayment(order.id);
    onPayLink(payUrl(orderPayPath(order.id)));
    const stop = { done: false };
    const phone = () => pollPaid(async () => {
      const r = await api(`tickets/orders/${order.id}/reconcile`, {});
      return r.status === 'paid' ? r : null;
    }, 90000, stop);
    try {
      if (!p) {
        onStep('No browser wallet. Scan the code with the phone wallet that holds this account (devnet)…');
        const found = await phone();
        if (found?.status === 'paid') return { ...found, programId: pay.programId };
        throw noWallet();
      }
      const fee = await chainFees(poolId).then(f => ` – network fee ≈ ${sol(f.estimatedFeeLamports)}`, () => '');
      onStep(`Approve ${sol(pay.lamports)} in your wallet${fee}…`);
      let signature;
      try { signature = await selfPay(pay.transaction); }
      catch (e) {
        onStep(phoneStep(e));
        const found = await phone();
        if (found?.status === 'paid') return { ...found, programId: pay.programId };
        throw e;
      }
      remember(order.id, signature); onStep('Waiting for the network to confirm…');
      let fromPhone = null;
      const phonePaid = phone().then(hit => { fromPhone = hit; return hit; });
      let status = 'pending', paidOrder = null;
      try {
        for (let i = 0; i < 60 && !fromPhone; i++) {
          const step = await confirmOrder(order.id, signature);
          const st = step.status === 'paid' ? 'paid' : step.order?.status;
          if (st === 'paid' || st === 'expired' || st === 'refunded') { status = st; paidOrder = step.order; break; }
          if (step.status !== 'pending') throw new Error(`unexpected order status: ${step.status}`);
          await sleep(1500);
        }
      } catch (e) {
        const found = fromPhone ?? await phonePaid;
        if (found?.status === 'paid') return { ...found, programId: pay.programId };
        throw e;
      }
      const found = fromPhone ?? (status === 'pending' ? await phonePaid : null);
      if (found?.status === 'paid') return { ...found, programId: pay.programId };
      if (status === 'paid') return { status: 'paid', order: paidOrder, programId: pay.programId };
      if (attempt) throw new Error('The order lapsed twice before the payment landed – nothing was charged. Try again in a minute.');
      onStep('The order lapsed before the payment landed (nothing was charged) – starting a new one…');
    } finally { stop.done = true; onPayLink(null); }
  }
}

/** CLAIM REFUND on a failed pool: the server builds `fail_pool` (when the pool still has to be failed) + `refund(me)`; the wallet signs and sends it (self-paid), then the server is told
 *  about the signature (POST /api/chain/settle). Resolves `{ signature, settled }` – settled = the server already saw the Refunded event. */
export async function claimRefund(poolId, onStep = () => {}) {
  const p = provider(); if (!p) throw noWallet();
  onStep('Building the refund transaction…');
  const r = await refundTransaction(poolId);
  onStep(`Approve the refund of ${sol(r.lamports)} in your wallet${r.needsFail ? ' (it also closes the failed pool – anyone may)' : ''}…`);
  const signature = await selfPay(r.transaction);
  onStep('Refund sent – waiting for the network…');
  for (let i = 0; i < 20; i++) {   // ~30 s; after that the program-log watcher records it anyway
    const s = await settleSignature(signature).catch(() => ({ status: 'pending' }));
    if (s.status === 'done') return { signature, settled: true };
    if (s.status === 'invalid') throw Object.assign(new Error(`The refund transaction failed on chain${s.detail ? `: ${s.detail}` : ''} – nothing moved. Try again.`), { signature });
    await sleep(1500);
  }
  return { signature, settled: false };
}

/** Sign and send a transaction a server built (base64) with the browser wallet → its signature. Live streams: a paid donation to a driver (the fee payer is the
 *  signed-in wallet); the blink page passes `account` (the connected one – an action may name a sponsor as the fee payer).
 *  Rejects with `{ code: 'no_wallet' }` when the page has none (the phone QR is the way then). */
export async function signAndSend(transactionB64, account = null) {
  return selfPay(transactionB64, account);
}
export { phoneStep };
