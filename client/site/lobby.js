import { api, signOut } from './wallet.js';
import { buyRide } from './pay.js';

/* The lobby: NEW RIDE · LIVE · LEADERBOARD · PROFILE. Vanilla DOM, no framework.
   Everything that comes from the server (wallet addresses, route ids, statuses…) goes in with textContent – never innerHTML – because other riders' data is rendered here. */
const $ = id => document.getElementById(id);
const view = $('view');
const ROUTES = { route66: 'Route 66', stuart: 'Stuart Hwy', siberia: 'Trans-Siberian', brenner: 'Brenner Pass', panamerican: 'Pan-American' };   // = client/js/themes ids
const TIER_NAME = { free: 'TEST RIDE', '1h': '1 HOUR', '4h': '4 HOURS', '8h': '8 HOURS' };
const TABS = ['new', 'live', 'board', 'profile'];

/* ───────── helpers ───────── */
function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return e;
}
const short = w => `${w.slice(0, 4)}…${w.slice(-4)}`;
const hue = w => { let h = 0; for (const c of w) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
const avatar = w => el('span', { class: 'av', style: `background:hsl(${hue(w)} 60% 50%)` });
const pad = n => String(Math.floor(n)).padStart(2, '0');
const dur = s => { s = Math.max(0, Math.round(s)); return s >= 3600 ? `${Math.floor(s / 3600)}:${pad((s % 3600) / 60)}:${pad(s % 60)}` : `${Math.floor(s / 60)}:${pad(s % 60)}`; };
const km = m => (m / 1000).toFixed(m < 10_000 ? 2 : 1);
const sol = l => `${(l / 1e9).toFixed(l >= 1e9 ? 2 : 3)} SOL`;
const left = ms => { const s = Math.max(0, Math.floor(ms / 1000)), d = Math.floor(s / 86400); return `${d ? d + 'd ' : ''}${pad((s % 86400) / 3600)}:${pad((s % 3600) / 60)}:${pad(s % 60)}`; };

/* ───────── state ───────── */
const S = { me: null, tiers: null, pool: null, live: { rides: [] }, liveAt: 0, skew: 0, sel: null, board: 'round', pending: null, pendingNote: '', tab: 'new', busy: false };
const now = () => Date.now() + S.skew;   // server clock (skew learned from /api/live)

function paintHeader() {
  const m = S.me;
  $('chip-wallet').replaceChildren(el('span', { class: 'dot', style: `background:hsl(${hue(m.wallet)} 60% 50%)` }), short(m.wallet));
  $('chip-free').textContent = `${m.freeRides} free ride${m.freeRides === 1 ? '' : 's'}`;
  $('chip-live').textContent = `${S.live.rides.length} on the road`;
  $('chip-demo').hidden = !m.demo; $('chip-demo').textContent = `DEMO ×${m.demoScale}`;
}

function go() {
  const t = location.hash.slice(1).split('/')[0];
  S.tab = TABS.includes(t) ? t : 'new';
  document.querySelectorAll('.tabs a').forEach(a => { const on = a.dataset.tab === S.tab; a.classList.toggle('on', on); a.setAttribute('aria-selected', on); });
  ({ new: renderNew, live: renderLive, board: renderBoard, profile: renderProfile })[S.tab]();
}

/* ───────── NEW RIDE ───────── */
function renderNew() {
  view.replaceChildren(
    el('div', { class: 'card pool', id: 'poolbox' }), el('div', { id: 'pendingbox' }),
    el('h2', {}, 'CHOOSE YOUR SHIFT'), el('div', { class: 'tiers', id: 'tiers' }),
    el('div', { class: 'card', id: 'rules', style: 'margin-top:12px' }),
    el('button', { class: 'start', id: 'start', onclick: start }), el('p', { class: 'msg dim', id: 'msg' }));
  paintPool(); paintPending(); paintTiers();
  api('me').then(m => { S.me = m; paintHeader(); paintTiers(); }, () => {});   // free-ride count after a ride / refund
}

function paintPool() {
  const box = $('poolbox'), p = S.pool; if (!box) return;
  if (!p) { box.replaceChildren(el('span', { class: 'dim' }, 'Prize pool unavailable right now.')); return; }
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
    let { ride } = await api('rides/pending');
    if (ride && ride.status !== 'created') {   // an order that may have been paid with the page closed: look for the payment ONCE
      S.pendingNote = 'Checking for an earlier payment…'; paintPending();
      const r = await api(`rides/${ride.id}/reconcile`, {}); ride = r.status === 'paid' ? r.ride : null;
      S.pendingNote = ride ? 'Your earlier payment was found.' : '';
    }
    S.pending = ride?.status === 'created' ? ride : null;
  } catch (e) { S.pendingNote = `Could not check for earlier payments (${e.message}).`; }
  paintPending(); paintTiers();
}
function paintPending() {
  const box = $('pendingbox'); if (!box) return;
  const r = S.pending;
  box.replaceChildren(r ? el('div', { class: 'note' }, el('span', {}, el('b', {}, `Your paid ${TIER_NAME[r.tier] ?? r.tier} ride is waiting`), S.pendingNote ? ` · ${S.pendingNote}` : ''), el('button', { onclick: () => { location.href = `/play.html?ride=${r.id}`; } }, 'START IT')) : S.pendingNote ? el('p', { class: 'dim' }, S.pendingNote) : '');
}

const tierInfo = t => {   // what the card shows: a demo wallet's paid shifts are shorter
  const scale = S.me.demo && t.usd > 0 ? S.me.demoScale : 1;
  return { seconds: t.seconds / scale, dist: t.completeDist / scale, scale };
};
function tierOff(t) {
  if (S.pending) return 'finish the paid ride waiting for you first';
  if (t.id === 'free') return S.me.freeRides <= 0 ? 'no free rides left – +1 at 00:00 UTC' : '';
  return t.available ? '' : 'not available right now';
}
function paintTiers() {
  const box = $('tiers'); if (!box) return;
  if (!S.tiers) { box.replaceChildren(el('p', { class: 'bad' }, 'Could not load the ride list. Reload the page.')); return; }
  const list = S.tiers.tiers;
  if (!S.sel || tierOff(list.find(t => t.id === S.sel) ?? {})) S.sel = (list.find(t => !tierOff(t)) ?? list[1]).id;
  box.replaceChildren(...list.map(t => {
    const i = tierInfo(t), off = tierOff(t);
    return el('button', { class: `tier${t.id === S.sel ? ' sel' : ''}`, disabled: !!off || S.busy, 'aria-pressed': String(t.id === S.sel), onclick: () => { S.sel = t.id; paintTiers(); } },
      el('span', { class: 'nm' }, TIER_NAME[t.id]),
      el('span', { class: 'pr' }, t.usd ? `$${t.usd}` : 'FREE'),
      el('span', { class: 'sub' }, t.usd ? (t.lamports ? sol(t.lamports) : 'price unavailable') : `${S.me.freeRides} left`),
      el('span', { class: 'sub' }, `${dur(i.seconds)} · ≥ ${km(i.dist)} km${i.scale > 1 ? ` · DEMO ×${i.scale}` : ''}`),
      off ? el('span', { class: 'tag' }, off) : '');
  }));
  paintRules(); paintStart();
}
function paintRules() {
  const t = S.tiers.tiers.find(x => x.id === S.sel), i = tierInfo(t), paid = t.usd > 0;
  $('rules').replaceChildren(el('b', {}, 'CONDITIONS'), el('ul', { class: 'rules' },
    el('li', {}, 'Drive the whole shift: ', el('b', {}, dur(i.seconds)), ' AND at least ', el('b', {}, `${km(i.dist)} km`), '. Speed is capped at 100 km/h, so idling can’t bank it.'),
    el('li', {}, 'End the shift early, abandon it or crash and it does ', el('b', {}, 'not'), ' count as finished.'),
    paid ? [
      el('li', {}, 'Entry ', el('b', {}, `$${t.usd}`), ' in devnet SOL, price locked for 10 minutes once you order. It is ', el('b', {}, 'non-refundable'), ' and always goes into the pool (50% grand · 20% top 20 · 20% next week · 10% fees).'),
      el('li', {}, 'Finished shifts qualify for the weekly prizes (grand prize draw, top 20 by distance). Prizes are accrued, not paid out, in this build.'),
      i.scale > 1 ? el('li', {}, el('b', { class: 'bad' }, `DEMO ×${i.scale}`), ' – this wallet’s paid shifts are shortened so a demo fits in minutes.') : '',
    ] : [el('li', {}, 'No fee, no prize. Counts for the free leaderboard and achievements. 5 free rides at signup, +1 every UTC day.')]));
}
function paintStart() {
  const t = S.tiers.tiers.find(x => x.id === S.sel), b = $('start'); if (!b) return;
  b.disabled = S.busy || !!tierOff(t);
  b.textContent = S.busy ? 'WORKING…' : t.usd ? `PAY $${t.usd}${t.lamports ? ` · ${sol(t.lamports)}` : ''} & START` : 'START FREE RIDE';
}
const say = (text, bad = false) => { const m = $('msg'); if (m) { m.textContent = text; m.className = `msg ${bad ? 'bad' : 'dim'}`; } };

async function start() {
  const id = S.sel; S.busy = true; paintTiers(); say('');
  try {
    const ride = id === 'free' ? await api('rides', { tier: 'free' }) : await buyRide(id, text => say(text));
    if (ride.tier !== id) {   // the server handed back a ride you already own (e.g. a paid one waiting) – never send you into the wrong one silently
      await checkPending(); say(`You already have a ${TIER_NAME[ride.tier] ?? ride.tier} ride ready – start that one first.`, true); return;
    }
    location.href = `/play.html?ride=${ride.id}`;
  } catch (e) {
    say(e.status === 409 && /in progress/.test(e.message) ? 'You already have a ride on the road (another tab?). It frees up about 2½ minutes after its last signal.' : e.message, true);
  } finally { S.busy = false; if ($('tiers')) paintTiers(); }
}

/* ───────── LIVE ───────── */
const rows = new Map();   // wallet|startedAt → { root, … }
function renderLive() {
  rows.clear();
  view.replaceChildren(el('h2', {}, 'TRUCKS ON THE ROAD'), el('div', { class: 'rides', id: 'rides' }), el('p', { class: 'dim' }, 'Updates every 5 seconds. Paused or backgrounded rides show as such.'));
  paintLive();
}
function paintLive() {
  const box = $('rides'); if (!box) return;
  const rides = S.live.rides, keys = new Set();
  if (!rides.length) { rows.clear(); box.replaceChildren(el('div', { class: 'card empty' }, 'No trucks on the road right now.', el('br'), el('a', { href: '#new' }, 'Be the first →'))); return; }
  box.querySelector('.empty')?.remove();
  for (const r of rides) {
    const k = `${r.wallet}|${r.startedAt}`; keys.add(k);
    let row = rows.get(k);
    if (!row) {
      row = { fill: el('div', { class: 'fill' }), truck: el('span', { class: 'truck' }, '⛟'), time: el('b'), dist: el('b'), hull: el('b'), badge: el('span', { class: 'badge' }) };
      row.root = el('div', { class: 'card ride' }, avatar(r.wallet),
        el('div', { class: 'who' }, el('b', {}, short(r.wallet), r.wallet === S.me.wallet ? ' (you)' : ''), el('span', { class: `badge${r.tier === 'free' ? '' : ' p'}` }, TIER_NAME[r.tier] ?? r.tier), r.route ? el('span', { class: 'badge' }, ROUTES[r.route] ?? '') : '', r.timeScale > 1 ? el('span', { class: 'badge d' }, `DEMO ×${r.timeScale}`) : '', row.badge),
        el('div', { class: 'road' }, row.fill, row.truck),
        el('div', { class: 'stats' }, el('span', {}, '⏱ ', row.time), el('span', {}, '↦ ', row.dist), el('span', {}, 'hull ', row.hull)));
      rows.set(k, row); box.append(row.root);
    }
    row.r = r;
  }
  for (const [k, row] of rows) if (!keys.has(k)) { row.root.remove(); rows.delete(k); }
  tickLive();
}
function tickLive() {   // between polls: run the clock and the truck forward from the last report (corrected by the next poll)
  const since = (Date.now() - S.liveAt) / 1000;
  for (const { r, fill, truck, time, dist, hull, badge } of rows.values()) {
    const stalled = r.paused || r.sinceBeat > 40, extra = stalled ? 0 : Math.min(r.sinceBeat + since, 15);
    const secs = r.driveSeconds + extra, avg = r.driveSeconds > 0 ? r.distance / r.driveSeconds : 0, d = r.distance + avg * extra;
    const pct = Math.min(1, secs / r.minSeconds, d / r.completeDist) * 100;
    fill.style.width = `${pct}%`; truck.style.left = `calc(${pct}% - ${pct * 0.2}px)`;   // the glyph stays inside the road at 0 % and 100 %
    time.textContent = `${dur(secs)} / ${dur(r.minSeconds)}`; dist.textContent = `${km(d)} / ${km(r.completeDist)} km`; hull.textContent = r.hull == null ? '–' : `${r.hull}%`;
    badge.textContent = r.paused ? 'PAUSED' : r.sinceBeat > 40 ? 'NO SIGNAL' : ''; badge.className = `badge${badge.textContent ? ' w' : ''}`; badge.hidden = !badge.textContent;
  }
}
async function pollLive() {
  try { const j = await api('live'); S.live = j; S.liveAt = Date.now(); S.skew = j.now - Date.now(); } catch { return; }
  const n = S.live.rides.length;
  $('chip-live').textContent = `${n} on the road`; $('tab-live-n').textContent = n || '';
  if (S.tab === 'live') paintLive();
}

/* ───────── LEADERBOARD ───────── */
async function renderBoard() {
  view.replaceChildren(el('p', { class: 'dim' }, 'Loading…'));
  let j;
  try { j = await api(`leaderboard?board=${S.board}`); } catch (e) { view.replaceChildren(el('p', { class: 'bad' }, e.message)); return; }
  if (S.tab !== 'board') return;   // switched away while loading
  const seg = el('div', { class: 'seg' }, ...[['round', 'THIS ROUND'], ['all', 'ALL TIME'], ['free', 'FREE RIDES']].map(([id, label]) => el('button', { class: id === S.board ? 'on' : '', onclick: () => { S.board = id; renderBoard(); } }, label)));
  const prize = S.board === 'round', mine = j.rows.find(r => r.wallet === S.me.wallet);
  view.replaceChildren(
    el('h2', {}, 'LEADERBOARD'), seg,
    prize ? el('p', { class: 'dim' }, `Ranked by distance of finished paid shifts. The top ${j.prizeRanks} share `, el('b', {}, '20%'), S.pool ? ` of the round’s entries (${sol(S.pool.split.top20)} so far)` : '', ' · closes in ', el('b', { class: 'cd', id: 'cd' }, left(j.round.endsAt - now()))) : el('p', { class: 'dim' }, S.board === 'all' ? 'All finished paid shifts, all time.' : 'Finished free rides, all time. No prizes – bragging rights.'),
    j.rows.length ? el('div', { class: 'card' }, el('table', {}, el('thead', {}, el('tr', {}, el('th', {}, '#'), el('th', {}, 'RIDER'), el('th', { class: 'r' }, 'KM'), el('th', { class: 'r' }, 'SHIFTS'))),
      el('tbody', {}, j.rows.map(r => el('tr', { class: `${prize ? 'prize' : ''}${r.wallet === S.me.wallet ? ' me' : ''}` },
        el('td', {}, el('span', { class: `rk${r.rank === 1 ? ' g' : r.rank === 2 ? ' s' : r.rank === 3 ? ' b' : ''}` }, r.rank)),
        el('td', {}, avatar(r.wallet), ' ', short(r.wallet), r.wallet === S.me.wallet ? ' (you)' : ''), el('td', { class: 'r' }, km(r.distance)), el('td', { class: 'r' }, r.rides)))))) : el('div', { class: 'card empty' }, 'Nobody has finished a shift here yet.'),
    el('p', { class: 'dim' }, mine ? `You are #${mine.rank}.` : 'You are not on this board yet – finish a shift.'));
}

/* ───────── PROFILE ───────── */
async function renderProfile() {
  view.replaceChildren(el('p', { class: 'dim' }, 'Loading…'));
  let p;
  try { p = await api('profile'); } catch (e) { view.replaceChildren(el('p', { class: 'bad' }, e.message)); return; }
  if (S.tab !== 'profile') return;
  S.me.freeRides = p.freeRides; paintHeader();
  const tile = (v, l) => el('div', { class: 'tile' }, el('b', {}, v), el('span', {}, l)), got = p.achievements.filter(a => a.earnedAt).length;
  view.replaceChildren(
    el('div', { class: 'who', style: 'display:flex;gap:10px;align-items:center' }, avatar(p.wallet), el('div', {}, el('b', {}, short(p.wallet)), el('div', { class: 'dim' }, `rider since ${new Date(p.createdAt).toLocaleDateString()} · ${p.freeRides} free ride${p.freeRides === 1 ? '' : 's'} left`))),
    el('h2', {}, 'STATS'),
    el('div', { class: 'tiles' }, tile(p.stats.rides, 'rides started'), tile(p.stats.completed, 'shifts finished'), tile(km(p.stats.metres), 'km driven'), tile(km(p.stats.bestMetres), 'best shift, km'), tile(p.stats.paidRides, 'paid rides'), tile(sol(p.stats.spentLamports), 'spent')),
    el('h2', {}, `ACHIEVEMENTS · ${got}/${p.achievements.length}`),
    el('div', { class: 'ach' }, p.achievements.map(a => el('div', { class: `a${a.earnedAt ? '' : ' lock'}${a.awardedAtRoundClose ? ' soon' : ''}` }, el('span', { class: 'ic' }, a.icon), el('span', { class: 'nm' }, a.name), el('span', { class: 'ds' }, a.desc),
      el('span', { class: 'when' }, a.earnedAt ? `unlocked ${new Date(a.earnedAt).toLocaleDateString()}` : a.awardedAtRoundClose ? 'awarded when the round closes' : 'locked')))),
    el('p', { class: 'dim' }, 'Achievements become NFTs in your wallet soon – they are recorded now and can’t be lost.'),
    el('h2', {}, 'TRUCK UPGRADES'), el('div', { class: 'card empty' }, 'Engine tune, winter pack, reinforced bumper… coming soon.'),
    el('h2', {}, 'RECENT RIDES'),
    p.recent.length ? el('div', { class: 'hist' }, p.recent.map(r => el('div', { class: 'hrow' },
      el('span', {}, new Date(r.startedAt).toLocaleString(), ' · ', TIER_NAME[r.tier] ?? r.tier, r.route ? ` · ${ROUTES[r.route] ?? ''}` : '', r.timeScale > 1 ? ` · DEMO ×${r.timeScale}` : ''),
      el('span', {}, `${km(r.distance)} km · `, el('b', { class: r.status === 'completed' ? 'good' : 'bad' }, r.status.toUpperCase()))))) : el('div', { class: 'card empty' }, 'No rides yet – start one!'));
}

/* ───────── refresh + 1 s tick ───────── */
async function refreshPool() {
  try { S.pool = await api('pool'); } catch { return; }
  if (S.tab === 'new') paintPool();
}
function tick() {
  if (S.pool) { const c = $('cd'); if (c) c.textContent = left(S.pool.round.endsAt - now()); }
  if (S.tab === 'live' && !document.hidden) tickLive();
}

/* ───────── boot (last on purpose: everything above is `const`, initialised only once the module has run that far) ───────── */
try { S.me = await api('me'); } catch { location.href = '/'; }
if (S.me) {
  paintHeader();
  $('out').onclick = async () => { await signOut(); location.href = '/'; };
  [S.tiers, S.pool] = await Promise.all([api('tiers').catch(() => null), api('pool').catch(() => null)]);
  await pollLive();
  go();
  checkPending();   // once: an RPC lookup may run here, so never on a timer
  addEventListener('hashchange', go);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { pollLive(); refreshPool(); } });
  setInterval(() => { if (!document.hidden) pollLive(); }, 5000);
  setInterval(() => { if (!document.hidden && (S.tab === 'new' || S.tab === 'board')) refreshPool(); }, 15000);
  setInterval(tick, 1000);
}
