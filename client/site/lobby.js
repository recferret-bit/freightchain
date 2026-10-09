import { api, signOut } from './wallet.js';
import { buyRide, buyTickets, claimRefund, waitPaid, ORDER_SIG } from './pay.js';
import { salesOpen, pendingOrder } from './tickets-api.js';
import { escrowExplainer, explorerTx, rideError, promoError, promoOk, buyError, sol, left, shortAddr as short } from './pools.js';
import { poolCard, escrowSummary, refundRows, profileTickets } from './lobby-pools.js';
import { redemptionList } from './lobby-promo.js';
import { dirty, garageActions, garagePreview, garageProgress, garageSlots } from './lobby-garage.js';
import { el } from './dom.js';
import { livePath, leaveOnClose } from './presence.js';
import { renderReplays } from './lobby-replays.js';
import { API_BASE, GAME_BASE } from '../js/hosts.js';
import { track, flushSoon } from '../js/analytics.js';
import { reportWebVitals } from '../js/web-vitals.js';

/* The lobby: NEW RIDE · LIVE · LEADERBOARD · GARAGE · PROMO · PROFILE. Vanilla DOM, no framework.
   Everything that comes from the server (wallet addresses, route ids, statuses…) goes in with textContent – never innerHTML – because other riders' data is rendered here. */
reportWebVitals('lobby');   // before the session check, so a bounce back to the landing still reports the load
const $ = id => document.getElementById(id);
const view = $('view');
const ROUTES = { route66: 'Route 66', stuart: 'Stuart Hwy', siberia: 'Trans-Siberian', brenner: 'Brenner Pass', panamerican: 'Pan-American' };   // = client/js/themes ids
const TIER_NAME = { free: 'TEST RIDE', '1h': '1 HOUR', '4h': '4 HOURS', '8h': '8 HOURS' };
const TABS = ['new', 'live', 'replays', 'board', 'garage', 'promo', 'profile'];

/* ───────── helpers ───────── */
const hue = w => { let h = 0; for (const c of w) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
const avatar = w => el('span', { class: 'av', style: `background:hsl(${hue(w)} 60% 50%)` });
const pad = n => String(Math.floor(n)).padStart(2, '0');
const dur = s => { s = Math.max(0, Math.round(s)); return s >= 3600 ? `${Math.floor(s / 3600)}:${pad((s % 3600) / 60)}:${pad(s % 60)}` : `${Math.floor(s / 60)}:${pad(s % 60)}`; };
const km = m => (m / 1000).toFixed(m < 10_000 ? 2 : 1);

/* ───────── state ───────── */
const S = { me: null, tiers: null, pool: null, live: { rides: [] }, liveAt: 0, skew: 0, board: 'round', pending: null, pendingNote: '', tab: 'new', busy: null, qty: {}, msgs: {}, poolInfo: {}, order: null, focus: null };
let seq = 0;   // one number per tab render: an answer that comes back after the player moved on (or re-asked) is dropped, not painted over the new tab
const now = () => Date.now() + S.skew;   // server clock (skew learned from /api/live)
const freeLeft = m => (m.freeRides > m.freeRidesMax ? `${m.freeRides} free rides (bonus)` : `${m.freeRides}/${m.freeRidesMax} free ride${m.freeRides === 1 ? '' : 's'}`);   // a promo can take the balance above the daily cap
const freeCd = m => m.nextFreeRideAt == null ? 'full' : `+1 in ${left(m.nextFreeRideAt - now())}`;   // the daily credit lands at 00:00 UTC, up to the cap

function paintHeader() {
  const m = S.me;
  $('chip-wallet').replaceChildren(el('span', { class: 'dot', style: `background:hsl(${hue(m.wallet)} 60% 50%)` }), short(m.wallet));
  $('chip-free').textContent = `${freeLeft(m)} · ${freeCd(m)}`;
  $('chip-live').textContent = liveChip();
  $('chip-demo').hidden = !m.demo; $('chip-demo').textContent = `DEMO ×${m.demoScale}`;
}

function go() {
  const t = location.hash.slice(1).split('/')[0];
  S.tab = TABS.includes(t) ? t : 'new'; seq++;
  track('lobby_tab_viewed', { tab: S.tab });   // hash enter, not the 1 s tick
  document.querySelectorAll('.tabs a').forEach(a => { const on = a.dataset.tab === S.tab; a.classList.toggle('on', on); a.setAttribute('aria-selected', on); });
  ({ new: renderNew, live: renderLive, replays: () => renderReplays(view, { me: S.me, ROUTES, TIER_NAME, dur, km, avatar }), board: renderBoard, garage: renderGarage, promo: renderPromo, profile: renderProfile })[S.tab]();
}

/* ───────── NEW RIDE ─────────
   One card per shift. A paid tier with an escrowed pool (tiers[].pool) is ridden with a TICKET (RIDE spends one, the ride is ready at once); buying tickets / refunds go through
   pay.js → tickets-api.js (not built server-side yet: shown as SOON). A paid tier without a pool keeps the legacy pay-per-ride order (buyRide). */
function renderNew() {
  view.replaceChildren(
    el('div', { class: 'card pool', id: 'poolbox' }), el('div', { id: 'pendingbox' }), el('div', { id: 'orderbox' }), el('div', { id: 'refunds' }),
    el('div', { id: 'freebox' }), el('h2', {}, 'PAID SHIFTS'), el('div', { class: 'tiers', id: 'tiers' }),
    el('div', { class: 'card', id: 'rules', style: 'margin-top:12px' }));
  paintPool(); paintPending(); paintTiers(); paintRules();
  refreshMe();   // free-ride count + tickets after a ride / refund
  if (salesOpen(S.tiers)) checkOrder();
}
const refreshMe = () => api('me').then(m => { S.me = m; paintHeader(); paintTiers(); }, () => {});

function paintPool() {
  const box = $('poolbox'), p = S.pool; if (!box) return;
  if (!p) { box.replaceChildren(el('span', { class: 'dim' }, 'Prize pool unavailable right now.')); return; }
  if (p.pools?.length) { box.replaceChildren(...escrowSummary(p, now(), salesOpen(S.tiers))); return; }
  const s = p.split, parts = [s.grand, s.top20, s.nextSeed, s.fees], total = parts.reduce((x, y) => x + y, 0), w = parts.map(x => (total ? (x / total) * 100 : 0)), pct = total ? w : [50, 20, 20, 10];
  const part = (cls, label, l, usd) => el('span', { class: cls }, `${label} `, el('b', {}, sol(l)), usd != null ? ` ≈ $${usd}` : '');
  box.replaceChildren(
    el('div', { class: 'lbl' }, 'GRAND PRIZE · ACCRUED THIS WEEK'),
    el('div', { class: 'big' }, sol(s.grand)), el('div', { class: 'usd' }, p.usd.grand != null ? `≈ $${p.usd.grand} at the current price` : ''),
    el('div', { class: 'split' }, ...['s-grand', 's-top', 's-seed', 's-fees'].map((c, i) => el('i', { class: c, style: `width:${pct[i]}%` }))),
    el('div', { class: 'legend' }, part('s-grand', '50% grand', s.grand), part('s-top', '20% top 20', s.top20), part('s-seed', '20% next week', s.nextSeed), part('s-fees', '10% fees', s.fees)),
    el('div', { class: 'dim' }, `${p.entries} paid entr${p.entries === 1 ? 'y' : 'ies'} · round closes in `, el('b', { id: 'cd', class: 'cd' }, left(p.round.endsAt - now())), ' · the draw and payouts are not live in this build'));
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
  const startIt = () => { track('pending_ride_start_clicked', { ride_id: r.id }); flushSoon(); location.href = `${GAME_BASE}/play.html?ride=${r.id}`; };
  box.replaceChildren(r ? el('div', { class: 'note' }, el('span', {}, el('b', {}, `Your paid ${TIER_NAME[r.tier] ?? r.tier} ride is waiting`), S.pendingNote ? ` · ${S.pendingNote}` : ''), el('button', { onclick: startIt }, 'START IT')) : S.pendingNote ? el('p', { class: 'dim' }, S.pendingNote) : '');
}

/* a ticket payment in flight (GET /api/tickets/pending – only once sales are on): RETRY CONFIRM uses the signature this browser kept */
async function checkOrder() {
  try { S.order = (await pendingOrder()).order; } catch { S.order = null; }
  paintOrder();
}
function paintOrder() {
  const box = $('orderbox'), o = S.order; if (!box) return;
  if (!o || o.status === 'paid') { box.replaceChildren(); return; }
  let sig = o.signature; try { sig ??= localStorage.getItem(ORDER_SIG(o.id)); } catch { /* private mode */ }
  const retry = () => busy('order', async () => {
    try { const r = await waitPaid(o.id, sig, { selfPaid: !!sig }); S.order = r.status === 'paid' ? null : r.order; await refreshMe(); } catch (e) { say('order', buyError(e), true); }
    paintOrder();
  });
  // with a signature something was sent ("in flight"); without one the wallet never sent it – say so, nothing was charged, the order just lapses
  const head = sig ? `A payment for ${o.qty} ticket${o.qty === 1 ? '' : 's'} is in flight` : `An unfinished order for ${o.qty} ticket${o.qty === 1 ? '' : 's'} – nothing was charged`;
  const tail = sig ? ` · ${sol(o.lamports)} · ${o.status}` : ` · ${sol(o.lamports)} · lapses at ${new Date(o.expiresAt).toUTCString().slice(17, 22)} UTC unless you pay it`;
  box.replaceChildren(el('div', { class: 'note' }, el('span', {}, el('b', {}, head), tail),
    el('button', { disabled: !!S.busy, onclick: retry }, sig ? 'RETRY CONFIRM' : 'CHECK AGAIN'), el('p', { class: 'msg dim', id: 'msg-order' })));
}

const tierInfo = t => {   // what the card shows: a demo wallet's paid shifts are shorter
  const scale = S.me.demo && t.id !== 'free' ? S.me.demoScale : 1, seconds = t.seconds / scale, dist = t.completeDist / scale;
  return { seconds, dist, scale, name: TIER_NAME[t.id] ?? t.id, shift: `${dur(seconds)} · ≥ ${km(dist)} km` };
};
function tierOff(t) {
  if (S.pending) return 'finish the paid ride waiting for you first';
  if (t.id === 'free') return S.me.freeRides <= 0 ? 'no free rides left – the next one at 00:00 UTC' : '';
  return t.available ? '' : 'not available right now';
}
function paintTiers() {
  const box = $('tiers'), fbox = $('freebox'); if (!box) return;
  if (!S.tiers) { box.replaceChildren(el('p', { class: 'bad' }, 'Could not load the ride list. Reload the page.')); return; }
  const ctx = { me: S.me, solUsd: S.tiers.solUsd, now: now(), busy: S.busy || S.pending, sales: salesOpen(S.tiers), focus: S.focus, act: { ride, buy, refund, qty: (id, n) => { S.qty[id] = n; paintTiers(); } } };
  const free = S.tiers.tiers.find(t => t.id === 'free');
  fbox.replaceChildren(...(free ? [freeCard(free)] : []));
  box.replaceChildren(...S.tiers.tiers.filter(t => t.id !== 'free').map(t => t.pool ? poolCard(t, tierInfo(t), { ...ctx, qty: S.qty[t.id] ?? 1 }) : salesOpen(S.tiers) ? noPoolCard(t) : legacyCard(t)));
  for (const [k, m] of Object.entries(S.msgs)) say(k, ...m);   // messages survive a repaint
  paintRefunds(); tickCountdowns();
}
function freeCard(t) {
  const off = tierOff(t), i = tierInfo(t);
  return el('article', { class: 'tier free', id: 'tier-free' },
    el('div', { class: 'freeinfo' },
      el('div', { class: 'hd' }, el('span', { class: 'nm' }, TIER_NAME.free), el('span', { class: 'st done' }, 'NO PRIZE')),
      el('span', { class: 'sub' }, i.shift),
      el('span', { class: 'sub more' }, 'Counts for the free leaderboard and achievements.'),
      off ? el('span', { class: 'tag' }, off) : ''),
    el('button', { class: 'go', id: 'start', disabled: !!off || !!S.busy, onclick: startFree }, S.busy === 'free' ? 'WORKING…' : 'START FREE RIDE'),
    el('p', { class: 'msg dim', id: 'msg-free' }));
}
function noPoolCard(t) {   // program mode is ticket-only: a paid tier whose pool failed / settled and no new one is open yet
  const i = tierInfo(t);
  return el('article', { class: 'tier legacy', id: `tier-${t.id}` },
    el('div', { class: 'hd' }, el('span', { class: 'nm' }, i.name), el('span', { class: 'st done' }, 'NO POOL')), el('span', { class: 'sub' }, i.shift),
    el('span', { class: 'sub' }, 'No pool open right now.'),
    el('button', { class: 'go', disabled: true }, 'NEXT POOL SOON'),
    el('p', { class: 'msg dim', id: `msg-${t.id}` }));
}
function legacyCard(t) {   // a paid tier with no pool registered: pay per ride (the old flow; removed with W3's order routes)
  const off = tierOff(t), i = tierInfo(t);
  return el('article', { class: 'tier legacy', id: `tier-${t.id}` },
    el('div', { class: 'hd' }, el('span', { class: 'nm' }, i.name), el('span', { class: 'st done' }, 'PAY PER RIDE')),
    el('span', { class: 'pr' }, `$${t.usd}`, el('small', {}, t.lamports ? ` · ${sol(t.lamports)}` : ' · price unavailable')), el('span', { class: 'sub' }, i.shift),
    el('span', { class: 'sub more' }, 'Price locked 10 min after you order. ', el('b', {}, 'Non-refundable'), ': goes to the weekly round (50% grand · 20% top 20 · 20% next week · 10% fees).', i.scale > 1 ? ` DEMO ×${i.scale}: shifts shortened for demos.` : ''),
    off ? el('span', { class: 'tag' }, off) : '',
    el('button', { class: 'go', disabled: !!off || !!S.busy, onclick: () => startLegacy(t.id) }, S.busy === t.id ? 'WORKING…' : `PAY $${t.usd}${t.lamports ? ` · ${sol(t.lamports)}` : ''} & START`),
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
    el('li', {}, 'Free rides: no fee, no prize. 5 at signup, +1 every UTC day.')));
}
/* per-card message lines (msg-<key>); kept in S.msgs so a repaint (poll, +/−) does not wipe them */
function say(key, text, bad = false, link = null) {   // link = { href, text } appended after the text (an explorer link)
  if (text) S.msgs[key] = [text, bad, link]; else delete S.msgs[key];
  const m = $(`msg-${key}`); if (m) { m.replaceChildren(text, link ? el('a', { href: link.href, target: '_blank', rel: 'noopener' }, link.text) : ''); m.className = `msg ${bad ? 'bad' : 'dim'}`; }
}
async function busy(key, fn) {
  if (S.busy) return;
  S.busy = key; for (const k of Object.keys(S.msgs)) say(k, ''); paintTiers();
  try { await fn(); } finally { S.busy = null; if ($('tiers')) paintTiers(); }
}
function play(r, tier) {
  if (r.tier !== tier) { checkPending(); say(tier, `You already have a ${TIER_NAME[r.tier] ?? r.tier} ride ready – start that one first.`, true); return; }   // never send you into the wrong ride silently
  flushSoon(); location.href = `${GAME_BASE}/play.html?ride=${r.id}`;
}
const clicked = (id, usd = 0) => track('ride_buy_clicked', { tier_id: id, is_free: id === 'free', price_usd: usd, is_demo: !!S.me?.demo });
const startFree = () => busy('free', async () => { clicked('free'); try { play(await api('rides', { tier: 'free' }), 'free'); } catch (e) { say('free', rideError(e, 'free'), true); } });
const startLegacy = id => busy(id, async () => { clicked(id, S.tiers?.tiers.find(t => t.id === id)?.usd ?? 0); try { play(await buyRide(id, text => say(id, text)), id); } catch (e) { say(id, rideError(e, id), true); } });
const ride = tier => busy(tier, async () => {   // spends one ticket: the ride is ready at once
  clicked(tier, S.tiers?.tiers.find(t => t.id === tier)?.usd ?? 0);
  say(tier, 'Spending a ticket…');
  try { play(await api('rides', { tier }), tier); } catch (e) { say(tier, rideError(e, tier), true); await refreshMe(); }
});
const buy = (tier, poolId, qty) => busy(tier, async () => {
  try { await buyTickets(poolId, qty, text => say(tier, text)); S.qty[tier] = 1; await Promise.all([refreshMe(), refreshPool()]); say(tier, `Paid – ${qty} ticket${qty === 1 ? '' : 's'} credited.`); } catch (e) { say(tier, buyError(e), true); }
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
  track('promo_redeem_clicked', { surface: S.tab === 'promo' ? 'promo' : 'new', prefilled: !!S.invited && code.replace(/\s+/g, '').toUpperCase() === S.invited }); S.invited = null;   // before the request; the server's promo_redeemed is the outcome
  go.disabled = true; show('Redeeming…', 'dim');
  try {
    const r = await api('promo/redeem', { code }); input.value = ''; show(promoOk(r), 'good'); if (r.kind === 'tickets') S.focus = r.tier;
    await refreshMe();
    S.garage = null;   // a new part: the GARAGE reloads next time it is opened
    if (S.tab === 'promo') await paintPromoLists();   // the new code in the list
  } catch (err) { show(promoError(err), 'bad'); } finally { go.disabled = false; }
}

/* ───────── PROMO ─────────
   The code field (a code from the landing's invite block arrives as ?promo=CODE and only PRE-FILLS it – the player clicks REDEEM) and what this wallet redeemed. The parts are in the GARAGE. */
function renderPromo() {
  view.replaceChildren(el('p', { class: 'dim' }, 'Redeem codes in the box at the top. Parts you unlock are waiting in your ', el('a', { href: '#garage' }, 'garage →')),
    el('h2', {}, 'CODES YOU REDEEMED'), el('div', { id: 'mycodes' }, el('p', { class: 'dim' }, 'Loading…')));
  if (S.invite) { $('promo-code').value = S.invite; S.invited = S.invite.replace(/\s+/g, '').toUpperCase(); S.invite = null; $('promo-code').focus(); }
  paintPromoLists();
}
async function paintPromoLists() {
  const my = seq, mine = await api('promo/mine', undefined, { report: false }).catch(e => e);
  if (my !== seq) return;
  const codes = $('mycodes'); if (!codes) return;
  codes.replaceChildren(mine instanceof Error ? el('p', { class: 'bad' }, `Could not load your codes (${mine.message}).`) : redemptionList(mine.redemptions));
}

/* ───────── GARAGE ─────────
   Every part of the catalog, what this wallet owns (and from which code), the collection progress, a preview with the parts picked, and SAVE: the selection goes to the
   database (POST /api/garage/loadout) and the next ride starts with it. S.garage = the server's answer, S.pick = what is selected now (not saved until SAVE). */
async function renderGarage() {
  view.replaceChildren(el('p', { class: 'dim' }, 'Loading…'));
  const my = seq;
  if (!S.garage) {
    try { const g = await api('garage', undefined, { report: false }); if (my !== seq) return; S.garage = g; S.pick = { ...g.equipped }; } catch (e) { if (my === seq) view.replaceChildren(el('p', { class: 'bad' }, e.message)); return; }
  }
  if (my === seq) paintGarage();
}
function paintGarage(note) {
  const g = S.garage; if (!g || S.tab !== 'garage') return;
  view.replaceChildren(el('h2', {}, 'YOUR GARAGE'), garageProgress(g), garagePreview(S.pick), garageSlots(g, S.pick, pickPart),
    garageActions({ garage: g, pick: S.pick, busy: !!S.saving, onSave: saveGarage, onReset: () => { S.pick = { ...g.equipped }; paintGarage(); } }));
  if (note) { const m = $('garage-msg'); m.textContent = note.text; m.className = `msg ${note.bad ? 'bad' : 'good'}`; }
}
function pickPart(slot, part) {
  track('garage_part_clicked', { slot, item: part.id, owned: part.owned });
  if (!part.owned) { paintGarage({ text: `${part.id} is locked – a promo code unlocks it. Redeem one on the PROMO tab.`, bad: true }); return; }
  S.pick = { ...S.pick, [slot]: part.id };
  paintGarage();
}
async function saveGarage() {
  if (S.saving || !S.garage || !dirty(S.garage, S.pick)) return;
  S.saving = true; paintGarage();
  const picks = Object.fromEntries(Object.entries(S.pick).filter(([slot, item]) => item !== S.garage.equipped[slot]));
  let note;
  try { S.garage = await api('garage/loadout', { loadout: picks }); S.pick = { ...S.garage.equipped }; note = { text: 'Saved – your next ride starts with this loadout.' }; }
  catch (e) { note = { text: e.message, bad: true }; }
  S.saving = false; paintGarage(note);
}

/* ───────── LIVE ─────────
   Every ride on the air (the stale-ride sweeper ends the ones whose tab vanished), with how many watch it and its signal; sort / filter to pick one and
   ▶ WATCH it (the "join": the watch page, ~25 s behind the driver – chat and donations from there). */
const rows = new Map();   // wallet|startedAt → { root, … }
const liveChip = () => { const o = S.live.online; return `${o ? `${o.total} online · ` : ''}${S.live.rides.length} on the road`; };
const SORTS = { newest: (a, b) => b.startedAt - a.startedAt, watched: (a, b) => b.viewers - a.viewers || b.startedAt - a.startedAt, furthest: (a, b) => b.distance - a.distance };
function liveControls() {
  const sort = el('select', { id: 'live-sort', 'aria-label': 'sort the rides', onchange: e => { S.liveSort = e.target.value; paintLive(); } },
    ...[['newest', 'newest first'], ['watched', 'most watched'], ['furthest', 'furthest']].map(([v, t]) => el('option', { value: v, selected: (S.liveSort ?? 'newest') === v }, t)));
  const route = el('select', { id: 'live-route', 'aria-label': 'only one route', onchange: e => { S.liveRoute = e.target.value; paintLive(); } },
    el('option', { value: '' }, 'every route'), ...Object.entries(ROUTES).map(([v, t]) => el('option', { value: v, selected: S.liveRoute === v }, t)));
  const random = el('button', { type: 'button', class: 'alt', id: 'live-random', title: 'open a ride on the air at random', onclick: () => {
    const pool = S.live.rides.filter(r => r.signal !== 'weak' && r.wallet !== S.me.wallet); if (!pool.length) return;
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
  const rides = S.live.rides, keys = new Set();
  const o = S.live.online; if ($('live-online')) $('live-online').textContent = o ? `${o.total} online now: ${o.browsing} looking around, ${o.watching} watching, ${o.driving} driving (${o.players} signed in).` : '';
  if ($('live-random')) $('live-random').disabled = !rides.some(r => r.signal !== 'weak' && r.wallet !== S.me.wallet);
  if (!rides.length) { rows.clear(); box.replaceChildren(el('div', { class: 'card empty' }, 'No trucks on the road right now.', el('br'), el('a', { href: '#new' }, 'Be the first →'), ' · ', el('a', { href: '#replays' }, 'or watch a replay →'))); return; }
  box.querySelector('.empty')?.remove();
  for (const r of rides) {
    const k = `${r.wallet}|${r.startedAt}`; keys.add(k);
    let row = rows.get(k);
    if (!row) {
      row = { fill: el('div', { class: 'fill' }), truck: el('span', { class: 'truck' }, '⛟'), time: el('b'), dist: el('b'), hull: el('b'), eyes: el('b'), badge: el('span', { class: 'badge' }) };
      row.root = el('div', { class: 'card ride' }, avatar(r.wallet),
        el('div', { class: 'who' }, el('b', {}, short(r.wallet), r.wallet === S.me.wallet ? ' (you)' : ''), el('span', { class: `badge${r.tier === 'free' ? '' : ' p'}` }, TIER_NAME[r.tier] ?? r.tier), r.route ? el('span', { class: 'badge' }, ROUTES[r.route] ?? '') : '', r.timeScale > 1 ? el('span', { class: 'badge d' }, `DEMO ×${r.timeScale}`) : '', row.badge),
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
  const n = S.live.rides.length;
  $('chip-live').textContent = liveChip(); $('tab-live-n').textContent = n || '';
  if (S.tab === 'live') paintLive();
}

/* ───────── LEADERBOARD ───────── */
async function renderBoard() {
  view.replaceChildren(el('p', { class: 'dim' }, 'Loading…'));
  let j; const my = ++seq;
  try { j = await api(`leaderboard?board=${S.board}`, undefined, { report: false }); } catch (e) { if (my === seq) view.replaceChildren(el('p', { class: 'bad' }, e.message)); return; }
  if (my !== seq) return;   // switched away (or re-asked) while loading
  track('leaderboard_filtered', { board: S.board });
  const seg = el('div', { class: 'seg' }, ...[['round', 'THIS ROUND'], ['all', 'ALL TIME'], ['free', 'FREE RIDES']].map(([id, label]) => el('button', { class: id === S.board ? 'on' : '', onclick: () => { S.board = id; renderBoard(); } }, label)));
  const prize = S.board === 'round', mine = j.rows.find(r => r.wallet === S.me.wallet);
  view.replaceChildren(
    el('h2', {}, 'LEADERBOARD'), seg,
    prize ? el('p', { class: 'dim' }, `Ranked by distance of finished${j.verifiedOnly ? ', verified' : ''} paid shifts${j.verifiedOnly ? '' : ' (recording checks are shown in your profile, not enforced yet)'}. The top ${j.prizeRanks} share `, el('b', {}, '20%'), S.pool ? ` of the round’s entries (${sol(S.pool.split.top20)} so far)` : '', ' · closes in ', el('b', { class: 'cd', id: 'cd' }, left(j.round.endsAt - now()))) : el('p', { class: 'dim' }, S.board === 'all' ? `All finished${j.verifiedOnly ? ', verified' : ''} paid shifts, all time.` : 'Finished free rides, all time. No prizes – bragging rights.'),
    j.rows.length ? el('div', { class: 'card' }, el('table', {}, el('thead', {}, el('tr', {}, el('th', {}, '#'), el('th', {}, 'RIDER'), el('th', { class: 'r' }, 'KM'), el('th', { class: 'r' }, 'SHIFTS'))),
      el('tbody', {}, j.rows.map(r => el('tr', { class: `${prize ? 'prize' : ''}${r.wallet === S.me.wallet ? ' me' : ''}` },
        el('td', {}, el('span', { class: `rk${r.rank === 1 ? ' g' : r.rank === 2 ? ' s' : r.rank === 3 ? ' b' : ''}` }, r.rank)),
        el('td', {}, avatar(r.wallet), ' ', short(r.wallet), r.wallet === S.me.wallet ? ' (you)' : ''), el('td', { class: 'r' }, km(r.distance)), el('td', { class: 'r' }, r.rides)))))) : el('div', { class: 'card empty' }, 'Nobody has finished a shift here yet.'),
    el('p', { class: 'dim' }, mine ? `You are #${mine.rank}.` : 'You are not on this board yet – finish a shift.'));
}

/* ───────── PROFILE ───────── */
async function renderProfile() {
  view.replaceChildren(el('p', { class: 'dim' }, 'Loading…'));
  let p; const my = seq;
  try { p = await api('profile', undefined, { report: false }); } catch (e) { if (my === seq) view.replaceChildren(el('p', { class: 'bad' }, e.message)); return; }
  if (my !== seq) return;
  Object.assign(S.me, { freeRides: p.freeRides, freeRidesMax: p.freeRidesMax, nextFreeRideAt: p.nextFreeRideAt, tickets: p.tickets }); paintHeader();
  const tile = (v, l) => el('div', { class: 'tile' }, el('b', {}, v), el('span', {}, l)), got = p.achievements.filter(a => a.earnedAt).length;
  view.replaceChildren(
    el('div', { class: 'who', style: 'display:flex;gap:10px;align-items:center' }, avatar(p.wallet), el('div', {}, el('b', {}, short(p.wallet)), el('div', { class: 'dim' }, `rider since ${new Date(p.createdAt).toLocaleDateString()}`))),
    el('h2', {}, 'STATS'),
    el('div', { class: 'tiles' }, tile(p.stats.rides, 'rides started'), tile(p.stats.completed, 'shifts finished'), tile(km(p.stats.metres), 'km driven'), tile(km(p.stats.bestMetres), 'best shift, km'), tile(p.stats.paidRides, 'paid rides'), tile(sol(p.stats.spentLamports), 'spent'), p.stats.ticketsBought != null ? tile(p.stats.ticketsBought, 'tickets bought') : ''),
    ...profileTickets(p, S.busy, refund),
    el('h2', {}, `ACHIEVEMENTS · ${got}/${p.achievements.length}`),
    el('div', { class: 'ach' }, p.achievements.map(a => el('div', { class: `a${a.earnedAt ? '' : ' lock'}${a.awardedAtRoundClose ? ' soon' : ''}` }, el('span', { class: 'ic' }, a.icon), el('span', { class: 'nm' }, a.name), el('span', { class: 'ds' }, a.desc),
      el('span', { class: 'when' }, a.earnedAt ? `unlocked ${new Date(a.earnedAt).toLocaleDateString()}` : a.awardedAtRoundClose ? 'awarded when the round closes' : 'locked')))),
    el('p', { class: 'dim' }, 'Achievements become NFTs in your wallet soon – they are recorded now and can’t be lost.'),
        el('h2', {}, 'RECENT RIDES'),
    p.recent.length ? el('div', { class: 'hist' }, p.recent.map(r => el('div', { class: 'hrow' },
      el('span', {}, new Date(r.startedAt).toLocaleString(), ' · ', TIER_NAME[r.tier] ?? r.tier, r.route ? ` · ${ROUTES[r.route] ?? ''}` : '', r.timeScale > 1 ? ` · DEMO ×${r.timeScale}` : ''),
      el('span', {}, `${km(r.distance)} km · `, el('b', { class: r.status === 'completed' ? 'good' : 'bad' }, r.status.toUpperCase()),
        r.verdict ? el('b', { class: r.verdict === 'verified' ? 'good' : 'bad', title: 'recording check – only verified shifts rank' }, ` · ${r.verdict.toUpperCase()}`) : '')))) : el('div', { class: 'card empty' }, 'No rides yet – start one!'));
}

/* ───────── refresh + 1 s tick ───────── */
async function refreshPool() {   // the pot + every pool's progress (sold / escrow) – both are public and move while you look. Polls do not report api_request_failed.
  const [p, t] = await Promise.all([api('pool', undefined, { report: false }).catch(() => null), S.tab === 'new' ? api('tiers', undefined, { report: false }).catch(() => null) : null]);
  if (p) S.pool = p;
  if (t) S.tiers = t;
  if (S.tab === 'new') { paintPool(); if (t && !S.busy) paintTiers(); }
}
function tickCountdowns() { const n = now(); document.querySelectorAll('.pcd[data-at]').forEach(c => { c.textContent = left(+c.dataset.at - n); }); }
function tickFree() {   // the "next free ride" counter; at 00:00 UTC ask the server (it grants, then says when the next one comes)
  const m = S.me; if (!m) return;
  $('chip-free').textContent = `${freeLeft(m)} · ${freeCd(m)}`;
  document.querySelectorAll('.fr-cd').forEach(n => { n.textContent = freeCd(m); });
  if (m.nextFreeRideAt != null && now() >= m.nextFreeRideAt && (S.meMiss ?? 0) < 3 && Date.now() - (S.meAt ?? 0) > 5000) {   // gives up after 3 refreshes that bring no new time (clock skew); a reload retries
    S.meAt = Date.now();
    api('me', undefined, { report: false }).then(x => { S.meMiss = x.nextFreeRideAt === m.nextFreeRideAt ? (S.meMiss ?? 0) + 1 : 0; S.me = x; paintHeader(); paintTiers(); }, () => { S.meMiss = (S.meMiss ?? 0) + 1; });
  }
}
function tick() {
  tickFree();
  if (S.pool) { const c = $('cd'); if (c) c.textContent = left(S.pool.round.endsAt - now()); }
  if (S.tab === 'new') tickCountdowns();
  if (S.tab === 'live' && !document.hidden) tickLive();
}

/* ───────── boot (last on purpose: everything above is `const`, initialised only once the module has run that far) ───────── */
for (const a of document.querySelectorAll('a[href="/play.html"]')) a.addEventListener('click', () => { track('offline_practice_clicked'); flushSoon(); });
try { S.me = await api('me'); } catch { flushSoon(); location.href = '/'; }   // reporting GET: a failure here is api_request_failed, then back to the landing
if (S.me) {
  track('session_restored', { surface: 'lobby', wallet: S.me.wallet, ...(S.me.demo ? { is_demo: true } : {}) });
  const viewed = { is_demo: !!S.me.demo };
  if (S.pool?.round?.id != null) viewed.round_id = S.pool.round.id;   // pool is not loaded yet; do not delay the pageview for it
  track('lobby_viewed', viewed);
  paintHeader();
  for (const a of document.querySelectorAll('a[href="/play.html"]')) a.href = `${GAME_BASE}/play.html`;   // the static footer link: the game is on ride.<apex> in production
  $('promo').onsubmit = redeem;
  $('out').onclick = async () => { track('player_signed_out'); flushSoon(); await signOut(); location.href = '/'; };
  [S.tiers, S.pool] = await Promise.all([api('tiers', undefined, { report: false }).catch(() => null), api('pool', undefined, { report: false }).catch(() => null)]);
  await pollLive();
  const invite = new URLSearchParams(location.search).get('promo');   // the landing's invite block: lobby.html?promo=CODE – pre-fills the PROMO tab, never redeems by itself
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
