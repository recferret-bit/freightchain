import { fmt } from '../util.js';
import { st } from '../state.js';
import { audio } from '../sim/audio.js';
import { getTheme } from '../themes/index.js';
import { SITE_BASE } from '../hosts.js';
import { watch, seek, goLive, addEvent, LIVE_LAG } from '../watch.js';
import { EFFECT_INFO, short, solText } from '../live-effects.js';
import { el } from '../../site/dom.js';
import { api, signIn } from '../../site/wallet.js';

/* The watch page's panel (play.html?watch=<id>): who / where / how far, the timeline (live edge or replay with speeds), the ride's feed, and – signed in –
   the chat box and the MOCK donation buttons. Server text only through el() / textContent. Spectator actions go to /api/watch/:id/* (server/src/presentation/live). */
const TIER = { free: 'TEST RIDE', '1h': '1 HOUR', '4h': '4 HOURS', '8h': '8 HOURS' };
const STATUS = { running: 'ON THE ROAD', completed: 'COMPLETED', abandoned: 'ABANDONED', failed: 'FAILED' };
const P = { me: null, root: null, busy: false };
const $ = id => document.getElementById(id);
const hms = t => (t >= 3600 ? `${Math.floor(t / 3600)}:${fmt(t % 3600)}` : fmt(t));
const km = m => (m / 1000).toFixed(1);

export function mountWatchPanel() {
  document.getElementById('overlay')?.classList.add('hide');
  if (watch.error && !watch.ride) return mountError();
  const r = watch.ride;
  const speeds = [1, 4, 16].map(x => el('button', { class: 'alt spd', 'data-x': x, onclick: () => { watch.speed = x; watch.follow = false; watch.playing = true; paint(); } }, `${x}×`));
  P.root = el('aside', { id: 'watch', 'aria-label': 'Watching a ride' },
    el('div', { class: 'w-top' },
      el('div', {}, el('div', { class: 'w-k' }, 'WATCHING'), el('b', { class: 'w-who', title: r.wallet }, short(r.wallet))),
      el('button', { class: 'alt w-fold', title: 'fold the panel', onclick: () => P.root.classList.toggle('folded') }, '⇥')),
    el('div', { class: 'w-meta' }, el('span', { id: 'w-route' }), ' · ', TIER[r.tier] ?? r.tier, r.timeScale > 1 ? ` · DEMO ×${r.timeScale}` : ''),
    el('div', { class: 'w-badges' }, el('span', { id: 'w-state', class: 'w-badge' }), el('span', { id: 'w-viewers', class: 'w-badge dim' })),
    el('div', { class: 'w-stats' }, el('span', {}, '⏱ ', el('b', { id: 'w-time' })), el('span', {}, '↦ ', el('b', { id: 'w-dist' })), el('span', {}, 'hull ', el('b', { id: 'w-hull' }))),
    el('div', { id: 'w-note', class: 'dim w-small' }),
    el('input', { id: 'w-seek', type: 'range', min: 0, max: 1, step: 1, value: 0, 'aria-label': 'position in the ride', oninput: e => seek(+e.target.value) }),
    el('div', { class: 'w-ctl' },
      el('button', { id: 'w-play', class: 'alt', onclick: () => { watch.playing = !watch.playing; paint(); } }, '❚❚'), ...speeds,
      el('button', { id: 'w-live', class: 'alt', onclick: () => { goLive(); paint(); } }, '● LIVE'),
      el('button', { id: 'w-sound', class: 'alt', title: 'engine sound (M mutes)', onclick: () => { if (audio.ctx) audio.muted = !audio.muted; else { audio.start(); audio.muted = false; } paint(); } }, '🔇')),
    el('div', { class: 'w-feed', id: 'w-feed', 'aria-live': 'polite' }),
    el('div', { id: 'w-me' }),
    el('div', { class: 'w-foot' }, el('a', { href: `${SITE_BASE}/lobby.html#live` }, '← all trucks on the road'), el('span', { class: 'dim' }, 'replays the verified-play recording')));
  document.body.append(P.root);
  for (const e of watch.events.values()) feedLine(e);
  watch.onUpdate = paint; watch.onEvent = (e, why) => (why === 'new' ? feedLine(e) : markApplied(e));
  setInterval(paintClock, 250);
  refreshMe(); paint();
}

function mountError() {
  document.body.append(el('aside', { id: 'watch', class: 'w-error' }, el('b', {}, 'NOTHING TO WATCH'), el('p', {}, watch.error), el('a', { href: `${SITE_BASE}/lobby.html#live` }, '← trucks on the road')));
}

async function refreshMe() {
  try { P.me = await api('me'); } catch { P.me = null; }
  paintMe();
}

/* ───── the parts that change ───── */
function paint() {
  const r = watch.ride; if (!r || !P.root) return;
  $('w-route').textContent = r.route ? getTheme(r.route).name : 'route not reported yet';
  const live = r.live && watch.follow, state = $('w-state');
  state.textContent = r.live ? (live ? `● LIVE · ~${LIVE_LAG} s behind` : '● LIVE · you are behind') : `REPLAY · ${STATUS[r.status] ?? r.status}`;
  state.className = `w-badge${r.live ? ' on' : ''}`;
  $('w-viewers').textContent = r.live ? `👁 ${watch.viewers}` : '';
  $('w-live').hidden = !r.live; $('w-live').classList.toggle('sel', live);
  $('w-play').textContent = watch.playing ? '❚❚' : '▶';
  for (const b of P.root.querySelectorAll('.spd')) { b.hidden = live; b.classList.toggle('sel', !live && watch.speed === +b.dataset.x); }
  $('w-sound').textContent = audio.muted || !audio.ctx ? '🔇' : '🔊';
  paintMe(); paintClock();
}
function paintClock() {
  const r = watch.ride; if (!r || !P.root) return;
  const sk = $('w-seek'), end = Math.max(1, Math.floor(watch.rec.t1));
  sk.max = end; if (document.activeElement !== sk) sk.value = Math.floor(watch.wt);
  $('w-time').textContent = `${hms(st.t)} / ${hms(r.minSeconds)}`;
  $('w-dist').textContent = `${km(st.s)} / ${km(r.completeDist)} km`;
  $('w-hull').textContent = `${Math.round(st.hull)}%`;
  const note = !watch.rows.length ? (watch.rec.lastSeq === null && !r.live ? 'no recording kept for this ride' : 'waiting for the first recording…')
    : watch.buffering ? (r.live && watch.follow ? 'the driver is paused or the next batch is on its way…' : watch.wt >= watch.rec.t1 - 1 && !r.live ? `end of the ride · ${STATUS[r.status] ?? r.status}` : 'loading…') : '';
  $('w-note').textContent = note;
}

/* ───── feed ───── */
function feedLine(e) {
  const box = $('w-feed'); if (!box) return;
  const fx = EFFECT_INFO[e.effect], mine = P.me && e.wallet === P.me.wallet;
  const body = e.kind === 'message' ? [e.text] : [`${fx?.icon ?? '💰'} ${fx?.says ?? 'donated'} · ${solText(e.lamports)} `, el('small', {}, '(mock)'), e.text ? ` – “${e.text}”` : ''];
  const row = el('div', { class: `w-line${e.kind === 'donation' ? ' gift' : ''}${mine ? ' me' : ''}`, 'data-id': e.id },
    el('b', { title: e.wallet }, `${short(e.wallet)}${e.wallet === watch.ride?.wallet ? ' (driver)' : ''}: `), ...body,
    e.kind === 'donation' && e.effect !== 'tip' ? el('span', { class: 'w-ap dim' }, appliedText(e)) : '');
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
  box.append(row); while (box.children.length > 200) box.firstChild.remove();
  if (atBottom) box.scrollTop = box.scrollHeight;
}
const appliedText = e => (!e.applied ? ' · waiting for the driver' : e.applied.placed === false ? ' ✗ no room on the road – it fizzled' : ' ✓ on the road');
function markApplied(e) { const ap = document.querySelector(`.w-line[data-id="${e.id}"] .w-ap`); if (ap) ap.textContent = appliedText(e); }

/* ───── signed-in actions ───── */
function paintMe() {
  const box = $('w-me'); if (!box || !watch.ride) return;
  const r = watch.ride;
  if (!r.live) { box.replaceChildren(el('p', { class: 'dim w-small' }, 'This ride is over – the feed is read-only. Chat and donations go to rides on the road.')); return; }
  if (!P.me) {
    box.replaceChildren(el('p', { class: 'w-small' }, 'Sign in with your Solana wallet to write to the driver and send donations that change their ride.'),
      el('button', { onclick: connect, disabled: P.busy }, 'CONNECT WALLET'), el('div', { id: 'w-msg', class: 'w-small' }));
    return;
  }
  if (P.me.wallet === r.wallet) { box.replaceChildren(el('p', { class: 'dim w-small' }, 'This is your own ride – spectators write here.')); return; }
  if (box.dataset.ready === P.me.wallet) return;   // built once per signed-in wallet (keeps what is being typed)
  box.dataset.ready = P.me.wallet;
  const text = el('input', { id: 'w-text', maxlength: 140, placeholder: 'say something to the driver…', autocomplete: 'off', onkeydown: e => { if (e.key === 'Enter') send(); } });
  const note = el('input', { id: 'w-note-in', maxlength: 80, placeholder: 'note with a donation (optional)', autocomplete: 'off' });
  box.replaceChildren(
    el('div', { class: 'w-say' }, text, el('button', { onclick: send }, 'SEND')),
    el('div', { class: 'w-k' }, 'DONATE · mock SOL – nothing is charged · one effect per 20 s on a ride'),
    el('div', { class: 'w-fx' }, ...Object.entries(EFFECT_INFO).map(([id, fx]) => el('button', { class: 'alt', title: fx.says, onclick: () => donate(id) }, `${fx.icon} ${fx.label}`, el('small', {}, `${fx.sol} SOL`)))),
    note, el('div', { id: 'w-msg', class: 'w-small' }), el('div', { class: 'dim w-small' }, `signed in as ${short(P.me.wallet)}`));
}
const say = (text, cls = 'dim') => { const m = $('w-msg'); if (m) { m.textContent = text; m.className = `w-small ${cls}`; } };
async function connect() {
  P.busy = true; paintMe();
  try { await signIn(); await refreshMe(); } catch (e) { P.busy = false; paintMe(); say(e.message, 'bad'); return; }
  P.busy = false;
}
async function send() {
  const t = $('w-text'); if (!t || !t.value.trim()) return;
  try { const e = await api(`watch/${encodeURIComponent(watch.id)}/messages`, { text: t.value }); t.value = ''; say(''); addOwn(e); }
  catch (e) { say(e.message, 'bad'); if (e.status === 401) refreshMe(); }
}
async function donate(effect) {
  const n = $('w-note-in');
  try {
    const e = await api(`watch/${encodeURIComponent(watch.id)}/donations`, { effect, note: n?.value.trim() || null });
    if (n) n.value = '';
    say(effect === 'tip' ? 'Tip sent (mock).' : `${EFFECT_INFO[effect].label} sent (mock) – it happens when the driver's game picks it up; you see it here ~${LIVE_LAG} s later.`, 'good');
    addOwn(e);
  } catch (e) { say(e.message, 'bad'); if (e.status === 401) refreshMe(); }
}
const addOwn = e => addEvent(e);   // shown at once (onEvent paints it); the next poll knows the id
