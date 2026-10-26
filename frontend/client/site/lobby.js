import '../js/crash-boot.js';   // before the lobby's modules: a throw while they load is still reported
import { api, signOut } from './wallet.js';
import { paidChip, left, span } from './pools.js';
import { achievementsSection } from './lobby-achievements.js';
import { bindStoredRef, captureRef, searchWithoutRef } from './referral.js';
import { dirty, garageActions, garageDetail, garageProgress, garageSlots, partAt, previewLoadout } from './lobby-garage.js';
import { garageCab } from './garage-cab.js';
import { $, el } from './dom.js';
import { hue, dur } from './ui.js';
import { livePath, leaveOnClose } from './presence.js';
import { renderReplays } from './lobby-replays.js';
import { renderBoard } from './lobby-board.js';
import { createNewRideTab } from './lobby-new.js';
import { createLiveTab } from './lobby-live.js';
import { createProfileTab } from './lobby-profile.js';
import { API_BASE, GAME_BASE, SITE_BASE } from '../js/hosts.js';
import { track, flushSoon } from '../js/analytics.js';
import { reportWebVitals } from '../js/web-vitals.js';
import { store } from '../js/util.js';
import { bootI18n } from './i18n.js';
import { TOKEN_SYMBOL } from '../js/config.js';
import { isMobileDevice, showMobileToast } from '../js/mobile.js';
import { formatDriver, seedSns } from './sns.js';

/* The lobby: NEW RIDE · LIVE · REPLAYS · LEADERBOARD · ACHIEVEMENTS · GARAGE · PROFILE. Vanilla DOM, no framework.
   Everything that comes from the server (wallet addresses, route ids, statuses…) goes in with textContent – never innerHTML – because other riders' data is rendered here. */
reportWebVitals('lobby');   // before the session check, so a bounce back to the landing still reports the load
const view = $('view');
const ROUTES = { route66: 'Route 66', stuart: 'Stuart Hwy', siberia: 'Trans-Siberian', brenner: 'Brenner Pass', panamerican: 'Pan-American' };   // = client/js/themes ids
const TIER_NAME = { free: 'TRAINING', '1h': 'STANDARD SHIFT', '4h': '4 HOURS', '8h': '8 HOURS' };
const TABS = ['new', 'live', 'replays', 'board', 'achievements', 'garage', 'profile'];
const TAB_ALIAS = { promo: 'profile' };   // the old PROMO tab (the landing's invite link, bookmarks) lives in the PROFILE now

const avatar = w => el('span', { class: 'av', style: `background:hsl(${hue(w)} 60% 50%)` });
const km = m => (m / 1000).toFixed(m < 10_000 ? 2 : 1);

/* ───────── state ───────── */
const S = { me: null, tiers: null, pool: null, live: { rides: [] }, liveAt: 0, skew: 0, board: 'free', boardLevel: Number(store.get('freightchain.board-level')) || 3, boardTier: '1h', pending: null, pendingNote: '', pools: null, standings: {}, stAt: {}, tab: 'new', busy: null, qty: {}, msgs: {}, poolInfo: {}, order: null, focus: null, opt: { tutorial: null, assist: store.get('freightchain.assist') !== '0', level: Number(store.get('freightchain.level')) || 1 } };
let seq = 0, meGen = 0, honkTicket = 0;
const now = () => Date.now() + S.skew;
const freeLeft = () => 'training · unlimited';   // no counted balance. Statistics and achievements still count; the ride is not ranked and not a prize entry
const weeklyChip = m => {   // granted paid tickets (AMOE). Unspent until ordered. Each dies at its next interval or Sunday 12:00 UTC
  const live = (m.weeklyTickets ?? []).filter(t => !t.rideId && t.expiresAt > now());
  if (!live.length) return '';
  return ` · weekly ${live.map(t => t.tier).join(' ')}`;
};

function tickCountdowns() {
  const n = now();
  document.querySelectorAll('.pcd[data-at]').forEach(c => { c.textContent = left(+c.dataset.at - n); });
  document.querySelectorAll('.phcd[data-at]').forEach(c => { c.textContent = span(+c.dataset.at - n); });
}

const liveTab = createLiveTab({ S, view, dur, km, avatar, ROUTES, TIER_NAME });

function paintHeader() {
  const m = S.me;
  if (m.sns) seedSns(m.wallet, m.sns);
  $('chip-wallet').replaceChildren(el('span', { class: 'dot', style: `background:hsl(${hue(m.wallet)} 60% 50%)` }), formatDriver(m.wallet, m.sns));
  $('chip-wallet').title = m.wallet;
  $('chip-free').textContent = `${freeLeft()}${weeklyChip(m)}`;
  $('chip-paid').textContent = paidChip(m.tickets);
  $('chip-live').textContent = liveTab.liveChip();
}

const takeMe = m => { S.me = m; paintHeader(); if ($('tiers')) newTab.paintTiers(); };
addEventListener('fc:terms-accepted', () => { refreshMe(); if (S.tab === 'profile') profileTab.renderProfile(); });
const refreshMe = () => { const gen = ++meGen; return api('me').then(m => { if (gen === meGen) takeMe(m); return m; }, () => {}); };

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

async function refreshPool() {
  const [p, t, l] = await Promise.all([api('pool', undefined, { report: false }).catch(() => null), ...(S.tab === 'new' ? ['tiers', 'pools'].map(x => api(x, undefined, { report: false }).catch(() => null)) : [])]);
  if (p) S.pool = p;
  if (t) S.tiers = t;
  if (l) S.pools = l;
  if (S.tab === 'new') { newTab.paintPool(); if (t && !S.busy) newTab.paintTiers(); }
}

const newTab = createNewRideTab({ S, view, now, dur, km, TIER_NAME, refreshMe, refreshPool, creditLocal, tickCountdowns });
const profileTab = createProfileTab({ S, view, getSeq: () => seq, bumpMeGen: () => { meGen++; }, paintHeader, refreshMe, refund: newTab.refund, play: newTab.play, km, avatar, ROUTES, TIER_NAME });

/* ───────── GARAGE ───────── */
const catalogRows = body => Array.isArray(body) ? body : Array.isArray(body?.items) ? body.items : Array.isArray(body?.catalog) ? body.catalog : Array.isArray(body?.visuals) ? body.visuals : [];
const asHonk = v => (typeof v === 'number' && Number.isFinite(v) ? String(v) : typeof v === 'string' && v.trim() ? v.trim() : null);

function refreshHonk(my) {
  const ticket = ++honkTicket;
  api('honk', undefined, { report: false }).then(body => {
    if (my !== seq || ticket !== honkTicket) return;
    S.honkProgram = body?.chain?.programId ?? null;
    showHonk(asHonk(body?.balance));
  }).catch(() => { if (my !== seq || ticket !== honkTicket) return; showHonk(null); });
}
function showHonk(amount) {
  S.honkBalance = amount;
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
  refreshHonk(my);
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
      const seen = partAt(cur, S.observe); if (!seen || seen.part.owned) S.observe = null;
      paintGarage();
    } }));
  cab().set(previewLoadout(g, S.pick, S.observe));
  if (note) { const m = $('garage-msg'); m.textContent = note.text; m.className = `msg ${note.bad ? 'bad' : 'good'}`; }
}
function pickPart(slot, part) {
  track('garage_part_clicked', { slot, item: part.id, owned: part.owned });
  S.observe = { slot, id: part.id };
  if (part.owned) S.pick = { ...S.pick, [slot]: part.id };
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
    if (got != null) { honkTicket++; S.honkBalance = got; }
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

/* ───────── ACHIEVEMENTS ───────── */
async function renderAchievements() {
  view.replaceChildren(el('p', { class: 'dim' }, 'Loading…'));
  const my = seq;
  try { const p = await api('profile', undefined, { report: false }); if (my === seq) view.replaceChildren(...achievementsSection(p.achievements, track, p.badgeChain)); } catch (e) { if (my === seq) view.replaceChildren(el('p', { class: 'bad' }, e.message)); }
}

function go() {
  const t = location.hash.slice(1).split('/')[0];
  const tab = TAB_ALIAS[t] ?? t; S.tab = TABS.includes(tab) ? tab : 'new'; seq++;
  track('lobby_tab_viewed', { tab: S.tab });
  document.querySelectorAll('.tabs a').forEach(a => { const on = a.dataset.tab === S.tab; a.classList.toggle('on', on); a.setAttribute('aria-selected', on); });
  ({ new: newTab.renderNew, live: liveTab.renderLive, replays: () => renderReplays(view, { me: S.me, ROUTES, TIER_NAME, dur, km, avatar }), board: () => renderBoard(view, { S, now, track, km, dur, avatar }), achievements: renderAchievements, garage: renderGarage, profile: profileTab.renderProfile })[S.tab]();
}

function tickFree() {   // the weekly ticket drops off the chip when Sunday 12:00 UTC passes. Training has no countdown
  const m = S.me; if (!m) return;
  $('chip-free').textContent = `${freeLeft()}${weeklyChip(m)}`;
}

function tick() {
  tickFree();
  if (S.pool) { const c = $('cd'); if (c) c.textContent = left(S.pool.round.endsAt - now()); }
  if (S.tab === 'new') tickCountdowns();
  if (S.tab === 'live' && !document.hidden) liveTab.tickLive();
}

for (const a of document.querySelectorAll('a[href="/play.html"]')) a.addEventListener('click', e => {
  if (isMobileDevice()) {
    e.preventDefault();
    showMobileToast({ liveAction: () => { location.hash = '#live'; }, replaysAction: () => { location.hash = '#replays'; } });
    return;
  }
  track('offline_practice_clicked'); flushSoon();
});
bootI18n();
for (const a of document.querySelectorAll('[data-legal]')) a.href = `${SITE_BASE}/${a.dataset.legal}/`;
captureRef(store, location.search);
{ const next = searchWithoutRef(location.search); if (next != null) history.replaceState(null, '', `${location.pathname}${next}${location.hash}`); }
try { S.me = await api('me'); } catch { flushSoon(); location.href = '/'; }
if (S.me) {
  try { await bindStoredRef(api, store); } catch { /* kept in storage; the next signed-in load tries again */ }
  track('session_restored', { surface: 'lobby', wallet: S.me.wallet, ...(S.me.demo ? { is_demo: true } : {}) });
  const viewed = { is_demo: !!S.me.demo };
  if (S.pool?.round?.id != null) viewed.round_id = S.pool.round.id;
  track('lobby_viewed', viewed);
  paintHeader();
  for (const a of document.querySelectorAll('a[href="/play.html"]')) a.href = `${GAME_BASE}/play.html`;   // bare play.html orders the real EASY ride. Paid and watch links already carry their own query
  $('out').onclick = async () => { track('player_signed_out'); flushSoon(); await signOut(); location.href = '/'; };
  [S.tiers, S.pool, S.pools] = await Promise.all(['tiers', 'pool', 'pools'].map(x => api(x, undefined, { report: false }).catch(() => null)));
  await liveTab.pollLive();
  const invite = new URLSearchParams(location.search).get('promo');
  if (invite?.trim()) { S.invite = invite.trim().slice(0, 64); history.replaceState(null, '', `${location.pathname}#promo`); }
  go();
  newTab.checkPending();
  addEventListener('hashchange', go);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { liveTab.pollLive(); refreshPool(); } });
  setInterval(() => { if (!document.hidden) liveTab.pollLive(); }, 5000);
  leaveOnClose(() => `${API_BASE}/api/${livePath('lobby')}&leave=1`);
  setInterval(() => { if (!document.hidden && (S.tab === 'new' || S.tab === 'board')) refreshPool(); }, 15000);
  setInterval(tick, 1000);
}
