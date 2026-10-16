import '../js/crash-boot.js';   // before the lobby's modules: a throw while they load is still reported
import { api, signOut } from './wallet.js';
import { buyRide, buyTickets, claimRefund, waitPaid, ORDER_SIG } from './pay.js';
import { salesOpen, pendingOrder, reconcileOrder } from './tickets-api.js';
import { paidChip, escrowExplainer, explorerTx, explorerUrl, rideError, promoError, promoOk, buyError, sol, usd, left, span, hasStandings, progressText, ticketShareText, xIntent, shortAddr as short } from './pools.js';
import { poolCard, paidShift, resultCard, escrowSummary, refundRows, profileTickets } from './lobby-pools.js';
import { careerTiles } from './lobby-career.js';
import { achievementsSection } from './lobby-achievements.js';
import { agreementsCard, blockPaid } from './lobby-agreements.js';
import { redemptionList } from './lobby-promo.js';
import { dirty, garageActions, garageDetail, garageProgress, garageSlots, partAt, previewLoadout } from './lobby-garage.js';
import { garageCab } from './garage-cab.js';
import { el } from './dom.js';
import { livePath, leaveOnClose } from './presence.js';
import { renderReplays } from './lobby-replays.js';
import { renderBoard } from './lobby-board.js';
import { API_BASE, GAME_BASE, SITE_BASE } from '../js/hosts.js';
import { homeBlinkUrl } from '../js/ui/share.js';
import { track, flushSoon } from '../js/analytics.js';
import { reportWebVitals } from '../js/web-vitals.js';
import { store } from '../js/util.js';
import { TOKEN_SYMBOL } from '../js/config.js';
import { FREE_COUNTRIES } from '../js/free-countries.js';
import { isMobileDevice, showMobileToast } from '../js/mobile.js';
import { ticketDialog, hideTicketDialog } from './ticket-dialog.js';
import { formatDriver, getCachedSns, reverseResolveSns, seedSns } from './sns.js';

/* The lobby: NEW RIDE · LIVE · REPLAYS · LEADERBOARD · ACHIEVEMENTS · GARAGE · PROFILE. Vanilla DOM, no framework.
   Everything that comes from the server (wallet addresses, route ids, statuses…) goes in with textContent – never innerHTML – because other riders' data is rendered here. */
reportWebVitals('lobby');   // before the session check, so a bounce back to the landing still reports the load
const $ = id => document.getElementById(id);
const view = $('view');
const ROUTES = { route66: 'Route 66', stuart: 'Stuart Hwy', siberia: 'Trans-Siberian', brenner: 'Brenner Pass', panamerican: 'Pan-American' };   // = client/js/themes ids
const TIER_NAME = { free: 'TEST RIDE', '1h': '1 HOUR', '4h': '4 HOURS', '8h': '8 HOURS' };
const TABS = ['new', 'live', 'replays', 'board', 'achievements', 'garage', 'profile'];
const TAB_ALIAS = { promo: 'profile' };   // the old PROMO tab (the landing's invite link, bookmarks) lives in the PROFILE now

/* ───────── helpers ───────── */
const hue = w => { let h = 0; for (const c of w) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
const avatar = w => el('span', { class: 'av', style: `background:hsl(${hue(w)} 60% 50%)` });
const pad = n => String(Math.floor(n)).padStart(2, '0');
const dur = s => { s = Math.max(0, Math.round(s)); return s >= 3600 ? `${Math.floor(s / 3600)}:${pad((s % 3600) / 60)}:${pad(s % 60)}` : `${Math.floor(s / 60)}:${pad(s % 60)}`; };
const km = m => (m / 1000).toFixed(m < 10_000 ? 2 : 1);

/* ───────── state ───────── */
const S = { me: null, tiers: null, pool: null, live: { rides: [] }, liveAt: 0, skew: 0, board: 'free', boardLevel: Number(store.get('freightchain.board-level')) || 3, boardTier: store.get('freightchain.board-tier') === '4h' || store.get('freightchain.board-tier') === '8h' ? store.get('freightchain.board-tier') : '1h', pending: null, pendingNote: '', pools: null, standings: {}, stAt: {}, tab: 'new', busy: null, qty: {}, msgs: {}, poolInfo: {}, order: null, focus: null, opt: { tutorial: null, assist: store.get('freightchain.assist') !== '0', level: Number(store.get('freightchain.level')) || 1 } };   // opt = the free ride's level + two checkboxes: tutorial null = follow the server (on until a ride was started with it), assist and the level are remembered here
let seq = 0;   // one number per tab render: an answer that comes back after the player moved on (or re-asked) is dropped, not painted over the new tab
const now = () => Date.now() + S.skew;   // server clock (skew learned from /api/live)
const freeLeft = m => `${m.freeRides}/${m.freeRidesMax} free ride${m.freeRides === 1 ? '' : 's'}`;   // always balance/daily cap. A surplus (signup, a promo, an admin grant) stays; the refill stops at the cap
const freeCd = m => m.nextFreeRideAt == null ? 'full' : `+1 in ${left(m.nextFreeRideAt - now())}`;   // the daily credit lands at 00:00 UTC, up to the cap

const paintPaid = m => { $('chip-paid').textContent = paidChip(m.tickets); };
let meGen = 0;   // a slower /api/me from before a buy must not paint the old ticket count over the new one
const takeMe = m => { S.me = m; paintHeader(); if ($('tiers')) paintTiers(); };
const refreshMe = () => { const gen = ++meGen; return api('me').then(m => { if (gen === meGen) takeMe(m); return m; }, () => {}); };
/** The confirm already credited these on the server. Paint them now; the refresh that follows replaces this with /api/me. */
const creditLocal = (poolId, qty) => {
  if (!S.me || !qty) return;
  meGen++;
  const rows = S.me.tickets ?? (S.me.tickets = []);
  const row = rows.find(t => t.poolId === poolId);
  if (row) { row.balance += qty; row.bought += qty; }
  else {
    const tier = S.tiers?.tiers.find(t => t.pool?.id === poolId), p = tier?.pool;
    rows.push({ poolId, tier: tier?.id ?? '', label: p?.label ?? '', status: p?.status === 'active' ? 'active' : 'open', balance: qty, bought: qty, cap: p?.maxPerWallet ?? 0, refundable: false });
  }
  paintHeader();
};

function paintHeader() {
  const m = S.me;
  if (m.sns) seedSns(m.wallet, m.sns);
  $('chip-wallet').replaceChildren(el('span', { class: 'dot', style: `background:hsl(${hue(m.wallet)} 60% 50%)` }), formatDriver(m.wallet, m.sns));
  $('chip-wallet').title = m.wallet;
  $('chip-free').textContent = `${freeLeft(m)} · ${freeCd(m)}`;
  paintPaid(m);
  $('chip-live').textContent = liveChip();
}

function go() {
  const t = location.hash.slice(1).split('/')[0];
  const tab = TAB_ALIAS[t] ?? t; S.tab = TABS.includes(tab) ? tab : 'new'; seq++;
  track('lobby_tab_viewed', { tab: S.tab });   // hash enter, not the 1 s tick
  document.querySelectorAll('.tabs a').forEach(a => { const on = a.dataset.tab === S.tab; a.classList.toggle('on', on); a.setAttribute('aria-selected', on); });
  ({ new: renderNew, live: renderLive, replays: () => renderReplays(view, { me: S.me, ROUTES, TIER_NAME, dur, km, avatar }), board: () => renderBoard(view, { S, now, track, km, dur, avatar }), achievements: renderAchievements, garage: renderGarage, profile: renderProfile })[S.tab]();
}

/* ───────── NEW RIDE ─────────
   One card per shift. A paid tier with an escrowed pool (tiers[].pool) is ridden with a TICKET (RIDE spends one, the ride is ready at once); buying tickets / refunds go through
   pay.js → tickets-api.js (not built server-side yet: shown as SOON). A paid tier without a pool is the SOON card when it is not on sale, and the legacy pay-per-ride order when it is. */
function renderNew() {
  view.replaceChildren(
    el('div', { class: 'card pool', id: 'poolbox', hidden: true, style: 'display:none' }), el('div', { id: 'pendingbox' }), el('div', { id: 'orderbox' }), el('div', { id: 'refunds' }),
    el('div', { id: 'freebox' }),
    el('h2', {}, 'PAID SHIFTS · COMING SOON'), el('div', { class: 'tiers', id: 'tiers' }), el('div', { id: 'results' }),
    el('div', { class: 'card', id: 'rules', style: 'margin-top:12px' }));
  paintPool(); paintPending(); paintTiers(); paintRules();
  refreshMe();   // free-ride count + tickets after a ride / refund
  if (salesOpen(S.tiers)) checkOrder();
}

function paintPool() {
  const box = $('poolbox'), p = S.pool; if (!box) return;
  if (!p) { box.hidden = true; box.style.display = 'none'; return; }
  if (p.pools?.length) {
    box.hidden = false; box.style.display = '';
    box.replaceChildren(...escrowSummary(p, now(), salesOpen(S.tiers)));
    return;
  }
  // Temporarily hide the weekly accrued round while devnet is not active
  box.hidden = true; box.style.display = 'none';
}

async function checkPending() {
  try {
    let { ride } = await api('rides/pending', undefined, { report: false });
    if (ride && ride.status !== 'created') {   // an order that may have been paid with the page closed: look for the payment ONCE
      S.pendingNote = 'Checking for an earlier payment…'; paintPending();
      const r = await api(`rides/${ride.id}/reconcile`, {}); ride = r.status === 'paid' ? r.ride : null;
      S.pendingNote = ride ? 'Your earlier payment was found.' : '';
    }
    S.pending = ride?.status === 'created' ? ride : null;
  } catch (e) { S.pendingNote = `Could not check for earlier payments (${e.message}).`; }
  paintPending(); paintTiers();
}
const pendingShown = new Set();   // one pending_ride_shown per ride per load
function paintPending() {
  const box = $('pendingbox'); if (!box) return;
  const r = S.pending;
  if (r && !pendingShown.has(r.id)) { pendingShown.add(r.id); track('pending_ride_shown', { ride_id: r.id, tier_id: r.tier }); }
  const startIt = () => {
    if (isMobileDevice()) {
      showMobileToast({
        liveAction: () => { location.hash = '#live'; },
        replaysAction: () => { location.hash = '#replays'; },
      });
      return;
    }
    if (r.tier !== 'free' && blockPaid(S.me)) return;
    track('pending_ride_start_clicked', { ride_id: r.id });
    flushSoon();
    location.href = `${GAME_BASE}/play.html?ride=${r.id}`;
  };
  box.replaceChildren(r ? el('div', { class: 'note' }, el('span', {}, el('b', {}, `Your paid ${TIER_NAME[r.tier] ?? r.tier} ride is waiting`), S.pendingNote ? ` · ${S.pendingNote}` : ''), el('button', { onclick: startIt }, 'START IT')) : S.pendingNote ? el('p', { class: 'dim' }, S.pendingNote) : '');
}

/* a ticket payment in flight (GET /api/tickets/pending – only once sales are on): RETRY CONFIRM uses the signature this browser kept */
async function checkOrder() {
  try {
    let order = (await pendingOrder()).order;
    if (order && order.status !== 'paid') {
      const looked = await reconcileOrder(order.id).catch(() => null); // a phone may have paid after this page closed; no signature was stored here
      if (looked?.status === 'paid') { await paidTickets(order, looked.order); order = null; }
      else if (looked?.order) order = looked.order;
    }
    S.order = order && order.status !== 'paid' ? order : null;
  } catch { S.order = null; }
  paintOrder();
}
async function paidTickets(order, paid) {
  creditLocal(order.poolId, order.qty);
  await Promise.all([refreshMe(), refreshPool()]);
  creditDialog(order.poolId, order.qty, { lamports: paid?.lamports ?? order.lamports, signature: paid?.signature ?? null });
}
function paintOrder() {
  const box = $('orderbox'), o = S.order; if (!box) return;
  if (!o || o.status === 'paid') { box.replaceChildren(); return; }
  let sig = o.signature; try { sig ??= localStorage.getItem(ORDER_SIG(o.id)); } catch { /* private mode */ }
  const retry = () => busy('order', async () => {
    try {
      const looked = await reconcileOrder(o.id).catch(() => null);
      const r = looked?.status === 'paid' ? looked : (sig ? await waitPaid(o.id, sig) : looked);
      S.order = r?.status === 'paid' ? null : (r?.order ?? o);
      if (r?.status === 'paid') { await paidTickets(o, r.order); return; }
    } catch (e) { const line = buyError(e); say('order', line, true); failDialog(S.tiers?.tiers.find(t => t.pool?.id === o.poolId)?.id, line); }
    paintOrder();
  });
  // with a signature something was sent ("in flight"); without one the wallet never sent it – say so, nothing was charged, the order just lapses
  const head = sig ? `A payment for ${o.qty} ticket${o.qty === 1 ? '' : 's'} is in flight` : `An unfinished order for ${o.qty} ticket${o.qty === 1 ? '' : 's'} – nothing was charged`;
  const tail = sig ? ` · ${sol(o.lamports)} · ${o.status}` : ` · ${sol(o.lamports)} · lapses at ${new Date(o.expiresAt).toUTCString().slice(17, 22)} UTC unless you pay it`;
  box.replaceChildren(el('div', { class: 'note' }, el('span', {}, el('b', {}, head), tail),
    el('button', { disabled: !!S.busy, onclick: retry }, sig ? 'RETRY CONFIRM' : 'CHECK AGAIN'), el('p', { class: 'msg dim', id: 'msg-order' })));
}

const tierInfo = t => {   // the card states the real shift; a demo wallet also shows the shorter ride it actually drives
  const scale = S.me.demo && t.id !== 'free' ? S.me.demoScale : 1, seconds = t.seconds / scale, dist = t.completeDist / scale;
  return { seconds, dist, scale, name: TIER_NAME[t.id] ?? t.id, shift: `${dur(t.seconds)} · ≥ ${km(t.completeDist)} km`, driven: scale > 1 ? `${dur(seconds)} · ≥ ${km(dist)} km` : '' };
};
function tierOff(t) {
  if (S.pending) return 'finish the paid ride waiting for you first';
  if (t.id === 'free') return S.me.freeRides <= 0 && !S.me.readyFreeRide ? 'no free rides left – the next one at 00:00 UTC' : '';   // a READY free ride needs no credit
  return t.available ? '' : 'not available right now';
}
/* /api/me's `readyFreeRide` = the free ride ordered but not started (its credit already spent): START hands it back, so it stays on at 0 credits (tierOff).
   A ready free ride seen for the first time picks the card's level + checkboxes from it (once – the player may still change them; START re-chooses that same ride).
   A helper HARD forced off was not chosen, and must not overwrite the remembered box. */
function adoptReady(free) {
  const r = S.me?.readyFreeRide; if (!r || r.id === S.readyId) return;
  S.readyId = r.id; if (r.level != null) S.opt.level = r.level;
  const lv = freeLevels(free).find(l => l.level === r.level);   // a forced-off helper on HARD was not chosen, so it must not wipe the remembered box
  if (lv?.tutorial !== false) S.opt.tutorial = r.tutorial;
  if (lv?.assist !== false) S.opt.assist = r.assist;
}
function paintTiers() {
  const box = $('tiers'), fbox = $('freebox'); if (!box) return;
  if (!S.tiers) { box.replaceChildren(el('p', { class: 'bad' }, 'Could not load the ride list. Reload the page.')); return; }
  const ctx = { me: S.me, solUsd: S.tiers.solUsd, now: now(), busy: S.busy || S.pending, sales: salesOpen(S.tiers), focus: S.focus, act: { ride, buy, refund, qty: (id, n) => { S.qty[id] = n; paintTiers(); } } };
  const free = S.tiers.tiers.find(t => t.id === 'free');
  adoptReady(free);
  fbox.replaceChildren(...(free ? [freeCard(free)] : []));
  box.replaceChildren(...S.tiers.tiers.filter(t => t.id !== 'free').map(t => {
    if (t.pool) return poolCard(t, tierInfo(t), { ...ctx, qty: S.qty[t.id] ?? 1, winners: hasStandings(t.pool, ctx.now) ? S.standings[t.pool.id] : null });   // no pool of this shift on sale: the card shows the running one, with its winners
    if (t.onSale === false) return soonCard(t);   // planned shift: no pay-per-ride card, and not the "pool ended" card
    return salesOpen(S.tiers) ? noPoolCard(t) : legacyCard(t);
  }));
  for (const [k, m] of Object.entries(S.msgs)) say(k, ...m);   // messages survive a repaint
  mountPayQr();
  paintResults(ctx); paintRefunds(); tickCountdowns();
}

/* POOL RESULTS: the pools whose sale is over and no tier card shows – rides still counting, in the review window, paying, and the last settled ones (GET /api/pools
   `pools` + `finished`) – each with its winners list (GET /api/pools/:id/standings, public). Provisional lists are asked again every 15 s; a final, fully paid one once. */
const resultPools = n => { const shown = new Set(S.tiers?.tiers.map(t => t.pool?.id)); return [...(S.pools?.pools ?? []).slice().reverse(), ...(S.pools?.finished ?? [])].filter(p => !shown.has(p.id) && hasStandings(p, n)); };   // newest first: the live list comes soonest play deadline first
function paintResults(ctx) {
  const box = $('results'); if (!box) return;
  const list = resultPools(ctx.now), sched = id => S.tiers?.tiers.find(t => t.id === id)?.schedule ?? null;
  box.replaceChildren(...(list.length ? [el('h2', {}, 'POOL RESULTS'), el('div', { class: 'tiers' }, list.map(p => resultCard(p, S.standings[p.id], { ...ctx, name: id => TIER_NAME[id] ?? id, schedule: sched })))] : []));
  loadStandings([...list, ...(S.tiers?.tiers ?? []).map(t => t.pool).filter(p => p && hasStandings(p, ctx.now))]);
}
let stBusy = false;
async function loadStandings(pools) {
  const t = Date.now(), due = pools.filter(p => { const s = S.standings[p.id]; return !(s?.final && s.ranks.every(r => r.paid)) && t - (S.stAt[p.id] ?? 0) > 14000; });
  if (stBusy || !due.length) return;
  stBusy = true; due.forEach(p => { S.stAt[p.id] = t; });
  await Promise.all(due.map(p => api(`pools/${p.id}/standings`, undefined, { report: false }).then(st => { S.standings[p.id] = st; }, () => { S.standings[p.id] ??= null; })));
  stBusy = false;
  if (S.tab === 'new' && !S.busy) paintTiers();
}
const tutorialOn = () => S.opt.tutorial ?? !S.me?.tutorialPassed;
function guideBox(id, name, hint, on, set, locked = false) {   // one of the free ride's two checkboxes (kept in S.opt, so a repaint does not reset it); locked = unchecked + disabled, the hint stays
  return el('label', { class: `opt${locked ? ' locked' : ''}`, for: id }, el('input', { type: 'checkbox', id, checked: on && !locked, disabled: !!locked, onchange: e => set(e.target.checked) }), el('span', {}, el('b', {}, name), el('small', {}, hint)));
}
/* the free ride's LEVELS come from the server (GET /api/tiers → the free tier's `levels`: EASY / MEDIUM / HARD, their length and whether TUTORIAL and ASSIST are allowed);
   a server without them = no picker and no `level` sent. The pick is remembered (localStorage freightchain.level); one the server does not offer falls back to the easiest. */
const freeLevels = t => t?.levels ?? [];
const pickedLevel = t => { const ls = freeLevels(t); return ls.find(l => l.level === S.opt.level) ?? ls[0] ?? null; };
const tutorialAllowed = t => pickedLevel(t)?.tutorial !== false;
const assistAllowed = t => pickedLevel(t)?.assist !== false;
const lockOpt = (id, on, allowed) => {   // unchecked + disabled while the level forbids it; the remembered choice stays in S.opt
  const input = $(id), label = input?.closest('.opt'); if (!input || !label) return;
  input.disabled = !allowed; input.checked = !!on && allowed; label.classList.toggle('locked', !allowed);
};
function levelPicker(t) {
  const ls = freeLevels(t), on = pickedLevel(t); if (!ls.length) return '';
  const pick = n => { S.opt.level = n; store.set('freightchain.level', String(n)); syncFreeLevel(); };   // in place: rebuilding the card flashed the level line
  return el('div', { class: 'levels', role: 'radiogroup', 'aria-label': 'Level' },
    ls.map(l => {
      const c = FREE_COUNTRIES[l.level];   // hardcoded country + description; the server stamps the same route id when this level is ordered
      return el('label', { class: `lv${l.level === on.level ? ' on' : ''}`, for: `level-${l.level}`, ...(c ? { style: `--stripe:${c.stripe}` } : {}) },
        el('input', { type: 'radio', name: 'level', id: `level-${l.level}`, value: String(l.level), checked: l.level === on.level, disabled: !!S.busy, onchange: () => pick(l.level) }),
        c ? el('span', { class: 'cty' }, c.country) : '',
        el('b', {}, l.name),
        c ? el('small', { class: 'where' }, `${c.title} · ${c.place}`) : '',
        c ? el('small', { class: 'desc' }, c.desc) : '',
        el('small', {}, `${dur(l.seconds)} · ≥ ${km(l.completeDist)} km`),
        l.assist ? '' : el('small', { class: 'why' }, 'no assist'));
    }));
}
/* the picked level already prints its time and distance on its chip, so nothing under the picker repeats it. The two locks follow the pick without a repaint. */
function syncFreeLevel() {
  const t = S.tiers?.tiers.find(x => x.id === 'free'), lv = pickedLevel(t), card = $('tier-free'); if (!card || !lv) return;
  card.querySelectorAll('.lv').forEach(node => { const input = node.querySelector('input'), on = Number(input.value) === lv.level; node.classList.toggle('on', on); input.checked = on; });
  lockOpt('opt-tutorial', tutorialOn(), tutorialAllowed(t));
  lockOpt('opt-assist', S.opt.assist, assistAllowed(t));   // HARD: both blocks stay, the checkboxes do not
}
function freeCard(t) {
  const off = tierOff(t);
  const mobile = isMobileDevice();
  const btnLabel = S.busy === 'free' ? 'WORKING…' : mobile ? 'DESKTOP TO DRIVE · WATCH LIVE' : S.me.readyFreeRide ? 'START FREE RIDE · ready' : 'START FREE RIDE';
  return el('article', { class: 'tier free', id: 'tier-free' },
    el('div', { class: 'freeinfo' },
      el('div', { class: 'hd' }, el('span', { class: 'nm' }, TIER_NAME.free)),
      el('div', { class: 'prize' },
        el('span', { class: 'st live' }, 'FREE PLAY'),
        el('span', { class: 'st done' }, 'OFFICIAL LEADERBOARD & ACHIEVEMENTS'),
        mobile ? el('span', { class: 'st live' }, 'DESKTOP TO DRIVE · SPECTATE ON MOBILE') : ''),
      levelPicker(t),
      freeLevels(t).length ? '' : el('span', { class: 'sub', id: 'free-shift' }, tierInfo(t).shift),   // a server without levels: the one shift, once
      el('div', { class: 'guide' },
        guideBox('opt-tutorial', 'TUTORIAL', S.me?.tutorialPassed ? 'Step-by-step tips over the game – you have done it, switch it on to see it again.' : 'Step-by-step tips over the game: ignition, gears, steering, lights, hull. On for your first ride.', tutorialOn(), v => { S.opt.tutorial = v; }, !tutorialAllowed(t)),
        guideBox('opt-assist', 'ASSIST', 'The truck and the battery last twice as long and every control gets a tip when it matters. Finish a free ride WITHOUT it for the “On My Own” achievement.', S.opt.assist, v => { S.opt.assist = v; store.set('freightchain.assist', v ? '1' : '0'); }, !assistAllowed(t))),
      off ? el('span', { class: 'tag' }, off) : '',
      el('button', { class: 'go', id: 'start', disabled: !!off || !!S.busy, onclick: startFree }, btnLabel)),
    el('p', { class: 'msg dim', id: 'msg-free' }));
}
function soonCard(t) {   // a paid shift with no live pool: the planned price is text, the button does nothing
  const i = tierInfo(t);
  return el('article', { class: 'tier legacy', id: `tier-${t.id}` },
    el('div', { class: 'hd' }, el('span', { class: 'nm' }, i.name), el('span', { class: 'st done' }, 'SOON')),
    el('span', { class: 'pr' }, `$${t.usd}`, el('small', {}, ' · planned')),
    ...paidShift(i),
    el('span', { class: 'sub more' }, 'Available soon.'),
    el('button', { class: 'go', disabled: true }, 'SOON'),
    el('p', { class: 'msg dim', id: `msg-${t.id}` }));
}
function noPoolCard(t) {   // program mode is ticket-only: an on-sale tier whose pool failed / settled and no new one is open yet
  const i = tierInfo(t);
  return el('article', { class: 'tier legacy', id: `tier-${t.id}` },
    el('div', { class: 'hd' }, el('span', { class: 'nm' }, i.name), el('span', { class: 'st done' }, 'NO POOL')), ...paidShift(i),
    el('span', { class: 'sub' }, 'No pool open right now.'),
    el('button', { class: 'go', disabled: true }, 'NEXT POOL SOON'),
    el('p', { class: 'msg dim', id: `msg-${t.id}` }));
}
function legacyCard(t) {   // a paid tier with no pool registered: pay per ride (the old flow; removed with W3's order routes)
  const off = tierOff(t), i = tierInfo(t);
  return el('article', { class: 'tier legacy', id: `tier-${t.id}` },
    el('div', { class: 'hd' }, el('span', { class: 'nm' }, i.name), el('span', { class: 'st done' }, 'PAY PER RIDE')),
    el('span', { class: 'pr' }, `$${t.usd}`, el('small', {}, t.lamports ? ` · ${sol(t.lamports)}` : ' · price unavailable')), ...paidShift(i),
    el('span', { class: 'sub more' }, 'Price locked 10 min after you order. ', el('b', {}, 'Non-refundable'), ': goes to the weekly round (50% grand · 20% top 20 · 20% next week · 10% fees).'),
    off ? el('span', { class: 'tag' }, off) : '',
    el('button', { class: 'go', disabled: !!off || !!S.busy, onclick: () => startLegacy(t.id) }, S.busy === t.id ? 'WORKING…' : [`PAY $${t.usd}${t.lamports ? ` · ${sol(t.lamports)}` : ''}`, el('small', { class: 'go-sub' }, 'LET’S RIDE →')]),
    el('p', { class: 'msg dim', id: `msg-${t.id}` }));
}
async function paintRefunds() {   // failed pools no card shows any more (a card shows its own pool's refund)
  const box = $('refunds'); if (!box) return;
  const shown = new Set(S.tiers?.tiers.map(t => t.pool?.id)), rows = (S.me.tickets ?? []).filter(t => t.refundable && !shown.has(t.poolId));
  box.replaceChildren(...refundRows(rows, S.poolInfo, S.busy, refund));
  const missing = rows.filter(r => !(r.poolId in S.poolInfo));
  if (!missing.length) return;
  await Promise.all(missing.map(r => api(`pools/${r.poolId}`, undefined, { report: false }).then(d => { S.poolInfo[r.poolId] = d; }, () => { S.poolInfo[r.poolId] = null; })));
  if ($('refunds') === box) box.replaceChildren(...refundRows(rows, S.poolInfo, S.busy, refund));
}
function paintRules() {
  const box = $('rules'); if (!box) return;
  box.replaceChildren(el('b', {}, 'CONDITIONS'), el('ul', { class: 'rules' },
    el('li', {}, 'Drive the whole shift: its time ', el('b', {}, 'AND'), ' its distance. Speed is capped at 100 km/h, so idling can’t bank it.'),
    el('li', {}, 'End the shift early, abandon it or crash and it does ', el('b', {}, 'not'), ' count as finished. A ticket is spent when its ride is created.'),
    el('li', {}, 'Pool tickets: your entry sits in the pool’s vault on chain, not with us. A pool that misses its goal refunds every ticket in full; in a live pool the finished shifts rank for its prize share. ', el('a', { href: escrowExplainer(), target: '_blank', rel: 'noopener' }, 'How the escrow works →')),
    el('li', {}, 'The game records your inputs while you drive. After the shift the server checks that recording – complete, consistent with your ride, human-timed – and verified shifts rank for prizes (the leaderboard says when that check is switched on). Flagged shifts wait for a review.'),
    el('li', {}, `Free rides: no fee, no prize. A new wallet starts with a few; the daily refill (+1 at 00:00 UTC) tops you up to ${S.me?.freeRidesMax ?? 5}. A promo or an admin grant can sit above that.`)));
}
/* per-card message lines (msg-<key>); kept in S.msgs so a repaint (poll, +/−) does not wipe them */
function setPayQr(key, url) { S.payQr = url ? { key, url } : null; mountPayQr(); }
async function mountPayQr() {
  const wanted = S.payQr;
  if (!wanted) { $('pay-qr')?.remove(); return; }
  const { payQrBlock } = await import('./qr.js');
  if (S.payQr !== wanted) return; // a repaint started another mount
  const msg = $(`msg-${wanted.key}`); if (!msg?.isConnected) return;
  let holder = $('pay-qr');
  if (!holder) { holder = el('div', { id: 'pay-qr', class: 'pay-qr' }); msg.after(holder); }
  holder.replaceChildren(...payQrBlock(wanted.url));
}
function say(key, text, bad = false, link = null) {   // link = { href, text } appended after the text (an explorer link)
  if (text) S.msgs[key] = [text, bad, link]; else delete S.msgs[key];
  const m = $(`msg-${key}`); if (m) { m.replaceChildren(text, link ? el('a', { href: link.href, target: '_blank', rel: 'noopener' }, link.text) : ''); m.className = `msg ${bad ? 'bad' : 'dim'}`; }
}
async function busy(key, fn) {
  if (S.busy) return;
  S.busy = key; hideTicketDialog(); for (const k of Object.keys(S.msgs)) say(k, ''); paintTiers();
  try { await fn(); } finally { S.busy = null; if ($('tiers')) paintTiers(); }
}
const SHIFT = { '1h': '1H', '4h': '4H', '8h': '8H' };
const paidLine = qty => `Paid – ${qty} ticket${qty === 1 ? '' : 's'} credited.`;
/** RIDE PAID: the on-chain receipt (transaction, the pool's escrow account, the program) and POST ON 𝕏. Called after refreshPool, so the pool already counts this buy. */
const creditDialog = (poolId, qty, { lamports = 0, signature = null, programId = null } = {}) => {
  const t = S.tiers?.tiers.find(x => x.pool?.id === poolId), p = t?.pool, solUsd = S.tiers?.solUsd, tier = t?.id ?? S.me?.tickets?.find(r => r.poolId === poolId)?.tier;   // the card may already sell the next pool
  const rows = [lamports ? { k: 'paid', v: `${sol(lamports)}${solUsd ? ` ${usd(lamports, solUsd)}` : ''}` } : null,
    { k: 'pool', v: p ? `#${poolId} · ${p.label}` : `#${poolId}` },
    signature ? { k: 'transaction', v: short(signature), href: explorerTx(signature), title: signature } : null,
    p?.address ? { k: 'escrow', v: short(p.address), href: explorerUrl(p.address), title: `pool account ${p.address}` } : null,
    programId ? { k: 'program', v: short(programId), href: explorerUrl(programId), title: `program ${programId}` } : null].filter(Boolean);
  const proof = signature ? explorerTx(signature) : p?.address ? explorerUrl(p.address) : null;   // the dialog is the receipt; the post's url is the site home (a blink), and only when there is a receipt
  ticketDialog({ ok: true, shift: SHIFT[tier] ?? '', qty, text: `${paidLine(qty)} Your entry sits in the pool’s vault on chain, not with us.`, detail: p ? progressText(p, now()) : '', rows,
    more: { href: escrowExplainer(), text: 'How the escrow works →' }, share: proof && xIntent(ticketShareText({ shift: TIER_NAME[tier] ?? 'paid', qty, lamports, poolId }), homeBlinkUrl(SITE_BASE, location.origin)) });
};
const failDialog = (tier, text) => ticketDialog({ ok: false, shift: SHIFT[tier] ?? '', text });
function play(r, tier, level = null) {
  if (isMobileDevice()) {
    showMobileToast({
      liveAction: () => { location.hash = '#live'; },
      replaysAction: () => { location.hash = '#replays'; },
    });
    return;
  }
  if (r.tier !== tier) { checkPending(); say(tier, `You already have a ${TIER_NAME[r.tier] ?? r.tier} ride ready – start that one first.`, true); return; }   // never send you into the wrong ride silently
  if (level != null && r.level != null && r.level !== level) { say(tier, 'The server kept your ride at another level – pick it again or start that one.', true); return; }   // (the server re-chooses the ready ride's level, so this is only an old server)
  flushSoon(); location.href = `${GAME_BASE}/play.html?ride=${r.id}`;
}
const clicked = (id, usd = 0, level = null) => track('ride_buy_clicked', { tier_id: id, is_free: id === 'free', price_usd: usd, is_demo: !!S.me?.demo, level });   // level is 1/2/3 on a free ride, null on a paid one
const freeBody = () => { const t = S.tiers?.tiers.find(x => x.id === 'free'), lv = pickedLevel(t); return { tier: 'free', tutorial: tutorialOn() && tutorialAllowed(t), assist: S.opt.assist && assistAllowed(t), ...(lv ? { level: lv.level } : {}) }; };   // HARD: neither helper is sent (the server would refuse it)
const startFree = () => busy('free', async () => {
  if (isMobileDevice()) {
    showMobileToast({
      liveAction: () => { location.hash = '#live'; },
      replaysAction: () => { location.hash = '#replays'; },
    });
    say('free', 'Driving requires a desktop browser with keyboard controls. Check out the LIVE tab to watch streams and replays on mobile!', true);
    return;
  }
  const body = freeBody(); clicked('free', 0, body.level ?? null); try { play(await api('rides', body), 'free', body.level ?? null); } catch (e) { say('free', rideError(e, 'free'), true); await refreshMe(); }
});
const refusedOffer = (e) => { if (e?.code === 'agreements_required') location.hash = '#profile'; };
const startLegacy = id => busy(id, async () => {
  if (isMobileDevice()) {
    showMobileToast({
      liveAction: () => { location.hash = '#live'; },
      replaysAction: () => { location.hash = '#replays'; },
    });
    say(id, 'Driving requires a desktop browser with keyboard controls. Check out the LIVE tab to watch streams on mobile!', true);
    return;
  }
  if (blockPaid(S.me)) return; clicked(id, S.tiers?.tiers.find(t => t.id === id)?.usd ?? 0); try { play(await buyRide(id, text => say(id, text), url => setPayQr(id, url)), id); } catch (e) { refusedOffer(e); say(id, rideError(e, id), true); }
});
const ride = tier => busy(tier, async () => {   // spends one ticket: the ride is ready at once
  if (isMobileDevice()) {
    showMobileToast({
      liveAction: () => { location.hash = '#live'; },
      replaysAction: () => { location.hash = '#replays'; },
    });
    say(tier, 'Driving requires a desktop browser with keyboard controls. Check out the LIVE tab to watch streams on mobile!', true);
    return;
  }
  if (blockPaid(S.me)) return;   // before ride_buy_clicked: a blocked click is not a buy
  clicked(tier, S.tiers?.tiers.find(t => t.id === tier)?.usd ?? 0);
  say(tier, 'Spending a ticket…');
  try { play(await api('rides', { tier }), tier); } catch (e) { refusedOffer(e); say(tier, rideError(e, tier), true); await refreshMe(); }
});
const buy = (tier, poolId, qty) => busy(tier, async () => {
  if (blockPaid(S.me)) return;
  try {
    const r = await buyTickets(poolId, qty, text => say(tier, text), url => setPayQr(tier, url)); S.qty[tier] = 1; creditLocal(poolId, qty); await Promise.all([refreshMe(), refreshPool()]);
    const line = paidLine(qty);   // the card keeps it (the checks read #msg-*); the dialog is the same news as a ticket
    say(tier, line, false, r.order?.signature ? { href: explorerTx(r.order.signature), text: `${r.order.signature.slice(0, 8)}… ↗` } : null);
    creditDialog(poolId, qty, { lamports: r.order?.lamports, signature: r.order?.signature, programId: r.programId });
  } catch (e) { refusedOffer(e); const line = buyError(e); say(tier, line, true); failDialog(tier, line); }
});
const refund = (poolId, key) => busy(key, async () => {
  try {
    const { signature: sig, settled } = await claimRefund(poolId, text => say(key, text)); await refreshMe();
    say(key, settled ? 'Refunded – the lamports are back in your wallet: ' : 'Refund sent – the lamports land in your wallet when it confirms: ', false, { href: explorerTx(sig), text: `${sig.slice(0, 8)}… ↗` });
  } catch (e) { say(key, e.notConfigured ? 'Refunds through the lobby are not switched on in this build yet. Once a pool has failed, the program lets ANY wallet send the refund for you – nobody can keep the money.' : buyError(e), true); }
});

async function redeem(e) {
  e.preventDefault();
  const input = $('promo-code'), go = $('promo-go'), code = input.value.trim(), m = $('promo-msg');
  const show = (text, cls) => { m.textContent = text; m.className = `msg ${cls}`; };
  if (!code) { show('Type a promo code first.', 'bad'); return; }
  track('promo_redeem_clicked', { surface: 'profile', prefilled: !!S.invited && code.replace(/\s+/g, '').toUpperCase() === S.invited }); S.invited = null;   // the form is only painted on the profile; before the request; the server's promo_redeemed is the outcome
  go.disabled = true; show('Redeeming…', 'dim');
  try {
    const r = await api('promo/redeem', { code }); input.value = ''; show(promoOk(r), 'good'); if (r.kind === 'tickets' || r.kind === 'ride') S.focus = r.tier;
    await refreshMe();
    S.garage = null;   // a new part: the GARAGE reloads next time it is opened
    if (S.tab === 'profile') await paintPromoLists();   // the new code in the list
  } catch (err) { show(promoError(err), 'bad'); } finally { go.disabled = false; }
}

/* ───────── PROMO CODES (a section of the PROFILE) ─────────
   The code field is here (a code from the landing's invite block arrives as ?promo=CODE and only PRE-FILLS it – the player clicks REDEEM); here is what this wallet redeemed. The parts are in the GARAGE. */
function promoSection() {
  const input = el('input', { id: 'promo-code', name: 'code', autocapitalize: 'characters', spellcheck: 'false', maxlength: 64, placeholder: 'PROMO CODE', 'aria-label': 'promo code', 'aria-describedby': 'promo-msg' });
  if (S.invite) { input.value = S.invite; S.invited = S.invite.replace(/\s+/g, '').toUpperCase(); S.invite = null; setTimeout(() => input.focus()); }   // focus once it is in the page
  paintPromoLists();
  return [el('h2', {}, 'PROMO CODES'),
    el('form', { class: 'promo-form', id: 'promo', autocomplete: 'off', onsubmit: redeem }, input, el('button', { id: 'promo-go', type: 'submit' }, 'REDEEM'), el('p', { class: 'msg dim', id: 'promo-msg', role: 'status' })),
    el('p', { class: 'dim' }, `A ride code gives one 1h, 4h or 8h shift, free of charge. It is not sold and it does not mint ${TOKEN_SYMBOL}. Pool tickets are a separate grant. Cab parts are minted by burning ${TOKEN_SYMBOL} in the `, el('a', { href: '#garage' }, 'garage →')),
    el('div', { id: 'mycodes' }, el('p', { class: 'dim' }, 'Loading…'))];
}
async function paintPromoLists() {
  const my = seq, mine = await api('promo/mine', undefined, { report: false }).catch(e => e);
  if (my !== seq) return;
  const codes = $('mycodes'); if (!codes) return;
  if (mine instanceof Error) { codes.replaceChildren(el('p', { class: 'bad' }, `Could not load your codes (${mine.message}).`)); return; }
  const grants = Array.isArray(mine.grants) ? mine.grants : [];
  codes.replaceChildren(
    ...grants.map(g => el('p', {}, el('button', { type: 'button', id: `promo-start-${g.tier}`, onclick: () => startPromoRide(g.tier) }, `Start free ${g.tier} ride`), el('span', { class: 'dim' }, ` from ${g.code}. Not a purchase, and it does not mint ${TOKEN_SYMBOL}.`))),
    redemptionList(mine.redemptions));
}
async function startPromoRide(tier) {
  if (isMobileDevice()) { showMobileToast({ liveAction: () => { location.hash = '#live'; }, replaysAction: () => { location.hash = '#replays'; } }); return; }
  try { play(await api('rides', { tier }), tier); } catch (e) { const m = $('promo-msg'); if (m) { m.textContent = rideError(e, tier); m.className = 'msg bad'; } }
}

/* ───────── GARAGE ─────────
   Every part can be observed (S.observe): the cab previews it and the detail card shows the garage payload's name, description and burn price.
   S.pick is owned parts only, applied by APPLY (POST /api/garage/loadout). A locked part is minted here by burning TEN4 (POST /api/honk/visuals → { nft, balance }).
   S.garage = the server's answer. S.honkCatalog = GET /api/honk/catalog (null = that request failed), a price backup only. S.honkBalance = GET /api/honk body.balance, or null when unknown. */
const catalogRows = body => Array.isArray(body) ? body : Array.isArray(body?.items) ? body.items : Array.isArray(body?.catalog) ? body.catalog : Array.isArray(body?.visuals) ? body.visuals : [];
const asHonk = v => (typeof v === 'number' && Number.isFinite(v) ? String(v) : typeof v === 'string' && v.trim() ? v.trim() : null);
let honkTicket = 0;   // a burn's balance must beat an older GET /api/honk that answers late
function refreshHonk(my) {
  const ticket = ++honkTicket;
  api('honk', undefined, { report: false }).then(body => {
    if (my !== seq || ticket !== honkTicket) return;
    S.honkProgram = body?.chain?.programId ?? null;
    showHonk(asHonk(body?.balance));
  }).catch(() => { if (my !== seq || ticket !== honkTicket) return; showHonk(null); });
}
function showHonk(amount) {
  S.honkBalance = amount;   // null omits the line – a failed balance request must not block or blank the rest of the garage
  const panel = $('garage-detail'); if (!panel || S.tab !== 'garage') return;
  const line = panel.querySelector('.bal');
  if (amount == null) { line?.remove(); return; }
  const text = `You hold ${amount} ${TOKEN_SYMBOL}.`;
  if (line) { line.textContent = text; return; }
  panel.prepend(el('p', { class: 'dim bal', id: 'garage-honk' }, text));
}
async function renderGarage() {
  view.replaceChildren(el('p', { class: 'dim' }, 'Loading…'));
  const my = seq;
  refreshHonk(my);   // in parallel: the garage paints even when this fails
  if (!S.garage) {
    try { const g = await api('garage', undefined, { report: false }); if (my !== seq) return; S.garage = g; S.pick = { ...g.equipped }; } catch (e) { if (my === seq) view.replaceChildren(el('p', { class: 'bad' }, e.message)); return; }
  }
  if (S.honkCatalog === undefined) {
    try { const body = await api('honk/catalog', undefined, { report: false }); if (my !== seq) return; S.honkCatalog = catalogRows(body); }
    catch { if (my !== seq) return; S.honkCatalog = null; }
  }
  if (my === seq) paintGarage();
}
const cab = () => S.cab ??= garageCab({ onPickSlot: slot => { const c = document.querySelector(`#garage-slots [data-slot=${slot}]`); c?.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); c?.classList.add('ping'); setTimeout(() => c?.classList.remove('ping'), 1200); } });
function paintGarage(note) {
  const g = S.garage; if (!g || S.tab !== 'garage') return;
  view.replaceChildren(el('h2', {}, 'YOUR GARAGE'), garageProgress(g), cab().el,
    garageDetail({ garage: g, observe: S.observe, catalog: S.honkCatalog, balance: S.honkBalance, busy: !!S.burning, onBurn: burnVisual }),
    garageSlots(g, S.pick, pickPart, slot => cab().hoverSlot(slot), { catalog: S.honkCatalog, observe: S.observe }),
    garageActions({ garage: g, pick: S.pick, busy: !!S.saving || !!S.burning, onSave: saveGarage, onReset: () => {
      const cur = S.garage; S.pick = { ...cur.equipped };
      const seen = partAt(cur, S.observe); if (!seen || seen.part.owned) S.observe = null;   // a locked preview may stay; an owned one must not keep the cab off the restored pick
      paintGarage();
    } }));
  cab().set(previewLoadout(g, S.pick, S.observe));
  if (note) { const m = $('garage-msg'); m.textContent = note.text; m.className = `msg ${note.bad ? 'bad' : 'good'}`; }
}
function pickPart(slot, part) {
  track('garage_part_clicked', { slot, item: part.id, owned: part.owned });
  S.observe = { slot, id: part.id };
  if (part.owned) S.pick = { ...S.pick, [slot]: part.id };   // a locked id never enters the pick, so APPLY cannot send it
  paintGarage();
}
async function burnVisual(slot, part) {
  if (S.burning || S.saving || part.owned || part.isDefault) return;
  S.burning = true; paintGarage();
  let note;
  try {
    let signature;
    if (S.honkProgram && S.me?.wallet) {
      const { signHonkPart } = await import('./honk-sign.js');
      signature = await signHonkPart({ programId: S.honkProgram, owner: S.me.wallet, slot, item: part.id });
    }
    const minted = await api('honk/visuals', { slot, item: part.id, ...(signature ? { signature } : {}) });
    const got = asHonk(minted?.balance);
    if (got != null) { honkTicket++; S.honkBalance = got; }   // beat a GET that is still in flight; a failed burn leaves that GET free to land
    else refreshHonk(seq);
    S.garage = await api('garage', undefined, { report: false });
    const seen = partAt(S.garage, { slot, id: part.id });
    if (seen?.part.owned) S.pick = { ...S.pick, [slot]: part.id };
    S.observe = { slot, id: part.id };
    note = { text: `Minted by burning ${TOKEN_SYMBOL}.` };
  } catch (e) { note = { text: e.message, bad: true }; }
  S.burning = false; paintGarage(note);
}
async function saveGarage() {
  if (S.saving || !S.garage || !dirty(S.garage, S.pick)) return;
  S.saving = true; paintGarage();
  const picks = Object.fromEntries(Object.entries(S.pick).filter(([slot, item]) => item !== S.garage.equipped[slot]));
  let note;
  try { S.garage = await api('garage/loadout', { loadout: picks }); S.pick = { ...S.garage.equipped }; note = { text: 'Applied – your next ride starts with this loadout.' }; }
  catch (e) { note = { text: e.message, bad: true }; }
  S.saving = false; paintGarage(note);
}

/* ───────── LIVE ─────────
   Every ride on the air (the stale-ride sweeper ends the ones whose tab vanished), with how many watch it and its signal; sort / filter to pick one and
   ▶ WATCH it (the "join": the watch page, ~25 s behind the driver – chat and donations from there). */
const rows = new Map();   // wallet|startedAt → { root, … }
const liveChip = () => { const o = S.live.online, n = (S.live.rides || []).filter(r => r.tier !== 'free').length; return `${o ? `${o.total} online · ` : ''}${n} on the road`; };
const SORTS = { newest: (a, b) => b.startedAt - a.startedAt, watched: (a, b) => b.viewers - a.viewers || b.startedAt - a.startedAt, furthest: (a, b) => b.distance - a.distance };
function liveControls() {
  const sort = el('select', { id: 'live-sort', 'aria-label': 'sort the rides', onchange: e => { S.liveSort = e.target.value; paintLive(); } },
    ...[['newest', 'newest first'], ['watched', 'most watched'], ['furthest', 'furthest']].map(([v, t]) => el('option', { value: v, selected: (S.liveSort ?? 'newest') === v }, t)));
  const route = el('select', { id: 'live-route', 'aria-label': 'only one route', onchange: e => { S.liveRoute = e.target.value; paintLive(); } },
    el('option', { value: '' }, 'every route'), ...Object.entries(ROUTES).map(([v, t]) => el('option', { value: v, selected: S.liveRoute === v }, t)));
  const random = el('button', { type: 'button', class: 'alt', id: 'live-random', title: 'open a ride on the air at random', onclick: () => {
    const pool = (S.live.rides || []).filter(r => r.tier !== 'free' && r.signal !== 'weak' && r.wallet !== S.me.wallet); if (!pool.length) return;
    location.href = `${GAME_BASE}/play.html?watch=${encodeURIComponent(pool[Math.floor(Math.random() * pool.length)].id)}`;
  } }, '▶ WATCH A RANDOM ONE');
  return el('div', { class: 'filters' }, el('label', {}, 'Sort ', sort), el('label', {}, 'Route ', route), random);
}
function renderLive() {
  rows.clear();
  view.replaceChildren(el('h2', {}, 'TRUCKS ON THE ROAD'), el('p', { class: 'dim', id: 'live-online' }), liveControls(), el('div', { class: 'rides', id: 'rides' }), el('p', { class: 'dim' }, 'Updates every 5 seconds. Paused or backgrounded rides show as such. WATCH replays a ride about 25 s behind the driver; signed in, you can write to them and send (mock) donations that change their ride.'));
  paintLive();
}
function paintLive() {
  const box = $('rides'); if (!box) return;
  const rides = (S.live.rides || []).filter(r => r.tier !== 'free'), keys = new Set();
  const o = S.live.online; if ($('live-online')) $('live-online').textContent = o ? `${o.total} online now: ${o.browsing} looking around, ${o.watching} watching, ${o.driving} driving (${o.players} signed in).` : '';
  if ($('live-random')) $('live-random').disabled = !rides.some(r => r.signal !== 'weak' && r.wallet !== S.me.wallet);
  if (!rides.length) { rows.clear(); box.replaceChildren(el('div', { class: 'card empty' }, 'No trucks on the road right now.', el('br'), el('a', { href: '#new' }, 'Be the first →'), ' · ', el('a', { href: '#replays' }, 'or watch a replay →'))); return; }
  box.querySelector('.empty')?.remove();
  for (const r of rides) {
    const k = `${r.wallet}|${r.startedAt}`; keys.add(k);
    let row = rows.get(k);
    if (!row) {
      row = { fill: el('div', { class: 'fill' }), truck: el('span', { class: 'truck' }, '⛟'), time: el('b'), dist: el('b'), hull: el('b'), eyes: el('b'), badge: el('span', { class: 'badge' }) };
      const whoB = el('b', { title: r.wallet }, formatDriver(r.wallet, r.sns ?? getCachedSns(r.wallet)), r.wallet === S.me.wallet ? ' (you)' : '');
      if (!r.sns && r.wallet && getCachedSns(r.wallet) === undefined) {
        reverseResolveSns(r.wallet).then(domain => {
          if (domain && whoB.isConnected) whoB.textContent = domain + (r.wallet === S.me.wallet ? ' (you)' : '');
        }).catch(() => {});
      }
      row.root = el('div', { class: 'card ride' }, avatar(r.wallet),
        el('div', { class: 'who' }, whoB, el('span', { class: `badge${r.tier === 'free' ? '' : ' p'}` }, TIER_NAME[r.tier] ?? r.tier), r.route ? el('span', { class: 'badge' }, ROUTES[r.route] ?? '') : '', row.badge),
        el('div', { class: 'road' }, row.fill, row.truck),
        el('div', { class: 'stats' }, el('span', {}, '⏱ ', row.time), el('span', {}, '↦ ', row.dist), el('span', {}, 'hull ', row.hull), el('span', { title: 'watching now' }, '👁 ', row.eyes),
          el('a', { class: 'watch', href: `${GAME_BASE}/play.html?watch=${encodeURIComponent(r.id)}`, title: 'watch this ride live – chat with the driver, send donations' }, '▶ WATCH')));
      rows.set(k, row); box.append(row.root);
    }
    row.r = r;
  }
  for (const [k, row] of rows) if (!keys.has(k)) { row.root.remove(); rows.delete(k); }
  const shown = [...rows.values()].sort((a, b) => SORTS[S.liveSort ?? 'newest'](a.r, b.r));
  for (const row of shown) { row.root.hidden = !!S.liveRoute && row.r.route !== S.liveRoute; box.append(row.root); }   // append = move: the DOM follows the sort
  tickLive();
}
function tickLive() {   // between polls: run the clock and the truck forward from the last report (corrected by the next poll)
  const since = (Date.now() - S.liveAt) / 1000;
  for (const { r, fill, truck, time, dist, hull, eyes, badge } of rows.values()) {
    const stalled = r.signal !== 'live', extra = stalled ? 0 : Math.min(r.sinceBeat + since, 15);
    const secs = r.driveSeconds + extra, avg = r.driveSeconds > 0 ? r.distance / r.driveSeconds : 0, d = r.distance + avg * extra;
    const pct = Math.min(1, secs / r.minSeconds, d / r.completeDist) * 100;
    fill.style.width = `${pct}%`; truck.style.left = `calc(${pct}% - ${pct * 0.2}px)`;   // the glyph stays inside the road at 0 % and 100 %
    time.textContent = `${dur(secs)} / ${dur(r.minSeconds)}`; dist.textContent = `${km(d)} / ${km(r.completeDist)} km`; hull.textContent = r.hull == null ? '–' : `${r.hull}%`;
    eyes.textContent = String(r.viewers ?? 0);
    badge.textContent = r.signal === 'paused' ? 'PAUSED' : r.signal === 'weak' ? 'WEAK SIGNAL' : ''; badge.className = `badge${badge.textContent ? ' w' : ''}`; badge.hidden = !badge.textContent;
  }
}
async function pollLive() {
  try { const j = await api(livePath('lobby'), undefined, { report: false }); S.live = j; S.liveAt = Date.now(); S.skew = j.now - Date.now(); } catch { return; }
  const n = (S.live.rides || []).filter(r => r.tier !== 'free').length;
  $('chip-live').textContent = liveChip(); $('tab-live-n').textContent = n || '';
  if (S.tab === 'live') paintLive();
}

/* ───────── ACHIEVEMENTS ───────── */
async function renderAchievements() {
  view.replaceChildren(el('p', { class: 'dim' }, 'Loading…'));
  const my = seq;
  try { const p = await api('profile', undefined, { report: false }); if (my === seq) view.replaceChildren(...achievementsSection(p.achievements, track, p.badgeChain)); } catch (e) { if (my === seq) view.replaceChildren(el('p', { class: 'bad' }, e.message)); }
}

/* ───────── PROFILE ───────── */
/* a ride's check in the history: a PAID ride shows its REVIEW (server/src/domain/verdict/ride-review.ts – under review until the recording check
   verifies it or an admin decides), a free ride its recording check as before */
const REVIEW = { under_review: ['UNDER REVIEW', 'warn'], accepted: ['ACCEPTED', 'good'], rejected: ['REJECTED', 'bad'] };
const rideCheck = r => r.review ? el('b', { class: REVIEW[r.review]?.[1] ?? 'warn', title: 'paid rides are reviewed before prizes are paid' }, ` · ${REVIEW[r.review]?.[0] ?? String(r.review).toUpperCase()}`)
  : r.verdict ? el('b', { class: r.verdict === 'verified' ? 'good' : 'bad', title: 'recording check – only verified shifts rank' }, ` · ${r.verdict.toUpperCase()}`) : '';

async function renderProfile() {
  view.replaceChildren(el('p', { class: 'dim' }, 'Loading…'));
  let p; const my = seq;
  try { p = await api('profile', undefined, { report: false }); } catch (e) { if (my === seq) view.replaceChildren(el('p', { class: 'bad' }, e.message)); return; }
  if (my !== seq) return;
  if (p.sns) { S.me.sns = p.sns; seedSns(p.wallet, p.sns); }
  meGen++; Object.assign(S.me, { freeRides: p.freeRides, freeRidesMax: p.freeRidesMax, nextFreeRideAt: p.nextFreeRideAt, tickets: p.tickets, agreements: p.agreements }); paintHeader();
  const card = agreementsCard(S.me);
  view.replaceChildren(
    el('section', { class: 'prof-sec ch prof-identity' },
      ...(card ? [card] : []),
      el('div', { class: 'who', style: 'display:flex;gap:12px;align-items:center' }, avatar(p.wallet), el('div', {}, el('b', { title: p.wallet }, formatDriver(p.wallet, p.sns)), el('div', { class: 'dim' }, `rider since ${new Date(p.createdAt).toLocaleDateString()}`)))),
    el('section', { class: 'prof-sec ch' }, ...careerTiles(p.career, p.stats, { km, sol })),
    el('section', { class: 'prof-sec ch' }, ...profileTickets(p, S.busy, refund)),
    el('section', { class: 'prof-sec ch' }, ...promoSection()),
    el('section', { class: 'prof-sec ch' },
      el('h2', {}, 'RECENT RIDES'),
      p.recent.length ? el('div', { class: 'hist' }, p.recent.map(r => el('div', { class: 'hrow' },
        el('span', {}, new Date(r.startedAt).toLocaleString(), ' · ', TIER_NAME[r.tier] ?? r.tier, r.route ? ` · ${ROUTES[r.route] ?? ''}` : ''),
        el('span', {}, `${km(r.distance)} km · `, el('b', { class: r.status === 'completed' ? 'good' : 'bad' }, r.status.toUpperCase()), rideCheck(r)),
        r.review === 'under_review' ? el('span', { class: 'dim rnote' }, 'An admin checks this ride before prizes are paid.') : ''))) : el('div', { class: 'card empty' }, 'No rides yet – start one!')));
}

/* ───────── refresh + 1 s tick ───────── */
async function refreshPool() {   // the pot + every pool's progress (sold / escrow) – both are public and move while you look. Polls do not report api_request_failed.
  const [p, t, l] = await Promise.all([api('pool', undefined, { report: false }).catch(() => null), ...(S.tab === 'new' ? ['tiers', 'pools'].map(x => api(x, undefined, { report: false }).catch(() => null)) : [])]);
  if (p) S.pool = p;
  if (t) S.tiers = t;
  if (l) S.pools = l;
  if (S.tab === 'new') { paintPool(); if (t && !S.busy) paintTiers(); }
}
function tickCountdowns() { const n = now(); document.querySelectorAll('.pcd[data-at]').forEach(c => { c.textContent = left(+c.dataset.at - n); }); document.querySelectorAll('.phcd[data-at]').forEach(c => { c.textContent = span(+c.dataset.at - n); }); }   // .phcd: a phase line's coarse "14 h"
function tickFree() {   // the "next free ride" counter; at 00:00 UTC ask the server (it grants, then says when the next one comes)
  const m = S.me; if (!m) return;
  $('chip-free').textContent = `${freeLeft(m)} · ${freeCd(m)}`;
  document.querySelectorAll('.fr-cd').forEach(n => { n.textContent = freeCd(m); });
  if (m.nextFreeRideAt != null && now() >= m.nextFreeRideAt && (S.meMiss ?? 0) < 3 && Date.now() - (S.meAt ?? 0) > 5000) {   // gives up after 3 refreshes that bring no new time (clock skew); a reload retries
    S.meAt = Date.now();
    const gen = ++meGen, prev = m.nextFreeRideAt;
    api('me', undefined, { report: false }).then(x => { if (gen !== meGen) return; S.meMiss = x.nextFreeRideAt === prev ? (S.meMiss ?? 0) + 1 : 0; takeMe(x); }, () => { if (gen === meGen) S.meMiss = (S.meMiss ?? 0) + 1; });
  }
}
function tick() {
  tickFree();
  if (S.pool) { const c = $('cd'); if (c) c.textContent = left(S.pool.round.endsAt - now()); }
  if (S.tab === 'new') tickCountdowns();
  if (S.tab === 'live' && !document.hidden) tickLive();
}

for (const a of document.querySelectorAll('a[href="/play.html"]')) a.addEventListener('click', (e) => {
  if (isMobileDevice()) {
    e.preventDefault();
    showMobileToast({
      liveAction: () => { location.hash = '#live'; },
      replaysAction: () => { location.hash = '#replays'; },
    });
    return;
  }
  track('offline_practice_clicked');
  flushSoon();
});
try { S.me = await api('me'); } catch { flushSoon(); location.href = '/'; }   // reporting GET: a failure here is api_request_failed, then back to the landing
if (S.me) {
  track('session_restored', { surface: 'lobby', wallet: S.me.wallet, ...(S.me.demo ? { is_demo: true } : {}) });
  const viewed = { is_demo: !!S.me.demo };
  if (S.pool?.round?.id != null) viewed.round_id = S.pool.round.id;   // pool is not loaded yet; do not delay the pageview for it
  track('lobby_viewed', viewed);
  paintHeader();
  for (const a of document.querySelectorAll('a[href="/play.html"]')) a.href = `${GAME_BASE}/play.html?offline=1`;   // guest free runs. The click listener above stays on the element. Paid and watch links already carry their own query
  $('out').onclick = async () => { track('player_signed_out'); flushSoon(); await signOut(); location.href = '/'; };
  [S.tiers, S.pool, S.pools] = await Promise.all(['tiers', 'pool', 'pools'].map(x => api(x, undefined, { report: false }).catch(() => null)));
  await pollLive();
  const invite = new URLSearchParams(location.search).get('promo');   // the landing's invite block: lobby.html?promo=CODE – pre-fills the code field in the PROFILE, never redeems by itself
  if (invite?.trim()) { S.invite = invite.trim().slice(0, 64); history.replaceState(null, '', `${location.pathname}#promo`); }
  go();
  checkPending();   // once: an RPC lookup may run here, so never on a timer
  addEventListener('hashchange', go);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { pollLive(); refreshPool(); } });
  setInterval(() => { if (!document.hidden) pollLive(); }, 5000);
  leaveOnClose(() => `${API_BASE}/api/${livePath('lobby')}&leave=1`);   // closing the lobby leaves "N online" at once
  setInterval(() => { if (!document.hidden && (S.tab === 'new' || S.tab === 'board')) refreshPool(); }, 15000);
  setInterval(tick, 1000);
}
