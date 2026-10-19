import { api } from './wallet.js';
import { $, el } from './dom.js';
import { livePath } from './presence.js';
import { GAME_BASE } from '../js/hosts.js';
import { formatDriver, getCachedSns, reverseResolveSns } from './sns.js';

/* LIVE tab controller for the Lobby: live truck cards, sort/route filters,
   1-second progress interpolation, and 5-second live feed polling. */

const SORTS = {
  newest: (a, b) => b.startedAt - a.startedAt,
  watched: (a, b) => b.viewers - a.viewers || b.startedAt - a.startedAt,
  furthest: (a, b) => b.distance - a.distance,
};

export function createLiveTab({ S, view, dur, km, avatar, ROUTES, TIER_NAME }) {
  const rows = new Map();   // wallet|startedAt → { root, … }

  const liveChip = () => {
    const o = S.live.online, n = (S.live.rides || []).filter(r => r.tier !== 'free').length;
    return `${o ? `${o.total} online · ` : ''}${n} on the road`;
  };

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

  function tickLive() {
    const since = (Date.now() - S.liveAt) / 1000;
    for (const { r, fill, truck, time, dist, hull, eyes, badge } of rows.values()) {
      const stalled = r.signal !== 'live', extra = stalled ? 0 : Math.min(r.sinceBeat + since, 15);
      const secs = r.driveSeconds + extra, avg = r.driveSeconds > 0 ? r.distance / r.driveSeconds : 0, d = r.distance + avg * extra;
      const pct = Math.min(1, secs / r.minSeconds, d / r.completeDist) * 100;
      fill.style.width = `${pct}%`; truck.style.left = `calc(${pct}% - ${pct * 0.2}px)`;
      time.textContent = `${dur(secs)} / ${dur(r.minSeconds)}`; dist.textContent = `${km(d)} / ${km(r.completeDist)} km`; hull.textContent = r.hull == null ? '–' : `${r.hull}%`;
      eyes.textContent = String(r.viewers ?? 0);
      badge.textContent = r.signal === 'paused' ? 'PAUSED' : r.signal === 'weak' ? 'WEAK SIGNAL' : '';
      badge.className = `badge${badge.textContent ? ' w' : ''}`; badge.hidden = !badge.textContent;
    }
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
    for (const row of shown) { row.root.hidden = !!S.liveRoute && row.r.route !== S.liveRoute; box.append(row.root); }
    tickLive();
  }

  function renderLive() {
    rows.clear();
    view.replaceChildren(
      el('h2', {}, 'TRUCKS ON THE ROAD'),
      el('p', { class: 'dim', id: 'live-online' }),
      liveControls(),
      el('div', { class: 'rides', id: 'rides' }),
      el('p', { class: 'dim' }, 'Updates every 5 seconds. Paused or backgrounded rides show as such. WATCH replays a ride about 25 s behind the driver; signed in, you can write to them and send (mock) donations that change their ride.'));
    paintLive();
  }

  async function pollLive() {
    try { const j = await api(livePath('lobby'), undefined, { report: false }); S.live = j; S.liveAt = Date.now(); S.skew = j.now - Date.now(); } catch { return; }
    const n = (S.live.rides || []).filter(r => r.tier !== 'free').length;
    $('chip-live').textContent = liveChip(); $('tab-live-n').textContent = n || '';
    if (S.tab === 'live') paintLive();
  }

  return { liveChip, renderLive, tickLive, pollLive };
}
