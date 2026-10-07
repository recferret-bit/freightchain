import { api, provider } from './wallet.js';
import { API_BASE } from '../js/hosts.js';
import { track } from '../js/analytics.js';

/* Paying for a ride: the server builds an unsigned SOL transfer (+ memo = ride id), the wallet signs and sends it, the server verifies it on chain.
   web3.js (IIFE build) is only loaded when a paid ride is actually bought – it is needed to turn the server's bytes into a Transaction the wallet accepts. */
const WEB3 = 'https://cdn.jsdelivr.net/npm/@solana/web3.js@1.99.0/lib/index.iife.min.js';
let web3;
const loadWeb3 = () => web3 ??= new Promise((ok, no) => {
  if (window.solanaWeb3) return ok(window.solanaWeb3);
  const s = document.createElement('script'); s.src = WEB3; s.onload = () => ok(window.solanaWeb3); s.onerror = () => { web3 = undefined; no(new Error('could not load web3.js (offline?)')); }; document.head.append(s);
});
const sleep = ms => new Promise(r => setTimeout(r, ms));
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
