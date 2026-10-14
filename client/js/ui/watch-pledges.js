import { el } from '../../site/dom.js';
import { api } from '../../site/wallet.js';
import { signAndSend } from '../../site/pay.js';
import { explorerTx } from '../../site/pools.js';
import { formatDriver } from '../../site/sns.js';

/* PLEDGES on a ticket ride (program create_pledge / settle_pledge / refund_pledge): a spectator locks SOL per km for the driver in a Pledge account of the
   pool program; the server's payout key attests THIS ride's verified km (v4: the ride's own attestation, public for the review lock) and, once the pool's review is
   over, settles – the driver gets rate × km (up to the cap), the rest and the account's rent go back to the sponsor. No finished, judged ride = everything back. The server never holds the money; it builds the
   transaction, the sponsor's wallet signs AND sends it, and the server reads it back (POST /api/pledges/:id/confirm). */
const STATE = { pending: 'waiting for the chain', active: 'locked on chain', settled: 'settled', refunded: 'refunded', abandoned: 'not signed' };
const sol = l => `${(Number(l) / 1e9).toFixed(Number(l) % 1e6 ? 6 : 3).replace(/0+$/, '').replace(/\.$/, '')} SOL`;
const sleep = ms => new Promise(r => setTimeout(r, ms));

/** the ride's pledges, one line each; mine (sponsor = me) highlighted */
export async function paintPledges(box, ride, me) {
  if (!box || ride.poolId === null || ride.poolId === undefined) return;
  let list = [];
  try { list = await api(`rides/${encodeURIComponent(ride.id)}/pledges`, undefined, { report: false }); } catch { return; }
  const shown = list.filter(p => p.status !== 'abandoned');
  if (!shown.length) { box.replaceChildren(el('div', { class: 'w-k' }, 'PLEDGES'), el('p', { class: 'dim w-small' }, ride.live ? 'No pledges yet – the first one could be yours.' : 'No pledges on this ride.')); return; }
  const locked = shown.filter(p => p.status === 'active').reduce((a, p) => a + Number(p.lamportsPerKm), 0);
  box.replaceChildren(el('div', { class: 'w-k' }, `PLEDGES · ${shown.length}${locked ? ` · ${sol(locked)} per km locked` : ''}`),
    ...shown.map(p => el('div', { class: `w-line${me && p.sponsor === me.wallet ? ' me' : ''}` },
      el('b', { title: p.sponsor }, `${formatDriver(p.sponsor)}: `), `${sol(p.lamportsPerKm)}/km up to ${p.targetKm} km (${sol(p.maxLamports)}) · ${STATE[p.status] ?? p.status}`,
      p.status === 'settled' ? ` · driver got ${sol(p.earnedLamports)}, back ${sol(p.refundedLamports)}` : p.status === 'refunded' ? ` · ${sol(p.refundedLamports)} back to the sponsor` : '',
      ...[p.createSignature && ['locked', p.createSignature], p.signature && [p.status === 'refunded' ? 'refund' : 'settle', p.signature]].filter(Boolean)
        .map(([k, s]) => [' ', el('a', { href: explorerTx(s), target: '_blank', rel: 'noopener', title: `the ${k} transaction on the Solana explorer (devnet)` }, `${k} ↗`)]).flat())));
}

/** the form: SOL per km + up to how many km; null when the ride takes no pledges */
export function pledgeForm(ride, say, onDone) {
  if (ride.poolId === null || ride.poolId === undefined) return null;
  const maxKm = Math.max(1, Math.ceil(ride.completeDist / 1000));
  const rate = el('input', { id: 'w-pl-rate', type: 'number', min: '0.000001', step: '0.0001', value: '0.001', 'aria-label': 'SOL per km', title: 'SOL per kilometre the driver verifiably drives' });
  const kmIn = el('input', { id: 'w-pl-km', type: 'number', min: '1', max: String(maxKm), step: '1', value: String(maxKm), 'aria-label': 'up to km', title: `at most ${maxKm} km – the end of this shift` });
  const btn = el('button', { id: 'w-pl-go', onclick: () => pledge(ride, rate, kmIn, btn, say, onDone) }, 'PLEDGE');
  return el('div', { class: 'w-pledge' },
    el('div', { class: 'w-k' }, 'PLEDGE PER KM · devnet SOL, locked in the pool program'),
    el('div', { class: 'w-say' }, rate, el('span', { class: 'dim w-small' }, 'SOL/km ×'), kmIn, el('span', { class: 'dim w-small' }, 'km'), btn),
    el('p', { class: 'dim w-small' }, 'The driver gets it for the km the server verifies after the pool\'s review; the rest comes back to you. No finished ride = all back.'));
}

let busy = false;
async function pledge(ride, rateIn, kmIn, btn, say, onDone) {
  if (busy) return;
  const lamportsPerKm = Math.round(Number(rateIn.value) * 1e9), targetKm = Math.floor(Number(kmIn.value));
  if (!(lamportsPerKm >= 1000) || !(targetKm >= 1)) { say('Pledge at least 0.000001 SOL per km for at least 1 km.', 'bad'); return; }
  busy = true; btn.disabled = true;
  try {
    say('Preparing the pledge…');
    const { pledge: p, transaction } = await api('pledges', { rideId: ride.id, lamportsPerKm: String(lamportsPerKm), targetKm });
    say(`Approve ${sol(p.maxLamports)} (devnet) + the account's rent in your wallet – both come back as the pledge settles…`);
    const signature = await signAndSend(transaction.transaction);
    say('Sent – waiting for the network to confirm…');
    for (let i = 0; i < 40; i++) {
      const r = await api(`pledges/${p.id}/confirm`, { signature }).catch(e => (e.status === 400 ? Promise.reject(e) : null));
      if (r?.status === 'active') { say(`Pledged ${sol(lamportsPerKm)}/km up to ${targetKm} km – locked on chain.`, 'good'); onDone(); return; }
      await sleep(1500);
    }
    say('The network has not confirmed it yet – it shows up here once it does.', 'dim');
    onDone();
  } catch (e) { say(e.message, 'bad'); }
  finally { busy = false; btn.disabled = false; }
}
