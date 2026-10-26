import { networkEvidenceText, fundingEvidenceText } from './trust-evidence.js';
/* The admin page's directory tabs: PLAYERS (list + one rider in full), POOLS (the on-chain mirror, read-only), STATS (the running totals), SESSIONS (who signed in lately).
   Read-only; a change goes through the signed forms (SETTINGS for free rides, PROMO CODES). Server text goes in with textContent only – ctx.el never touches innerHTML. */

const sol = l => `${(l / 1e9).toFixed(l >= 1e9 ? 3 : 4)} SOL`;
const km = m => (m / 1000).toFixed(1);
const hms = s => `${Math.floor(s / 3600)}h ${String(Math.floor(s / 60) % 60).padStart(2, '0')}m`;
const card = (el, ...kids) => el('div', { class: 'card', style: 'padding:6px 8px;overflow-x:auto' }, ...kids);
const table = (el, id, heads, rows) => card(el, el('table', { class: 'dense', id }, el('thead', {}, el('tr', {}, ...heads.map(h => el('th', {}, h)))), el('tbody', {}, rows)));
const kv = (el, ...pairs) => el('dl', { class: 'kv' }, pairs.flatMap(([k, v]) => [el('dt', {}, k), el('dd', {}, v)]));
const link = (el, href, text, title) => el('a', { href, class: 'mono', title }, text);
const tile = (el, v, l) => el('div', { class: 'tile' }, el('b', {}, v), el('span', {}, l));

/** the stats object of a rider / the game → the same key-value lines everywhere */
const statLines = (el, s) => kv(el, ['rides', `${s.rides} (${s.ridesFree} free · ${s.ridesPaid} paid · ${s.ridesCompleted} completed)`], ['driven', `${km(s.metres)} km · ${hms(s.seconds)}`],
  ['crashes', `${s.crashes} (${s.crashesVehicle} vehicle · ${s.crashesBuilding} building)`], ['donations', `${s.donations} · ${sol(s.donationLamports)}`]);

/* ───────── PLAYERS ───────── */
export async function playersTab(ctx, w = '') {
  if (w) return playerTab(ctx, w);
  const { api, el, view, time, ago, go } = ctx;
  const q = new URLSearchParams(location.search).get('q') ?? '';
  const input = el('input', { id: 'pl-q', placeholder: 'wallet starts with…', value: q, 'aria-label': 'wallet prefix', spellcheck: 'false', autocomplete: 'off' });
  const apply = () => { const p = new URLSearchParams(); if (input.value.trim()) p.set('q', input.value.trim()); history.replaceState(null, '', `${location.pathname}${p.size ? `?${p}` : ''}#players`); go(); };   // through go(): errors, the sign-in prompt and stale loads are handled there
  const { rows } = await api(`players?limit=100${q ? `&q=${encodeURIComponent(q)}` : ''}`);
  view.replaceChildren(el('h2', {}, `PLAYERS · ${rows.length}${rows.length === 100 ? '+' : ''}`),
    el('div', { class: 'filters' }, input, el('button', { onclick: apply }, 'FILTER')),
    rows.length ? table(el, 'pl-table', ['wallet', 'free rides', 'rides', 'tickets', 'last sign-in', 'joined'], rows.map(p => el('tr', { 'data-wallet': p.wallet },
      el('td', {}, link(el, `#players/${p.wallet}`, `${p.wallet.slice(0, 4)}…${p.wallet.slice(-4)}`, p.wallet)), el('td', {}, `${p.freeRides} / ${p.freeRidesMax}`), el('td', {}, p.rides), el('td', {}, p.tickets),
      el('td', { title: p.lastSignInAt ? time(p.lastSignInAt) : '' }, p.lastSignInAt ? ago(p.lastSignInAt) : '–'), el('td', { class: 'dim', title: time(p.createdAt) }, ago(p.createdAt)))))
      : el('div', { class: 'card empty' }, q ? 'No wallet starts with that.' : 'No players yet.'));
  input.addEventListener('keydown', e => { if (e.key === 'Enter') apply(); });
}

async function playerTab(ctx, w) {
  const { api, el, view, time, ago } = ctx;
  const d = await api(`players/${encodeURIComponent(w)}`);
  const p = d.player;
  view.replaceChildren(
    el('p', {}, el('a', { href: '#players' }, '← players'), ' · ', el('a', { href: `?wallet=${p.wallet}#rides` }, 'all rides'), ' · ', el('a', { href: `#signins/${p.wallet}` }, 'sign-ins'), ' · ', el('a', { href: `#settings/${p.wallet}`, id: 'pl-adjust' }, 'adjust free rides')),
    el('h2', {}, 'PLAYER'),
    card(el, kv(el, ['wallet', el('span', { class: 'mono' }, p.wallet)], ['free rides', `${p.freeRides} (the daily refill stops at ${p.freeRidesMax}; last grant day ${p.freeDay})`], ['joined', time(p.createdAt)],
      ['tutorial passed', p.tutorialPassedAt ? time(p.tutorialPassedAt) : 'never'],
      ['18+', p.age18At ? time(p.age18At) : 'never'], ['loss offer', p.lossAt ? time(p.lossAt) : 'never'],
      ['paid', `${d.payments.count} payment${d.payments.count === 1 ? '' : 's'} · ${sol(d.payments.lamports)}`])),
    el('h2', {}, 'REVIEW EVIDENCE'),
    el('p', { id: 'pl-funding-evidence', class: 'card' }, fundingEvidenceText(d.fundingEvidence)),
    el('p', { class: 'dim' }, 'Provider facts for manual review only. Shared networks or funding do not prove common ownership; these checks do not change trust scores.'),
    el('h2', {}, 'STATISTICS'), d.stats ? card(el, statLines(el, d.stats)) : el('div', { class: 'card empty' }, 'No finished ride yet.'),
    el('h2', {}, 'TICKETS'),
    d.tickets.length ? table(el, 'pl-tickets', ['pool', 'unused', 'bought'], d.tickets.map(t => el('tr', {}, el('td', {}, link(el, `#pools/${t.poolId}`, `#${t.poolId}`)), el('td', {}, t.balance), el('td', {}, t.bought)))) : el('div', { class: 'card empty' }, 'No tickets.'),
    d.grants.length ? table(el, 'pl-grants', ['when', 'pool', 'change', 'source', 'ref'], d.grants.map(g => el('tr', {}, el('td', { title: time(g.at) }, ago(g.at)), el('td', {}, `#${g.poolId}`), el('td', {}, `${g.delta > 0 ? '+' : ''}${g.delta}`), el('td', {}, g.source), el('td', { class: 'mono dim' }, g.ref ?? '–')))) : '',
    el('h2', {}, `LATEST RIDES · ${d.rides.length}`),
    d.rides.length ? table(el, 'pl-rides', ['ride', 'tier', 'status', 'verdict', 'created'], d.rides.map(r => el('tr', {}, el('td', {}, link(el, `#ride/${r.id}`, r.id.slice(0, 8))), el('td', {}, r.tier), el('td', {}, `${r.status}${r.reason ? ` – ${r.reason}` : ''}`), el('td', {}, r.verdict ?? '–'), el('td', { title: time(r.createdAt) }, ago(r.createdAt))))) : el('div', { class: 'card empty' }, 'No rides.'),
    el('h2', {}, `LATEST SIGN-INS · ${d.signIns.length}`),
    d.signIns.length ? table(el, 'pl-signins', ['when', 'subnet hash', 'network evidence'], d.signIns.map(s => el('tr', {}, el('td', { title: time(s.at) }, ago(s.at)), el('td', { class: 'mono', title: s.ipHash ?? 'Network signal unavailable' }, s.ipHash ? s.ipHash.slice(0, 12) + '…' : 'unavailable'), el('td', {}, networkEvidenceText(s.network))))) : el('div', { class: 'card empty' }, 'None on record (the log is pruned after SIGNIN_RETENTION_DAYS (at most 90 days)).'));
}

/* ───────── POOLS ───────── */
export async function poolsTab(ctx, id = '') {
  const { api, el, view, time, ago } = ctx;
  if (id) {
    const { pool: p, holders } = await api(`pools/${encodeURIComponent(id)}`);
    return view.replaceChildren(el('p', {}, el('a', { href: '#pools' }, '← pools')),
      el('h2', {}, `POOL #${p.id} · ${p.label}`),
      card(el, kv(el, ['status', p.status.toUpperCase()], ['address', el('span', { class: 'mono' }, p.address)], ['tier · price', `${p.tier} · ${sol(p.priceLamports)}`],
        ['tickets', `${p.ticketsSold} sold · min ${p.minTickets} · max ${p.maxTickets || 'unlimited'} · ${p.maxPerWallet} per wallet · ${p.buyers} buyers`], ['vault', `${sol(p.vaultLamports)} (sponsored ${sol(p.sponsored)})`],
        ['split', `prize ${p.prizeBps / 100} % · seed ${p.seedBps / 100} % · fee ${p.feeBps / 100} %`], ['treasuries', `fee ${p.feeTreasury} · seed ${p.seedTreasury}`],
        ['deadlines', `prepare by ${time(p.prepDeadline)} · play until ${time(p.playDeadline)}`], ['round · ride seed', `${p.roundId ?? '–'} · ${p.rideSeed}`], ['created · synced', `${time(p.createdAt)} · ${p.syncedAt ? time(p.syncedAt) : 'never'}`])),
      el('h2', {}, `TICKET HOLDERS · ${holders.length}`),
      holders.length ? table(el, 'pool-holders', ['wallet', 'unused', 'bought'], holders.map(h => el('tr', {}, el('td', {}, link(el, `#players/${h.wallet}`, `${h.wallet.slice(0, 4)}…${h.wallet.slice(-4)}`, h.wallet)), el('td', {}, h.balance), el('td', {}, h.bought)))) : el('div', { class: 'card empty' }, 'Nobody holds a ticket.'));
  }
  const { rows } = await api('pools?limit=100');
  view.replaceChildren(el('h2', {}, `POOLS · ${rows.length}`),
    el('p', { class: 'dim' }, 'The server\'s mirror of the on-chain pools – read-only. The money is in the program; creating, failing and closing a pool is done with the pool authority\'s wallet, not here.'),
    rows.length ? table(el, 'pool-table', ['pool', 'tier', 'status', 'tickets', 'price', 'vault', 'play until', 'created'], rows.map(p => el('tr', { 'data-pool': p.id },
      el('td', {}, link(el, `#pools/${p.id}`, `#${p.id}`, p.address)), el('td', {}, p.tier), el('td', {}, el('span', { class: `v ${p.status === 'active' ? 'verified' : p.status === 'open' ? 'flagged' : 'none'}` }, p.status.toUpperCase())),
      el('td', {}, `${p.ticketsSold} / ${p.maxTickets || '∞'} (min ${p.minTickets})`), el('td', {}, sol(p.priceLamports)), el('td', {}, sol(p.vaultLamports)), el('td', { title: time(p.playDeadline) }, time(p.playDeadline)), el('td', { class: 'dim', title: time(p.createdAt) }, ago(p.createdAt)))))
      : el('div', { class: 'card empty' }, 'No pools mirrored yet.'));
}

/* ───────── STATS ───────── */
export async function statsTab(ctx) {
  const { api, el, view, time } = ctx;
  const s = await api('stats?days=30&top=20');
  const g = s.global;
  view.replaceChildren(el('h2', {}, 'THE GAME, ALL TIME'),
    g ? el('div', { class: 'tiles', id: 'st-tiles' }, tile(el, g.rides, 'rides'), tile(el, g.drivers, 'drivers'), tile(el, `${km(g.metres)} km`, 'driven'), tile(el, hms(g.seconds), 'driving time'), tile(el, g.crashes, 'crashes'), tile(el, g.donations, `donations (${sol(g.donationLamports)})`))
      : el('div', { class: 'card empty' }, 'No ride has ended yet.'),
    g ? el('p', { class: 'dim' }, `${g.ridesFree} free · ${g.ridesPaid} paid · ${g.ridesCompleted} completed · totals written ${time(g.updatedAt)}. They are running totals – npm run stats:reconcile (the stats-reconcile skill) repairs drift.`) : '',
    el('h2', {}, `LAST ${s.daily.length} DAY${s.daily.length === 1 ? "" : "S"}`),
    s.daily.length ? table(el, 'st-daily', ['day (UTC)', 'rides', 'completed', 'km', 'crashes', 'donations'], [...s.daily].reverse().map(d => el('tr', {}, el('td', {}, d.day), el('td', {}, d.rides), el('td', {}, d.ridesCompleted), el('td', {}, km(d.metres)), el('td', {}, d.crashes), el('td', {}, d.donations)))) : el('div', { class: 'card empty' }, 'No days yet.'),
    el('h2', {}, 'TOP RIDERS · BY DISTANCE'),
    s.top.length ? table(el, 'st-top', ['#', 'rider', 'rides', 'completed', 'km', 'crashes'], s.top.map((r, i) => el('tr', {}, el('td', {}, i + 1), el('td', {}, link(el, `#players/${r.wallet}`, `${r.wallet.slice(0, 4)}…${r.wallet.slice(-4)}`, r.wallet)), el('td', {}, r.stats.rides), el('td', {}, r.stats.ridesCompleted), el('td', {}, km(r.stats.metres)), el('td', {}, r.stats.crashes)))) : el('div', { class: 'card empty' }, 'No rider has finished a ride yet.'));
}

/* ───────── SESSIONS ───────── */
export async function sessionsTab(ctx) {
  const { api, el, view, time, ago, go } = ctx;
  const days = Math.min(30, Math.max(1, Number(new URLSearchParams(location.search).get('days')) || 7));
  const { rows, truncated } = await api(`sessions?days=${days}`);
  const sel = el('select', { id: 'se-days', 'aria-label': 'window' }, [1, 3, 7, 14, 30].map(n => el('option', { value: n, selected: n === days }, `last ${n} day${n === 1 ? '' : 's'}`)));
  sel.addEventListener('change', () => { history.replaceState(null, '', `${location.pathname}?days=${sel.value}#sessions`); go(); });
  view.replaceChildren(el('h2', {}, `SESSIONS · ${rows.length} WALLET${rows.length === 1 ? '' : 'S'}`),
    el('p', { class: 'dim' }, 'Sessions are signed cookies (SESSION_TTL_DAYS, 7 by default) – there is no session table. These wallets signed in inside the window, so a cookie of theirs may still be alive. One session cannot be revoked; rotating JWT_SECRET signs everybody out.'),
    truncated ? el('p', { class: 'bad', id: 'se-truncated' }, 'More wallets signed in than one list shows: the ones whose last sign-in is oldest are left out. Pick a shorter window.') : '',
    el('div', { class: 'filters' }, sel),
    rows.length ? table(el, 'se-table', ['rider', 'last sign-in', 'sign-ins', 'subnet hash'], rows.map(r => el('tr', {}, el('td', {}, link(el, `#players/${r.wallet}`, `${r.wallet.slice(0, 4)}…${r.wallet.slice(-4)}`, r.wallet)), el('td', { title: time(r.lastAt) }, ago(r.lastAt)), el('td', {}, r.signIns), el('td', { class: 'mono', title: r.ipHash ?? 'Network signal unavailable' }, r.ipHash ? r.ipHash.slice(0, 12) + '…' : 'unavailable'))))
      : el('div', { class: 'card empty' }, 'Nobody signed in inside this window.'));
}
