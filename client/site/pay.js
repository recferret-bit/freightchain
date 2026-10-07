import { api, provider } from './wallet.js';
import { API_BASE } from '../js/hosts.js';
import { chainFees, createOrder, orderPayment, submitOrder, confirmOrder, refundTransaction, submitRefund } from './tickets-api.js';
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

/* ───── escrowed pools (docs/paid-tickets-plan.md §2.8 / §2.10) – the routes are W3/W4's and PROVISIONAL, all behind tickets-api.js ───── */

/** Keeps the signature of an order in flight, so the lobby's RETRY CONFIRM works after a reload (per-browser convenience; the watcher credits the payment anyway). */
export const ORDER_SIG = id => `freightchain.order.${id}`;
const remember = (id, sig) => { try { localStorage.setItem(ORDER_SIG(id), sig); } catch { /* private mode */ } };

/** Asks the server about a signed order until it is paid (90 s). Resolves `{ status: 'paid', order, tickets }` or `{ status: 'expired' }`. */
export async function waitPaid(orderId, signature) {
  for (let i = 0; i < 60; i++) {
    const r = await confirmOrder(orderId, signature);
    if (r.status === 'paid' || r.status === 'expired') return r;
    if (r.status !== 'pending') throw new Error(`unexpected order status: ${r.status}`);
    await sleep(1500);
  }
  throw new Error(`still not confirmed – your transaction ${signature} may land later; the tickets are credited when it does (reopen the lobby)`);
}

/** order → (gasless: sign, the server adds the sponsor's fee signature and sends | self-paid: sign and send) → confirmed. An expired blockhash is rebuilt ONCE automatically.
 *  Resolves the confirm result `{ status: 'paid', order, tickets }`. `onStep(text)` reports progress. Rejects with `{ notConfigured: true }` while sales are off. */
export async function buyTickets(poolId, qty, onStep = () => {}) {
  const p = provider(); if (!p) throw noWallet();   // before ordering: no stray orders
  const fees = await chainFees().catch(e => { if (e.notConfigured) throw e; return null; });   // only the fee LINE depends on it
  const w3 = await loadWeb3();
  onStep('Creating the order…');
  const order = await createOrder(poolId, qty);
  for (let attempt = 0; ; attempt++) {
    const pay = await orderPayment(order.id), tx = w3.Transaction.from(fromB64(pay.transaction));
    let signature;
    if (fees?.sponsored && typeof p.signTransaction === 'function') {
      onStep(`Approve ${sol(pay.lamports)} in your wallet – network fee: sponsored…`);
      try { ({ signature } = await submitOrder(order.id, await signOnly(p, tx))); } catch (e) {
        if (e.status !== 503 && e.status !== 429) throw e;   // sponsor empty / daily cap: pay the fee yourself – the server builds a self-paid transaction now
        onStep('The fee sponsor is unavailable – approve again and pay the network fee yourself (≈ 0.0001 SOL)…');
        signature = await selfPay(p, w3.Transaction.from(fromB64((await orderPayment(order.id)).transaction)));
      }
    } else {
      onStep(`Approve ${sol(pay.lamports)} in your wallet${fees ? ` – network fee ≈ ${sol(fees.estimatedFeeLamports)}` : ''}…`);
      signature = await selfPay(p, tx);
    }
    remember(order.id, signature);
    onStep('Waiting for the network to confirm…');
    const r = await waitPaid(order.id, signature);
    if (r.status === 'paid') return r;
    if (attempt) throw new Error('The network dropped your transaction twice – nothing was charged. Try again in a minute.');
    onStep('The network dropped the transaction (nothing was charged) – rebuilding it…');
  }
}

/** CLAIM REFUND on a failed pool: the server builds `fail_pool` (if still needed) + `refund(me)`; sponsored = the server pays the fee (a refund never costs the victim).
 *  Resolves the transaction signature. */
export async function claimRefund(poolId, onStep = () => {}) {
  const p = provider(); if (!p) throw noWallet();
  const w3 = await loadWeb3();
  onStep('Building the refund transaction…');
  const { transaction, sponsored } = await refundTransaction(poolId), tx = w3.Transaction.from(fromB64(transaction));
  onStep(`Approve the refund in your wallet${sponsored ? ' – network fee: sponsored' : ''}…`);
  return sponsored && typeof p.signTransaction === 'function' ? (await submitRefund(poolId, await signOnly(p, tx))).signature : selfPay(p, tx);
}
