import { el } from './dom.js';
import { escrowExplainer, explorerUrl, explorerTx, shortAddr, sol, usd, pct, plural, day, left, statusChip, progressText, deadline, splitParts, rulesText, tierTickets, canRide, hhmm, buyRoom, cardAction, GRANT_SOURCE, STATUS_CLS, phaseLine, payoutText, poolSchedule, scheduleText, span } from './pools.js';

/* The lobby's escrowed-pool views (DOM; the decisions are the pure functions of pools.js). Countdowns are `.pcd[data-at]` – lobby.js ticks them every second. */

const addr = (a, label) => el('a', { href: explorerUrl(a), target: '_blank', rel: 'noopener', title: `${label}: ${a} (Solana explorer)` }, shortAddr(a), ' ↗');
const countdown = at => el('b', { class: 'pcd', 'data-at': at }, '');   // filled by lobby.js's 1 s tick
const chip = (p, now) => { const c = statusChip(p, now); return el('span', { class: `st ${c.cls}` }, c.text); };
/** "ON SALE · 14 h left" – the countdown is a `.phcd[data-at]` (lobby.js ticks it in the coarse format). */
const phase = (p, now) => { const f = phaseLine(p, now); return el('span', { class: `phase ${f.cls}` }, f.head, f.at ? [' · ', f.pre, el('b', { class: 'phcd', 'data-at': f.at }, span(f.at - now)), f.post] : ''); };
const schedule = (p, s) => { const t = scheduleText(s ?? poolSchedule(p)); return t ? el('span', { class: 'sub sched' }, t) : ''; };

/* the real tier, then the shorter ride a demo wallet actually drives */
export function paidShift(info) {
  return [el('span', { class: 'sub' }, info.shift), info.driven ? el('span', { class: 'sub demo' }, 'this ride ', el('b', {}, info.driven)) : ''];
}

/** One paid tier sold through an escrowed pool. ctx = { me, solUsd, now, busy, sales, qty, act: { ride, buy, refund, qty } }. */
export function poolCard(t, info, ctx) {
  const p = t.pool, now = ctx.now, tt = tierTickets(ctx.me.tickets, t.id, now), held = tt.rows.find(r => r.poolId === p.id), a = cardAction(p, tt, now);
  const room = buyRoom(p, held), q = Math.min(Math.max(1, ctx.qty), Math.max(1, room)), sellable = phaseLine(p, now).phase === 'selling';   // the sale ends at prepDeadline, open or active alike
  const dl = deadline(p, now), off = !!ctx.busy, mine = held?.balance ?? 0, other = tt.ridable - (held && canRide(held, now) ? mine : 0);
  const primary = a.kind === 'ride' ? el('button', { class: 'go', disabled: off, onclick: () => ctx.act.ride(t.id) }, a.text)
    : a.kind === 'refund' ? el('button', { class: 'go refund', disabled: off, onclick: () => ctx.act.refund(tt.refundable[0].poolId, t.id) }, a.text)
      : a.kind === 'wait' || a.kind === 'none' ? el('button', { class: 'go', disabled: true }, a.text) : '';
  const buyOff = off || !ctx.sales || !sellable || room <= 0;
  const buyRow = !sellable ? '' : el('div', { class: 'buy' },
    el('span', { class: 'qty', role: 'group', 'aria-label': 'tickets to buy' },
      el('button', { class: 'ghost', 'aria-label': 'one less', disabled: buyOff || q <= 1, onclick: () => ctx.act.qty(t.id, q - 1) }, '−'), el('b', {}, q),
      el('button', { class: 'ghost', 'aria-label': 'one more', disabled: buyOff || q >= room, onclick: () => ctx.act.qty(t.id, q + 1) }, '+')),
    el('button', { class: a.kind === 'buy' ? 'buyb' : 'buyb ghost', disabled: buyOff, onclick: () => ctx.act.buy(t.id, p.id, q) }, ctx.sales ? `BUY ${plural(q, 'TICKET', 'TICKETS')} · ${sol(p.priceLamports * q)}` : 'BUY TICKETS · SOON'));
  const note = p.status === 'refunding' ? 'This pool failed: every buyer gets the full price back from the vault – anyone can trigger it.'
    : !sellable ? 'Sales for this pool are closed – the next pool of this shift opens on its schedule.' : !ctx.sales ? 'On-chain checkout opens soon – redeem a promo code meanwhile.' : room <= 0 ? `You hold the maximum of ${p.maxPerWallet} tickets for this pool.` : '';
  const progress = p.status === 'open' ? `${p.sold} / ${p.minTickets} committed` : progressText(p, now);   // the chip already says "needs N more"
  return el('article', { class: `tier pooled${t.id === ctx.focus ? ' sel' : ''}`, id: `tier-${t.id}`, 'data-pool': p.id },
    el('div', { class: 'hd' }, el('span', { class: 'nm' }, info.name), chip(p, now)),
    el('span', { class: 'pr' }, sol(p.priceLamports), el('small', {}, ` per ticket ${usd(p.priceLamports, ctx.solUsd)}`)),
    ...paidShift(info),
    el('div', { class: 'prog', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': p.minTickets, 'aria-valuenow': Math.min(p.sold, p.minTickets), 'aria-label': 'tickets committed' }, el('i', { style: `width:${p.progressPct}%` })),
    el('span', { class: 'sub ptext' }, progress, ' · in escrow ', el('b', { class: 'esc' }, sol(p.vaultLamports))),
    phase(p, now),
    el('span', { class: 'mine' }, 'your tickets: ', el('b', {}, mine), other > 0 ? ` (+${other} in another live ${info.name} pool)` : '', ` · max ${p.maxPerWallet}`),
    tt.rideBy ? el('span', { class: 'sub ride-by' }, `start by ${hhmm(tt.rideBy)} · `, countdown(tt.rideBy)) : '',   // the ticket is spent when the ride is ordered: order it before this
    ...tt.closed.map(c => el('span', { class: 'sub closed' }, `${plural(c.balance, 'unused ticket')} of pool #${c.poolId} expired – the last start was ${hhmm(c.rideBy)}; a ticket counts only in its own pool`)),
    primary, buyRow,
    note ? el('span', { class: 'dim fee' }, note) : '',
    ctx.winners ? winners(ctx.winners, ctx.me.wallet, now) : '',
    el('details', {}, el('summary', {}, 'DETAILS · RULES'),
      el('span', { class: 'sub' }, `${p.label} · pool #${p.id} · ${plural(p.buyers, 'buyer')}`, p.sponsoredLamports ? ` · sponsored ${sol(p.sponsoredLamports)}` : ''),
      schedule(p, t.schedule),
      p.status === 'open' && dl.label ? el('span', { class: 'sub' }, dl.label, dl.at ? countdown(dl.at) : '') : '',
      el('div', { class: 'split' }, ...splitParts(p).map(s => el('i', { class: s.cls, style: `width:${s.bps / 100}%` }))),
      el('div', { class: 'legend' }, ...splitParts(p).map(s => el('span', { class: s.cls }, `${pct(s.bps)} ${s.label}`))),
      el('span', { class: 'sub addrs' }, 'pool ', addr(p.address, 'pool account'), ' · seed ', addr(p.treasuries.seed, 'seed treasury'), ' · fees ', addr(p.treasuries.fee, 'fee treasury')),
      el('p', {}, rulesText(p), ' On top of the price: the network fee (≈ 0.0001 SOL) and a Ticket account deposit (≈ 0.0015 SOL, returned when the ticket is refunded or closed). ', el('a', { href: escrowExplainer(), target: '_blank', rel: 'noopener' }, 'How the escrow works →'))),
    el('p', { class: 'msg dim', id: `msg-${t.id}` }));
}

/** A pool whose sale is over (rides counting, in review, paying, or settled): its phase, what the payout job says and its winners list.
    st = PoolStandingsDto (undefined = loading, null = could not load). */
export function resultCard(p, st, ctx) {
  const now = ctx.now;
  return el('article', { class: 'tier result', id: `result-${p.id}`, 'data-pool': p.id },
    el('div', { class: 'hd' }, el('span', { class: 'nm' }, ctx.name(p.tier)), chip(p, now)),
    el('span', { class: 'plabel' }, `${p.label} · pool #${p.id} · `, addr(p.address, 'pool account')),
    phase(p, now),
    el('span', { class: 'sub' }, `${plural(p.sold, 'ticket')} · ${plural(p.buyers, 'buyer')} · rides counted until ${day(p.playDeadline)}`, p.status === 'settled' ? '' : [' · in escrow ', el('b', { class: 'esc' }, sol(p.vaultLamports))]),
    st === undefined ? el('span', { class: 'sub' }, 'Loading the winners…') : st === null ? el('span', { class: 'sub bad' }, 'Winners list unavailable right now.') : winners(st, ctx.me.wallet, now));
}

const SHOWN = 5;   // ranks shown before "all 20" – a phone stays short
/** The winners list of a pool (GET /api/pools/:id/standings): PROVISIONAL until the payout job fixed it, ✓ PAID with the transaction once sent. */
export function winners(st, me, now) {
  const head = now < st.playDeadline ? 'LEADERS' : 'WINNERS', mine = st.ranks.find(r => r.wallet === me);
  const note = st.payout.state === 'waiting_review' && !st.payout.held && st.underReview > 0 && !st.final ? '' : payoutText(st.payout, st.underReview);   // the under-review line below says it
  const row = r => el('li', { class: r.wallet === me ? 'me' : '' },
    el('span', { class: 'rk' }, `#${r.rank}`), el('span', { class: 'wl', title: r.wallet }, r.wallet === me ? 'YOU' : shortAddr(r.wallet)),
    el('span', { class: 'km' }, `${(r.distance / 1000).toFixed(1)} km`), el('span', { class: 'amt' }, sol(r.lamports)),
    el('span', { class: 'pd' }, r.paid && r.signature ? el('a', { href: explorerTx(r.signature), target: '_blank', rel: 'noopener', title: `pay_prize ${r.signature} (Solana explorer)` }, '✓ PAID ↗') : r.paid ? '✓ PAID' : ''));
  return el('div', { class: 'winners' },
    el('div', { class: 'whd' }, el('b', {}, head), el('span', { class: `st ${st.final ? 'live' : 'open'}` }, st.final ? 'FINAL' : 'PROVISIONAL'), el('small', {}, `prizes ${sol(st.prizeLamports)}`)),
    note ? el('span', { class: `sub wnote${st.payout.held || st.payout.state === 'error' ? ' bad' : ''}` }, note) : '',
    st.underReview > 0 && !st.final ? el('span', { class: 'sub wwarn' }, `${plural(st.underReview, 'ride')} still under review – the list can change`) : '',
    st.ranks.length ? el('ol', { class: 'wlist' }, st.ranks.slice(0, SHOWN).map(row)) : el('span', { class: 'sub' }, now < st.playDeadline ? 'No verified finisher yet – the first one leads.' : 'No verified finisher in this pool.'),
    st.ranks.length > SHOWN ? el('details', {}, el('summary', {}, `ALL ${st.ranks.length} RANKS${mine && mine.rank > SHOWN ? ` · YOU ARE #${mine.rank}` : ''}`), el('ol', { class: 'wlist' }, st.ranks.slice(SHOWN).map(row))) : '',
    st.final ? '' : el('span', { class: 'dim fee' }, now < st.payoutAt ? `Ranked by verified distance. Fixed when the review ends (${day(st.payoutAt)}), then paid automatically.` : 'Ranked by verified distance – fixed and paid by the payout job once nothing holds it.'));
}

/** The box on top of NEW RIDE: what sits in escrow across the pools on sale (+ the legacy weekly round, fed only by pay-per-ride – hidden when the server
    is ticket-only, unless that round still holds entries from before). */
export function escrowSummary(pool, now, ticketOnly = false) {
  const pools = pool.pools ?? [], esc = pools.reduce((a, p) => a + p.vaultLamports, 0);
  return [
    el('div', { class: 'lbl' }, `PRIZE POOLS · IN ESCROW ON CHAIN`),
    el('div', { class: 'big' }, sol(esc)), el('div', { class: 'usd' }, pool.solUsd ? `${usd(esc, pool.solUsd)} at the current price` : ''),
    el('div', { class: 'dim' }, `${plural(pools.length, 'pool')} on sale · ${plural(pools.reduce((a, p) => a + p.sold, 0), 'ticket')} committed · held by the program, not by us · `, el('a', { href: escrowExplainer(), target: '_blank', rel: 'noopener' }, 'how the escrow works →')),
    ticketOnly && !pool.entries ? '' : el('div', { class: 'dim' }, `Weekly round (pay-per-ride tiers): ${sol(pool.split.grand)} grand prize accrued · ${plural(pool.entries, 'paid entry', 'paid entries')} · closes in `, el('b', { id: 'cd', class: 'cd' }, left(pool.round.endsAt - now))),
  ];
}

/** Failed pools this wallet paid into that no tier card shows any more: each gets its own CLAIM REFUND. details = { [poolId]: PrizePoolDto } (fetched lazily). */
export function refundRows(rows, details, busy, onRefund) {
  return rows.map(r => {
    const d = details[r.poolId];
    return el('div', { class: 'note refund' },
      el('span', {}, el('b', {}, `${r.label} (pool #${r.poolId}) failed`), ` – you paid for ${plural(r.bought, 'ticket')}; the vault returns the full price.`, d ? [' Pool ', addr(d.address, 'pool account'), d.prepDeadline ? ` · goal deadline was ${day(d.prepDeadline)}` : ''] : ''),
      el('button', { disabled: !!busy, onclick: () => onRefund(r.poolId, `refund-${r.poolId}`) }, 'CLAIM REFUND'),
      el('p', { class: 'msg dim', id: `msg-refund-${r.poolId}` }));
  });
}

/** PROFILE: the wallet's tickets per pool + the audit trail of every ticket grant / spend / void. */
export function profileTickets(p, busy, onRefund) {
  const label = id => p.tickets.find(t => t.poolId === id)?.label ?? `pool #${id}`;
  return [
    el('h2', {}, 'TICKETS'),
    p.tickets.length ? el('div', { class: 'card' }, el('table', { class: 'tix' },
      el('thead', {}, el('tr', {}, el('th', {}, 'POOL'), el('th', {}, 'STATUS'), el('th', { class: 'r' }, 'LEFT'), el('th', { class: 'r' }, 'BOUGHT'), el('th', { class: 'r' }, 'CAP'), el('th', {}, ''))),
      el('tbody', {}, p.tickets.map(t => el('tr', {},
        el('td', {}, t.label, el('small', { class: 'dim' }, ` #${t.poolId}`)), el('td', {}, el('span', { class: `st ${STATUS_CLS[t.status] ?? 'done'}` }, t.status.toUpperCase())),
        el('td', { class: 'r' }, t.balance), el('td', { class: 'r' }, t.bought), el('td', { class: 'r' }, t.cap),
        el('td', { class: 'r' }, t.refundable ? el('button', { class: 'ghost', disabled: !!busy, onclick: () => onRefund(t.poolId, 'profile') }, 'CLAIM REFUND') : '')))))) : el('div', { class: 'card empty' }, 'No tickets yet – redeem a promo code or buy one on NEW RIDE.'),
    el('p', { class: 'msg dim', id: 'msg-profile' }),
    el('h2', { class: 'sub' }, 'TICKET HISTORY'),
    p.grants.length ? el('div', { class: 'hist' }, p.grants.map(g => el('div', { class: 'hrow' },
      el('span', {}, new Date(g.at).toLocaleString(), ' · ', label(g.poolId), ' · ', GRANT_SOURCE[g.source] ?? g.source, g.ref ? el('small', { class: 'dim' }, ` ${g.ref.length > 16 ? shortAddr(g.ref) : g.ref}`) : ''),
      el('b', { class: g.delta > 0 ? 'good' : g.delta < 0 ? 'bad' : '' }, g.delta > 0 ? `+${g.delta}` : String(g.delta))))) : el('div', { class: 'card empty' }, 'Nothing yet. Every ticket you get, spend or get back shows up here.'),
  ];
}
