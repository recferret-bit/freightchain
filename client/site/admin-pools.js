import { explorerTx, explorerUrl, phaseLine, payoutText, poolSchedule, scheduleText, span } from './pools.js';

/* The admin page's POOLS tab (GET /api/admin/pools): every live pool and the newest settled ones – phase, sold / min, when the payout job pays, what it said last,
   the winners list the public sees, the rides still under review (a link into the REVIEW QUEUE for that pool) and the signed HOLD / RELEASE that stops the automatic payout.
   HOLD / RELEASE = ctx.signAt('pools/<id>/hold/challenge') → the wallet signs the server's text → POST pools/<id>/hold with the signature; audited (pool.hold / pool.release).
   Server text (labels, notes, wallets) goes in with textContent only – ctx.el never touches innerHTML. */

const PAYOUT_STATE = { pending: 'PENDING', waiting_review: 'WAITING FOR REVIEW', held: 'HELD', paying: 'PAYING', paid: 'PAID', no_winners: 'NO WINNERS', error: 'ERROR' };
const STATE_CLASS = { paid: 'verified', paying: 'verified', no_winners: 'none', pending: 'none', waiting_review: 'flagged', held: 'flagged', error: 'rejected' };
const sol = l => `${(l / 1e9).toFixed(4)} SOL`;

export async function poolsTab(ctx) {
  const { api, el, view, signAt, time, wallet } = ctx;
  const { pools } = await api('pools');
  const now = Date.now();

  const card = ({ pool: p, standings: st, hold }) => {
    const f = phaseLine(p, now), state = p.payout.state, holdable = (p.status === 'open' || p.status === 'active') && state !== 'paid';
    const note = el('textarea', { placeholder: 'note (why) – part of the signed text, kept in the audit log', maxlength: '300', 'aria-label': `hold note for pool ${p.id}` });
    const msg = el('p', { class: 'msg dim', role: 'status' });
    const setHold = async (on, btn) => {
      const text = note.value.trim(), n = text || null;   // the schema is nullable, not optional: the challenge and the change carry the SAME note (null when empty)
      btn.disabled = true; msg.className = 'msg dim'; msg.textContent = `Sign the ${on ? 'hold' : 'release'} in your wallet…`;
      try {
        const signature = await signAt(`pools/${p.id}/hold/challenge`, { action: 'pool_hold', hold: on, note: n });
        msg.textContent = 'Saving…';
        await api(`pools/${p.id}/hold`, { hold: on, note: n, signature });
        await poolsTab(ctx);   // reload the list: the payout state, the hold and the audit moved
      } catch (e) { btn.disabled = false; msg.className = 'msg bad'; msg.textContent = e.message; }
    };
    const holdBtn = el('button', { class: 'reject', 'data-act': 'hold', disabled: !holdable, title: holdable ? 'stop the automatic payout of this pool until you release it' : 'nothing to hold: the pool is paid or not live', onclick: e => setHold(true, e.currentTarget) }, hold ? 'HOLD AGAIN (NEW NOTE)' : 'HOLD PAYOUT');
    const releaseBtn = hold ? el('button', { 'data-act': 'release', onclick: e => setHold(false, e.currentTarget) }, 'RELEASE') : '';
    const sched = scheduleText(poolSchedule(p));
    return el('div', { class: 'card apool', id: `apool-${p.id}`, 'data-pool': p.id },
      el('div', { class: 'aphd' }, el('b', {}, `POOL #${p.id}`), el('span', {}, `${p.label} · ${p.tier}`), el('span', { class: `phase ${f.cls}` }, f.text),
        el('span', { class: `v ${STATE_CLASS[state] ?? 'none'}`, title: 'the payout job\'s last word on this pool' }, `PAYOUT ${PAYOUT_STATE[state] ?? state}`), hold ? el('span', { class: 'v flagged' }, 'ON HOLD') : ''),
      el('dl', { class: 'kv' },
        el('dt', {}, 'status · sold'), el('dd', {}, `${p.status} · ${p.sold} / ${p.minTickets} min${p.maxTickets ? ` (max ${p.maxTickets})` : ''} · ${p.buyers} buyers · escrow ${sol(p.vaultLamports)} · prizes ${sol(st.prizeLamports)}`),
        el('dt', {}, 'sale ends · rides until'), el('dd', {}, `${time(p.prepDeadline)} · ${time(p.playDeadline)}${sched ? ` (${sched})` : ''}`),
        el('dt', {}, 'payout at'), el('dd', {}, time(p.payoutAt), now < p.payoutAt ? ` – in ${span(p.payoutAt - now)}` : ''),
        el('dt', {}, 'payout job'), el('dd', {}, p.payout.note || payoutText({ ...p.payout, held: false }, st.underReview) || '–'),
        el('dt', {}, 'hold'), el('dd', {}, hold ? [wallet(hold.by), ` at ${time(hold.at)}`, hold.note ? ` – “${hold.note}”` : ''] : 'none'),
        el('dt', {}, 'under review'), el('dd', {}, st.underReview ? el('a', { href: `?pool=${p.id}#queue`, class: 'underrev' }, `${st.underReview} ride${st.underReview === 1 ? '' : 's'} → review queue`) : 'none – every completed ride of this pool is decided'),
        el('dt', {}, 'account'), el('dd', {}, el('a', { href: explorerUrl(p.address), target: '_blank', rel: 'noopener', class: 'mono' }, p.address))),
      el('h3', {}, `WINNERS · ${st.final ? 'FINAL (the payout job\'s plan)' : 'PROVISIONAL (verified rides now)'} · ${st.ranks.length}`),
      st.ranks.length ? el('div', { style: 'overflow-x:auto' }, el('table', { class: 'dense wtab' },
        el('thead', {}, el('tr', {}, ...['#', 'rider', 'km', 'rides', 'prize', 'paid'].map(h => el('th', { class: ['km', 'rides', 'prize'].includes(h) ? 'r' : null }, h)))),
        el('tbody', {}, st.ranks.map(r => el('tr', {}, el('td', {}, r.rank), el('td', {}, el('a', { href: `?wallet=${r.wallet}#rides` }, wallet(r.wallet))), el('td', { class: 'r' }, (r.distance / 1000).toFixed(2)),
          el('td', { class: 'r' }, r.rides), el('td', { class: 'r' }, sol(r.lamports)),
          el('td', {}, r.signature ? el('a', { href: explorerTx(r.signature), target: '_blank', rel: 'noopener', class: r.paid ? 'good' : 'warn' }, r.paid ? '✓ paid ↗' : 'sent ↗') : r.paid ? '✓ paid' : '–'))))))
        : el('p', { class: 'dim' }, now < p.playDeadline ? 'No verified finisher yet.' : 'No verified finisher – the payout job closes it with no winners.'),
      holdable || hold ? el('div', { class: 'actions' }, note, holdBtn, releaseBtn) : '',
      msg);
  };

  view.replaceChildren(el('h2', {}, `POOLS · ${pools.length}`),
    el('p', { class: 'dim' }, 'Live pools (soonest play deadline first), then the newest settled ones. After the review window the payout job pays the VERIFIED top 20 by itself – unless a ride of the pool is still under review or you HOLD it. A hold is signed and audited; a pool still held 14 days after its payout time is expired into refunds by the crank.'),
    ...(pools.length ? pools.map(card) : [el('div', { class: 'card empty' }, 'No pools yet.')]));
}
