import { api, provider } from './wallet.js';
import { API_BASE } from '../js/hosts.js';
import { chainFees, createOrder, getOrder, orderPayment, submitOrder, confirmOrder, refundTransaction, settleSignature } from './tickets-api.js';
import { sol } from './pools.js';

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
const toB64 = bytes => { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s); };
const noWallet = () => new Error('No Solana wallet found – install Phantom or Solflare (and switch it to Devnet)');
const selfPay = async (p, tx) => { const r = await p.signAndSendTransaction(tx); return r.signature ?? r; };   // Phantom / Solflare: { signature }
const signOnly = async (p, tx) => toB64((await p.signTransaction(tx)).serialize({ requireAllSignatures: false, verifySignatures: false }));   // the sponsor's signature is added by the server

/** order → pay → wait for the server to see it on chain. Resolves to the ready (paid) ride. `onStep(text)` reports progress. */
export async function buyRide(tier, onStep = () => {}) {
  const p = provider();
  if (!p) throw new Error('No Solana wallet found – install Phantom or Solflare (and switch it to Devnet)');   // before ordering: no stray orders
  const w3 = await loadWeb3();
  onStep('Creating the order…');
  const ride = await api('rides', { tier });
  if (ride.status !== 'awaiting_payment') return ride;   // already paid / ready (e.g. an unstarted ride you already own)
  onStep('Approve the payment in your wallet (devnet SOL)…');
  const { transaction } = await api(`rides/${ride.id}/payment`);
  const res = await p.signAndSendTransaction(w3.Transaction.from(Uint8Array.from(atob(transaction), c => c.charCodeAt(0))));
  const signature = res.signature ?? res;   // Phantom / Solflare: { signature }
  onStep('Waiting for the network to confirm…');
  for (let i = 0; i < 60; i++) {
    const r = await fetch(`${API_BASE}/api/rides/${ride.id}/confirm`, { credentials: 'include', method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ signature }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.detail || j.title || `payment not accepted (${r.status})`);   // RFC 9457 problem+json
    if (j.status === 'paid') return j.ride;
    if (j.status !== 'pending') throw new Error(`unexpected payment status: ${j.status}`);   // 'pending' = not on chain yet: ask again
    await sleep(1500);
  }
  throw new Error(`still not confirmed – your transaction ${signature} may land later; reopen the lobby (a paid ride is kept)`);
}

/* ───── escrowed pools (docs/paid-tickets-plan.md §2.8 / §2.10) – the W3/W4 routes, all behind tickets-api.js ───── */

/** Keeps the signature of an order in flight, so the lobby's RETRY CONFIRM works after a reload (per-browser convenience; the watcher credits the payment anyway). */
export const ORDER_SIG = id => `freightchain.order.${id}`;
const remember = (id, sig) => { try { localStorage.setItem(ORDER_SIG(id), sig); } catch { /* private mode */ } };
const walletRefused = e => e?.code === 4001 || /reject|declin|cancel/i.test(e?.message ?? '');   // the user said no in the wallet: never fall back to a second popup

/** Waits until the order is paid (90 s). With the signature of a SELF-paid transaction it asks `confirm` (the fast path); a sponsored one the server sent itself, so it reads the order.
 *  Resolves `{ status: 'paid', order }` or `{ status: 'expired', order }` (the order lapsed – nothing was charged). */
export async function waitPaid(orderId, signature, { selfPaid = true } = {}) {
  for (let i = 0; i < 60; i++) {
    const r = selfPaid && signature ? await confirmOrder(orderId, signature) : { status: 'pending', order: await getOrder(orderId) };
    const st = r.status === 'paid' ? 'paid' : r.order?.status;
    if (st === 'paid') return { status: 'paid', order: r.order };
    if (st === 'expired' || st === 'refunded') return { status: st, order: r.order };
    if (r.status !== 'pending') throw new Error(`unexpected order status: ${r.status}`);
    await sleep(1500);
  }
  throw new Error(`still not confirmed${signature ? ` – your transaction ${signature} may land later` : ''}; the tickets are credited when it does (reopen the lobby)`);
}

/** order → payment → (sponsored: the wallet SIGNS, the server adds the fee payer and sends | self-paid or any sponsor failure: the wallet signs AND sends, then confirm) → paid.
 *  An order that lapses is replaced ONCE automatically. Resolves `{ status: 'paid', order }`. `onStep(text)` reports progress. Rejects with `{ notConfigured: true }` while sales are off. */
export async function buyTickets(poolId, qty, onStep = () => {}) {
  const p = provider(); if (!p) throw noWallet();   // before ordering: no stray orders
  const w3 = await loadWeb3();
  for (let attempt = 0; ; attempt++) {
    onStep('Creating the order…');
    const order = await createOrder(poolId, qty);
    const selfPaid = async why => {
      if (why) onStep(why);
      const pay = await orderPayment(order.id, { selfPaid: true });
      const fee = await chainFees(poolId).then(f => ` – network fee ≈ ${sol(f.estimatedFeeLamports)}`, () => '');
      onStep(`Approve ${sol(pay.lamports)} in your wallet${fee}…`);
      const signature = await selfPay(p, w3.Transaction.from(fromB64(pay.transaction)));
      remember(order.id, signature); onStep('Waiting for the network to confirm…');
      return waitPaid(order.id, signature);
    };
    let r;
    const pay = await orderPayment(order.id);
    if (pay.sponsored && typeof p.signTransaction === 'function') {
      onStep(`Approve ${sol(pay.lamports)} in your wallet – network fee: sponsored…`);
      let signed = null;
      try { signed = await signOnly(p, w3.Transaction.from(fromB64(pay.transaction))); } catch (e) { if (walletRefused(e)) throw e; }   // a wallet that can't sign-only: pay the fee yourself
      if (signed) {
        try {
          const s = await submitOrder(order.id, signed); remember(order.id, s.signature);
          r = s.status === 'paid' ? { status: 'paid', order: s.order } : (onStep('Waiting for the network to confirm…'), await waitPaid(order.id, s.signature, { selfPaid: false }));
        } catch (e) { if (e.status === 409) throw e; r = await selfPaid('The fee sponsor is unavailable – approve again and pay the network fee yourself (≈ 0.0001 SOL)…'); }   // 400 / 429 sponsor_cap / 503: fall back
      } else r = await selfPaid('Your wallet can’t sign without sending – paying the network fee yourself…');
    } else r = await selfPaid();
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
