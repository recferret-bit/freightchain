import { el } from './dom.js';
import { api } from './wallet.js';
import { shortAddr } from './pools.js';
import { GAME_BASE } from '../js/hosts.js';

/* The lobby's REPLAYS tab: every ride that ended (GET /api/replays – completed, abandoned, failed; a ride whose tab vanished shows as "signal lost"),
   newest first, filtered (everyone / mine, the outcome), "load more" pages back; a ride whose recording is still kept opens as a replay on the watch page. */
const STATUS = { completed: 'COMPLETED', abandoned: 'ABANDONED', failed: 'FAILED' };
const FAIL = { heartbeat_lost: 'signal lost', crash: 'crash', off_road: 'off the road', hull: 'wrecked', engine_blown: 'engine blown', cold_engine: 'cold engine', brakes: 'brakes', implausible_progress: 'implausible progress', other: 'failed' };
const R = { who: 'all', status: '', rows: [], next: null, loading: false, error: '' };
const ago = ms => { const s = Math.max(0, Math.round(ms / 1000)); return s < 90 ? `${s} s ago` : s < 5400 ? `${Math.round(s / 60)} min ago` : s < 129_600 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86_400)} d ago`; };

export function renderReplays(view, ctx) {
  const filter = (label, key, value) => el('button', { type: 'button', class: `alt f${R[key] === value ? ' on' : ''}`, 'aria-pressed': R[key] === value, onclick: () => { R[key] = value; load(ctx, true); renderReplays(view, ctx); } }, label);
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

async function load(ctx, fresh) {
  if (R.loading) return;
  R.loading = true; R.error = '';
  if (fresh) { R.rows = []; R.next = null; }
  const q = new URLSearchParams({ limit: '20' });
  if (!fresh && R.next) q.set('before', R.next);
  if (R.who === 'mine' && ctx.me?.wallet) q.set('wallet', ctx.me.wallet);
  if (R.status) q.set('status', R.status);
  try { const j = await api(`replays?${q}`, undefined, { report: false }); R.rows.push(...j.rows); R.next = j.next; }
  catch (e) { R.error = e.message; }
  R.loading = false;
  paint(ctx);
}

function paint(ctx) {
  const box = document.getElementById('replays'); if (!box) return;
  const more = document.getElementById('replays-more');
  if (more) { more.hidden = !R.next; more.disabled = R.loading; }
  if (R.error) { box.replaceChildren(el('div', { class: 'card empty' }, `Could not load the replays: ${R.error}`)); return; }
  if (!R.rows.length) { box.replaceChildren(el('div', { class: 'card empty' }, R.loading ? 'Loading…' : R.who === 'mine' ? 'You have no finished rides yet.' : 'No finished rides yet.')); return; }
  box.replaceChildren(...R.rows.map(r => el('div', { class: 'card ride replay', 'data-id': r.id }, ctx.avatar(r.wallet),
    el('div', { class: 'who' }, el('b', {}, shortAddr(r.wallet), r.wallet === ctx.me?.wallet ? ' (you)' : ''),
      el('span', { class: `badge${r.tier === 'free' ? '' : ' p'}` }, ctx.TIER_NAME[r.tier] ?? r.tier), r.route ? el('span', { class: 'badge' }, ctx.ROUTES[r.route] ?? r.route) : '',
      el('span', { class: `badge st ${r.status}` }, STATUS[r.status] ?? r.status, r.failCode ? ` · ${FAIL[r.failCode] ?? r.failCode}` : '')),
    el('div', { class: 'stats' }, el('span', {}, '⏱ ', el('b', {}, `${ctx.dur(r.driveSeconds)} / ${ctx.dur(r.minSeconds)}`)), el('span', {}, '↦ ', el('b', {}, `${ctx.km(r.distance)} km`)),
      el('span', {}, `ended ${ago(Date.now() - r.endedAt)}`),
      r.replay ? el('a', { class: 'watch', href: `${GAME_BASE}/play.html?watch=${encodeURIComponent(r.id)}`, title: 'replay this ride on the watch page' }, '▶ REPLAY') : el('span', { class: 'dim norec', title: 'its recording is gone (or was never uploaded)' }, 'no recording')))));
}
