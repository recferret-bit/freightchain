import { api, provider } from './wallet.js';
import { API_BASE } from '../js/hosts.js';

/* Paying for a ride: the server builds an unsigned SOL transfer (+ memo = ride id), the wallet signs and sends it, the server verifies it on chain.
   web3.js (IIFE build) is only loaded when a paid ride is actually bought – it is needed to turn the server's bytes into a Transaction the wallet accepts. */
const WEB3 = 'https://cdn.jsdelivr.net/npm/@solana/web3.js@1.99.0/lib/index.iife.min.js';
let web3;
const loadWeb3 = () => web3 ??= new Promise((ok, no) => {
  if (window.solanaWeb3) return ok(window.solanaWeb3);
  const s = document.createElement('script'); s.src = WEB3; s.onload = () => ok(window.solanaWeb3); s.onerror = () => { web3 = undefined; no(new Error('could not load web3.js (offline?)')); }; document.head.append(s);
});
const sleep = ms => new Promise(r => setTimeout(r, ms));

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
