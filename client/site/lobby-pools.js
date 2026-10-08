import { el } from './dom.js';
import { SITE_BASE } from '../js/hosts.js';
import { ESCROW_PAGE, explorerUrl, shortAddr, sol, usd, pct, plural, day, left, statusChip, progressText, deadline, splitParts, rulesText, tierTickets, buyRoom, cardAction, GRANT_SOURCE, STATUS_CLS } from './pools.js';

/* The lobby's escrowed-pool views (DOM; the decisions are the pure functions of pools.js). Countdowns are `.pcd[data-at]` – lobby.js ticks them every second. */

const addr = (a, label) => el('a', { href: explorerUrl(a), target: '_blank', rel: 'noopener', title: `${label}: ${a} (Solana explorer)` }, shortAddr(a), ' ↗');
const countdown = at => el('b', { class: 'pcd', 'data-at': at }, '');   // filled by lobby.js's 1 s tick
const chip = (p, now) => { const c = statusChip(p, now); return el('span', { class: `st ${c.cls}` }, c.text); };

/** One paid tier sold through an escrowed pool. ctx = { me, solUsd, now, busy, sales, qty, act: { ride, buy, refund, qty } }. */
export function poolCard(t, info, ctx) {
  const p = t.pool, now = ctx.now, tt = tierTickets(ctx.me.tickets, t.id), held = tt.rows.find(r => r.poolId === p.id), a = cardAction(p, tt, now);
  const room = buyRoom(p, held), q = Math.min(Math.max(1, ctx.qty), Math.max(1, room)), sellable = p.status === 'open' ? now < p.prepDeadline : p.status === 'active' && now < p.playDeadline;
  const dl = deadline(p, now), off = !!ctx.busy, mine = held?.balance ?? 0, other = tt.ridable - (p.status === 'active' ? mine : 0);
  const primary = a.kind === 'ride' ? el('button', { class: 'go', disabled: off, onclick: () => ctx.act.ride(t.id) }, a.text)
    : a.kind === 'refund' ? el('button', { class: 'go refund', disabled: off, onclick: () => ctx.act.refund(tt.refundable[0].poolId, t.id) }, a.text)
      : a.kind === 'wait' || a.kind === 'none' ? el('button', { class: 'go', disabled: true }, a.text) : '';
  const buyOff = off || !ctx.sales || !sellable || room <= 0;
  const buyRow = p.status === 'refunding' ? '' : el('div', { class: 'buy' },
    el('span', { class: 'qty', role: 'group', 'aria-label': 'tickets to buy' },
      el('button', { class: 'ghost', 'aria-label': 'one less', disabled: buyOff || q <= 1, onclick: () => ctx.act.qty(t.id, q - 1) }, '−'), el('b', {}, q),
      el('button', { class: 'ghost', 'aria-label': 'one more', disabled: buyOff || q >= room, onclick: () => ctx.act.qty(t.id, q + 1) }, '+')),
    el('button', { class: a.kind === 'buy' ? 'buyb' : 'buyb ghost', disabled: buyOff, onclick: () => ctx.act.buy(t.id, p.id, q) }, ctx.sales ? `BUY ${plural(q, 'TICKET', 'TICKETS')} · ${sol(p.priceLamports * q)}` : 'BUY TICKETS · SOON'));
  const note = p.status === 'refunding' ? 'This pool failed: every buyer gets the full price back from the vault – anyone can trigger it.'
    : !ctx.sales ? 'On-chain checkout opens soon – redeem a promo code meanwhile.' : room <= 0 ? `You hold the maximum of ${p.maxPerWallet} tickets for this pool.` : !sellable ? 'Sales for this pool are closed.' : 'Network fee: sponsored when available, else ≈ 0.0001 SOL.';
  return el('article', { class: `tier pooled${t.id === ctx.focus ? ' sel' : ''}`, id: `tier-${t.id}`, 'data-pool': p.id },
    el('div', { class: 'hd' }, el('span', { class: 'nm' }, info.name), chip(p, now)),
    el('span', { class: 'plabel' }, `${p.label} · pool #${p.id}`),
    el('span', { class: 'pr' }, sol(p.priceLamports), el('small', {}, ` per ticket ${usd(p.priceLamports, ctx.solUsd)}`)),
    el('span', { class: 'sub' }, info.shift),
    el('div', { class: 'prog', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': p.minTickets, 'aria-valuenow': Math.min(p.sold, p.minTickets), 'aria-label': 'tickets committed' }, el('i', { style: `width:${p.progressPct}%` })),
    el('span', { class: 'sub ptext' }, progressText(p, now)),
    dl.label ? el('span', { class: 'sub' }, dl.label, dl.at ? countdown(dl.at) : '') : '',
    el('span', { class: 'sub' }, 'in escrow ', el('b', { class: 'esc' }, sol(p.vaultLamports)), p.sponsoredLamports ? ` · sponsored ${sol(p.sponsoredLamports)}` : '', ` · ${plural(p.buyers, 'buyer')}`),
    el('div', { class: 'split' }, ...splitParts(p).map(s => el('i', { class: s.cls, style: `width:${s.bps / 100}%` }))),
    el('div', { class: 'legend' }, ...splitParts(p).map(s => el('span', { class: s.cls }, `${pct(s.bps)} ${s.label}`))),
    el('span', { class: 'sub addrs' }, 'pool ', addr(p.address, 'pool account'), ' · seed ', addr(p.treasuries.seed, 'seed treasury'), ' · fees ', addr(p.treasuries.fee, 'fee treasury')),
    el('span', { class: 'mine' }, 'your tickets: ', el('b', {}, mine), other > 0 ? ` (+${other} in another live ${info.name} pool)` : '', ` · max ${p.maxPerWallet} per wallet`),
    primary, buyRow,
    el('span', { class: 'dim fee' }, note),
    el('details', {}, el('summary', {}, 'RULES · WHY IT IS SAFE'), el('p', {}, rulesText(p), ' ', el('a', { href: `${SITE_BASE}${ESCROW_PAGE}`, target: '_blank', rel: 'noopener' }, 'How the escrow works →'))),
    el('p', { class: 'msg dim', id: `msg-${t.id}` }));
}

/** The box on top of NEW RIDE: what sits in escrow across the pools on sale (+ the legacy weekly round, fed only by pay-per-ride – hidden when the server
    is ticket-only, unless that round still holds entries from before). */
export function escrowSummary(pool, now, ticketOnly = false) {
  const pools = pool.pools ?? [], esc = pools.reduce((a, p) => a + p.vaultLamports, 0);
  return [
    el('div', { class: 'lbl' }, `PRIZE POOLS · IN ESCROW ON CHAIN`),
    el('div', { class: 'big' }, sol(esc)), el('div', { class: 'usd' }, pool.solUsd ? `${usd(esc, pool.solUsd)} at the current price` : ''),
    el('div', { class: 'dim' }, `${plural(pools.length, 'pool')} on sale · ${plural(pools.reduce((a, p) => a + p.sold, 0), 'ticket')} committed · held by the program, not by us · `, el('a', { href: `${SITE_BASE}${ESCROW_PAGE}`, target: '_blank', rel: 'noopener' }, 'how the escrow works →')),
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
    el('h2', {}, 'TICKET HISTORY'),
    p.grants.length ? el('div', { class: 'hist' }, p.grants.map(g => el('div', { class: 'hrow' },
      el('span', {}, new Date(g.at).toLocaleString(), ' · ', label(g.poolId), ' · ', GRANT_SOURCE[g.source] ?? g.source, g.ref ? el('small', { class: 'dim' }, ` ${g.ref.length > 16 ? shortAddr(g.ref) : g.ref}`) : ''),
      el('b', { class: g.delta > 0 ? 'good' : g.delta < 0 ? 'bad' : '' }, g.delta > 0 ? `+${g.delta}` : String(g.delta))))) : el('div', { class: 'card empty' }, 'Nothing yet. Every ticket you get, spend or get back shows up here.'),
  ];
}
