import { api, provider } from './wallet.js';
import { API_BASE } from '../js/hosts.js';
import { chainFees, createOrder, getOrder, orderPayment, confirmOrder, refundTransaction, settleSignature } from './tickets-api.js';
import { sol } from './pools.js';
import { track } from '../js/analytics.js';

/* Paying: (legacy, a tier without a pool) `buyRide` – the server builds an unsigned SOL transfer (+ memo = ride id), the wallet signs and sends it, the server verifies it on chain;
   (escrowed pools) `buyTickets` / `claimRefund` – the server builds the program transaction, the wallet signs it, the program holds the money (routes in tickets-api.js).
   web3.js (IIFE build) is only loaded when a paid ride is actually bought – it is needed to turn the server's bytes into a Transaction the wallet accepts. */
const WEB3 = 'https://cdn.jsdelivr.net/npm/@solana/web3.js@1.99.0/lib/index.iife.min.js';
let web3;
const loadWeb3 = () => web3 ??= new Promise((ok, no) => {
  if (window.solanaWeb3) return ok(window.solanaWeb3);
  const s = document.createElement('script'); s.src = WEB3; s.onload = () => ok(window.solanaWeb3); s.onerror = () => { web3 = undefined; no(new Error('could not load web3.js (offline?)')); }; document.head.append(s);
});
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fromB64 = b => Uint8Array.from(atob(b), c => c.charCodeAt(0));
const noWallet = () => new Error('No Solana wallet found – install Phantom or Solflare (and switch it to Devnet)');
const selfPay = async (p, tx) => { const r = await p.signAndSendTransaction(tx); return r.signature ?? r; };   // Phantom / Solflare: { signature }
const httpStatus = e => typeof e?.status === 'number' ? e.status : null;
const problemCode = e => typeof e?.code === 'string' ? e.code : null;

/** order → pay → wait for the server to see it on chain. Resolves to the ready (paid) ride. `onStep(text)` reports progress. */
export async function buyRide(tier, onStep = () => {}) {
  const failed = (stage, err, rideId) => {
    const properties = { stage, tier_id: tier, http_status: httpStatus(err), code: problemCode(err) };
    if (rideId) properties.ride_id = rideId;
    track('payment_failed', properties);   // never e.message: the give-up string embeds the signature
  };
  const p = provider();
  if (!p) {
    const err = new Error('No Solana wallet found – install Phantom or Solflare (and switch it to Devnet)');   // before ordering: no stray orders
    failed('no_provider', err);
    throw err;
  }
  let w3;
  try { w3 = await loadWeb3(); } catch (e) { failed('web3_load_failed', e); throw e; }
  onStep('Creating the order…');
  let ride;
  try { ride = await api('rides', { tier }, { report: false }); } catch (e) { failed('order_failed', e); throw e; }
  if (ride.status !== 'awaiting_payment') return ride;   // already paid / ready (e.g. an unstarted ride you already own)
  onStep('Approve the payment in your wallet (devnet SOL)…');
  let transaction;
  try { ({ transaction } = await api(`rides/${ride.id}/payment`, undefined, { report: false })); } catch (e) { failed('instructions_failed', e, ride.id); throw e; }   // GET
  let res;
  try { res = await p.signAndSendTransaction(w3.Transaction.from(Uint8Array.from(atob(transaction), c => c.charCodeAt(0)))); }
  catch (e) { failed('wallet_rejected', e, ride.id); throw e; }
  track('payment_submitted', { ride_id: ride.id, tier_id: tier });   // no signature, even though it is in scope
  const signature = res.signature ?? res;   // Phantom / Solflare: { signature }
  onStep('Waiting for the network to confirm…');
  try {
    for (let i = 0; i < 60; i++) {
      const r = await fetch(`${API_BASE}/api/rides/${ride.id}/confirm`, { credentials: 'include', method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ signature }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw Object.assign(new Error(j.detail || j.title || `payment not accepted (${r.status})`), { status: r.status, code: j.code ?? null });   // RFC 9457 problem+json
      if (j.status === 'paid') return j.ride;
      if (j.status !== 'pending') throw new Error(`unexpected payment status: ${j.status}`);   // 'pending' = not on chain yet: ask again
      await sleep(1500);
    }
  } catch (e) {
    failed(typeof e.status === 'number' ? 'confirm_rejected' : 'unexpected_status', e, ride.id);
    throw e;
  }
  track('payment_confirm_gave_up', { ride_id: ride.id, tier_id: tier, attempts: 60 });   // no signature
  throw new Error(`still not confirmed – your transaction ${signature} may land later; reopen the lobby (a paid ride is kept)`);
}

/* ───── escrowed pools (docs/paid-tickets-plan.md §2.8 / §2.10) – the W3/W4 routes, all behind tickets-api.js ───── */

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
export async function buyTickets(poolId, qty, onStep = () => {}) {
  const p = provider(); if (!p) throw noWallet();   // before ordering: no stray orders
  const w3 = await loadWeb3();
  for (let attempt = 0; ; attempt++) {
    onStep('Creating the order…');
    const order = await createOrder(poolId, qty);
    const pay = await orderPayment(order.id);
    const fee = await chainFees(poolId).then(f => ` – network fee ≈ ${sol(f.estimatedFeeLamports)}`, () => '');
    onStep(`Approve ${sol(pay.lamports)} in your wallet${fee}…`);
    const signature = await selfPay(p, w3.Transaction.from(fromB64(pay.transaction)));
    remember(order.id, signature); onStep('Waiting for the network to confirm…');
    const r = await waitPaid(order.id, signature);
    if (r.status === 'paid') return r;
    if (attempt) throw new Error('The order lapsed twice before the payment landed – nothing was charged. Try again in a minute.');
    onStep('The order lapsed before the payment landed (nothing was charged) – starting a new one…');
  }
}

/** CLAIM REFUND on a failed pool: the server builds `fail_pool` (when the pool still has to be failed) + `refund(me)`; the wallet signs and sends it (self-paid), then the server is told
 *  about the signature (POST /api/chain/settle). Resolves `{ signature, settled }` – settled = the server already saw the Refunded event. */
export async function claimRefund(poolId, onStep = () => {}) {
  const p = provider(); if (!p) throw noWallet();
  const w3 = await loadWeb3();
  onStep('Building the refund transaction…');
  const r = await refundTransaction(poolId);
  onStep(`Approve the refund of ${sol(r.lamports)} in your wallet${r.needsFail ? ' (it also closes the failed pool – anyone may)' : ''}…`);
  const signature = await selfPay(p, w3.Transaction.from(fromB64(r.transaction)));
  onStep('Refund sent – waiting for the network…');
  for (let i = 0; i < 20; i++) {   // ~30 s; after that the program-log watcher records it anyway
    const s = await settleSignature(signature).catch(() => ({ status: 'pending' }));
    if (s.status === 'done') return { signature, settled: true };
    if (s.status === 'invalid') throw Object.assign(new Error(`The refund transaction failed on chain${s.detail ? `: ${s.detail}` : ''} – nothing moved. Try again.`), { signature });
    await sleep(1500);
  }
  return { signature, settled: false };
}

/** Sign and send a transaction the SERVER built (base64, unsigned) with the injected wallet → its signature. Live streams: a paid donation to a driver. */
export async function signAndSend(transactionB64) {
  const p = provider();
  if (!p) throw noWallet();
  const w3 = await loadWeb3();
  return selfPay(p, w3.Transaction.from(fromB64(transactionB64)));
}
