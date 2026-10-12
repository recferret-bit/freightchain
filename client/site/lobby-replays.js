import { el } from './dom.js';
import { api } from './wallet.js';
import { shortAddr } from './pools.js';
import { GAME_BASE } from '../js/hosts.js';

/* The lobby's REPLAYS tab: every ride that ended (GET /api/replays – completed, abandoned, failed; a ride whose tab vanished shows as "signal lost"),
   newest first, filtered (everyone / mine, the outcome), "load more" pages back; a ride whose recording is still kept opens as a replay on the watch page. */
const STATUS = { completed: 'COMPLETED', abandoned: 'ABANDONED', failed: 'FAILED' };
const FAIL = { heartbeat_lost: 'signal lost', crash: 'crash', off_road: 'off the road', hull: 'wrecked', engine_blown: 'engine blown', cold_engine: 'cold engine', brakes: 'brakes', implausible_progress: 'implausible progress', other: 'failed' };
const R = { who: 'all', status: '', rows: [], next: null, loading: false, error: '', req: 0 };   // req: only the newest request's answer is painted
const ago = ms => { const s = Math.max(0, Math.round(ms / 1000)); return s < 90 ? `${s} s ago` : s < 5400 ? `${Math.round(s / 60)} min ago` : s < 129_600 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86_400)} d ago`; };

export function renderReplays(view, ctx) {
  const filter = (label, key, value) => el('button', { type: 'button', class: `alt f${R[key] === value ? ' on' : ''}`, 'aria-pressed': R[key] === value, onclick: () => { if (R[key] === value) return; R[key] = value; syncFilters(view); load(ctx, true); } }, label);
  view.replaceChildren(
    el('h2', {}, 'REPLAYS'),
    el('div', { class: 'filters', role: 'group', 'aria-label': 'filter the replays' },
      filter('EVERYONE', 'who', 'all'), filter('MINE', 'who', 'mine'), el('span', { class: 'sep' }),
      filter('ALL', 'status', ''), filter('COMPLETED', 'status', 'completed'), filter('ABANDONED', 'status', 'abandoned'), filter('FAILED', 'status', 'failed')),
    el('div', { class: 'rides', id: 'replays' }),
    el('div', { class: 'more' }, el('button', { type: 'button', class: 'alt', id: 'replays-more', onclick: () => load(ctx, false) }, 'LOAD MORE')),
    el('p', { class: 'dim' }, 'Every ride that ended. ▶ REPLAY opens it on the watch page – the drive, the traffic and what spectators sent – while its recording is kept (90 days).'));
  paint(ctx);
  if (!R.rows.length && !R.loading) load(ctx, true);
}

// a filter click flips the buttons in place – the tab is not rebuilt and the rows stay until the new ones arrive (no flash)
const FILTERS = [['who', 'all'], ['who', 'mine'], null, ['status', ''], ['status', 'completed'], ['status', 'abandoned'], ['status', 'failed']].filter(Boolean);
function syncFilters(view) {
  view.querySelectorAll('.filters button').forEach((b, i) => { const [k, v] = FILTERS[i]; const on = R[k] === v; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
}

async function load(ctx, fresh) {
  if (R.loading && !fresh) return;   // "load more" twice: once is enough; a filter change always wins over what is in flight
  const req = ++R.req;
  R.loading = true; R.error = ''; paint(ctx);
  const q = new URLSearchParams({ limit: '20' });
  if (!fresh && R.next) q.set('before', R.next);
  if (R.who === 'mine' && ctx.me?.wallet) q.set('wallet', ctx.me.wallet);
  if (R.status) q.set('status', R.status);
  try { const j = await api(`replays?${q}`, undefined, { report: false }); if (req !== R.req) return; if (fresh) R.rows = []; R.rows.push(...j.rows); R.next = j.next; }
  catch (e) { if (req !== R.req) return; R.error = e.message; }
  R.loading = false;
  paint(ctx);
}

function paint(ctx) {
  const box = document.getElementById('replays'); if (!box) return;
  const more = document.getElementById('replays-more');
  box.style.opacity = R.loading && R.rows.length ? '.55' : '';   // the old rows stay (dimmed) while a filter's answer is on its way
  if (more) { more.hidden = !R.next; more.disabled = R.loading; }
  if (R.error) { box.replaceChildren(el('div', { class: 'card empty' }, `Could not load the replays: ${R.error}`)); return; }
  if (!R.rows.length) { box.replaceChildren(el('div', { class: 'card empty' }, R.loading ? 'Loading…' : R.who === 'mine' ? 'You have no finished rides yet.' : 'No finished rides yet.')); return; }
  box.replaceChildren(...R.rows.map(r => {
    const pct = r.status === 'completed' ? 100 : Math.min(100, Math.round(100 * r.driveSeconds / Math.max(1, r.minSeconds)));   // completed = the line was reached, whatever the clock says
    return el('div', { class: `card ride replay ${r.status}`, 'data-id': r.id },
      el('span', { class: 'edge' }),
      el('div', { class: 'body' },
        el('div', { class: 'row1' }, ctx.avatar(r.wallet), el('b', { title: r.wallet }, shortAddr(r.wallet), r.wallet === ctx.me?.wallet ? ' (you)' : ''),
          el('span', { class: `badge${r.tier === 'free' ? '' : ' p'}` }, ctx.TIER_NAME[r.tier] ?? r.tier), r.route ? el('span', { class: 'badge' }, ctx.ROUTES[r.route] ?? r.route) : '',
          el('span', { class: 'when dim' }, ago(Date.now() - r.endedAt))),
        el('div', { class: 'row2' }, el('span', { class: 'big' }, ctx.km(r.distance), el('small', {}, ' km')),
          el('span', { class: `badge st ${r.status}` }, STATUS[r.status] ?? r.status, r.failCode ? ` · ${FAIL[r.failCode] ?? r.failCode}` : '')),
        el('div', { class: 'rp-prog dim' }, el('span', {}, `${ctx.dur(r.driveSeconds)} / ${ctx.dur(r.minSeconds)}`), el('div', { class: `rp-bar ${r.status}` }, el('i', { style: `width:${pct}%` })))),
      r.replay ? el('a', { class: 'watch', href: `${GAME_BASE}/play.html?watch=${encodeURIComponent(r.id)}`, title: 'replay this ride on the watch page' }, el('span', {}, '▶'), 'REPLAY')
        : el('span', { class: 'dim norec', title: 'its recording is gone (or was never uploaded)' }, 'no recording'));
  }));
}
