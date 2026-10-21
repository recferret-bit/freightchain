import { fmt } from '../util.js';
import { st } from '../state.js';
import { audio } from '../sim/audio.js';
import { getTheme } from '../themes/index.js';
import { SITE_BASE } from '../hosts.js';
import { watch, seek, addEvent, roadCheck, replayEnd } from '../watch.js';
import { toggleMap } from './map.js';
import { EFFECT_INFO, solText } from '../live-effects.js';
import { el } from '../../site/dom.js';
import { t } from '../../site/i18n.js';
import { SPEEDS, SEEK_STEP, bindReplayKeys, chartSeries, formatClock, hoverSeconds, nextCamera, paintChart, shareUrl, timelineMarks } from '../../site/replay-player.js';
import { api, prepareSignIn } from '../../site/wallet.js';
import { explorerTx } from '../../site/pools.js';
import { formatDriver, getCachedSns, reverseResolveSns } from '../../site/sns.js';
import { resumeDonation, createWatchActions } from './watch-actions.js';

/* The watch page's panel (play.html?watch=<id>): timeline, road check, live feed, and spectator actions. */
const TIER = { free: 'TEST RIDE', '1h': '1 HOUR', '4h': '4 HOURS', '8h': '8 HOURS' };
const STATUS = { running: 'ON THE ROAD', completed: 'COMPLETED', abandoned: 'ABANDONED', failed: 'FAILED' };
const P = { me: null, root: null, busy: false, endShown: false, honkUntil: 0, timeUntil: 0 };
const $ = id => document.getElementById(id);
const hms = t => (t >= 3600 ? `${Math.floor(t / 3600)}:${fmt(t % 3600)}` : fmt(t));
const km = m => (m / 1000).toFixed(1);
const say = (text, cls = 'dim') => { const m = $('w-msg'); if (m) { m.textContent = text; m.className = `w-small ${cls}`; } };
const addOwn = e => addEvent(e);

const actions = createWatchActions({
  P,
  $,
  say,
  refreshMe: () => refreshMe(),
  paintMe: () => paintMe(),
  addOwn,
});

function stepMark(dir) {
  const end = replayEnd();
  const marks = timelineMarks(watch.rows, [...watch.events.values()], end);
  const now = watch.wt || 0;
  const hit = dir > 0 ? marks.find((m) => m.t > now + 0.2) : [...marks].reverse().find((m) => m.t < now - 0.2);
  if (!hit) return;
  seek(Math.max(0, hit.t));
  watch.playing = true;
  paint();
}
function playToggle() {
  if (!watch.playing && watch.atEnd) seek(0);
  watch.playing = !watch.playing;
  watch.follow = false;
  paint();
}
function setVolume(value) {
  const level = Math.max(0, Math.min(1, Number(value) || 0));
  audio.level = level;
  audio.muted = level === 0;
  if (audio.bus) audio.bus.gain.value = audio.muted ? 0 : 0.9 * level;
  paint();
}
function shareAt() {
  const href = shareUrl(location.href, watch.wt);
  const btn = $('w-share');
  if (btn) btn.dataset.url = href;
  history.replaceState(null, '', href);
  navigator.clipboard?.writeText?.(new URL(href, location.href).toString()).catch(() => {});
}

export function mountWatchPanel() {
  document.getElementById('overlay')?.classList.add('hide');
  if (watch.error && !watch.ride) return mountError();
  const r = watch.ride;
  st.watchCam = st.watchCam || 'cabin';
  const speeds = SPEEDS.map(x => el('button', { class: 'alt spd', 'data-x': x, onclick: () => { watch.speed = x; watch.follow = false; watch.playing = true; paint(); } }, `${x}×`));
  const toggleFold = () => {
    P.root.classList.toggle('folded');
    const btn = P.root.querySelector('.w-fold');
    if (btn) btn.textContent = P.root.classList.contains('folded') ? '⇤' : '⇥';
  };
  const whoEl = el('b', { id: 'w-driver', class: 'w-who', title: r.wallet }, formatDriver(r.wallet, r.sns ?? getCachedSns(r.wallet)));
  if (!r.sns && r.wallet && getCachedSns(r.wallet) === undefined) {
    reverseResolveSns(r.wallet).then(domain => {
      if (domain && whoEl.isConnected) whoEl.textContent = domain;
    }).catch(() => {});
  }
  P.root = el('aside', { id: 'watch', 'aria-label': 'Watching a ride' },
    el('div', { class: 'w-top' },
      el('div', {}, el('div', { class: 'w-k' }, 'WATCHING'), whoEl),
      el('button', { class: 'alt w-fold', title: 'fold / expand the panel', onclick: toggleFold }, '⇥')),
    el('div', { class: 'w-leave', role: 'navigation', 'aria-label': 'Leave the replay' },
      ...[['yard', 'I MISS THE YARD', 'lobby', '/lobby.html'], ['done', "I'M DONE", 'landing', '/']].map(([k, name, tip, path]) =>
        el('button', { type: 'button', id: `watch-${k}`, class: 'alt', title: tip, onclick: () => { location.href = `${SITE_BASE}${path}`; } }, el('b', {}, name), el('small', {}, tip)))),
    el('div', { class: 'w-meta' }, el('span', { id: 'w-route' }), ' · ', TIER[r.tier] ?? r.tier),
    el('div', { class: 'w-badges' }, el('span', { id: 'w-state', class: 'w-badge' }), el('span', { id: 'w-viewers', class: 'w-badge dim' })),
    el('div', { class: 'w-stats' },
      el('span', {}, '⏱ ', el('b', { id: 'w-time' })),
      el('span', {}, '↦ ', el('b', { id: 'w-dist' })),
      el('span', { id: 'w-speedometer' }, t('replay.speed'), ' ', el('b', { id: 'w-speed' }, '0')),
      el('span', {}, t('replay.gear'), ' ', el('b', { id: 'w-gear' }, 'N')),
      el('span', {}, 'hull ', el('b', { id: 'w-hull' }))),
    el('div', { id: 'w-damage', class: 'w-damage', title: t('replay.damage') }, el('i', { id: 'w-damage-bar' })),
    el('div', { id: 'w-progress', class: 'w-progress' }),
    el('div', { id: 'w-note', class: 'dim w-small' }),
    el('div', { id: 'w-road', class: 'w-road', title: 'the holes on this road are the server\'s, rebuilt from the ride\'s seed – this is what the recorded truck did at them' }),
    el('div', { class: 'w-track' },
      el('input', { id: 'w-seek', type: 'range', min: 0, max: 1, step: 1, value: 0, 'aria-label': 'position in the ride', oninput: e => seek(+e.target.value), onmousemove: hoverSeek, onmouseleave: () => { const tip = $('w-time-tip'); if (tip) tip.hidden = true; } }),
      el('div', { id: 'w-time-tip', class: 'w-time-tip', hidden: true }),
      el('div', { id: 'w-marks', class: 'w-marks', 'aria-hidden': 'true' })),
    el('canvas', { id: 'w-chart', class: 'w-chart', width: 320, height: 42 }),
    el('div', { class: 'w-ctl' },
      el('button', { id: 'w-play', class: 'alt', onclick: playToggle }, '❚❚'),
      el('button', { id: 'w-prev', class: 'alt', title: 'previous mark ([)', onclick: () => stepMark(-1) }, '⏮'),
      el('button', { id: 'w-next', class: 'alt', title: 'next mark (])', onclick: () => stepMark(1) }, '⏭'),
      el('button', { id: 'w-back', class: 'alt', title: 'back 10 seconds', onclick: () => { seek(Math.max(0, watch.wt - SEEK_STEP)); watch.playing = true; paint(); } }, '−10s'),
      el('button', { id: 'w-fwd', class: 'alt', title: 'forward 10 seconds', onclick: () => { seek(Math.min(replayEnd(), watch.wt + SEEK_STEP)); watch.playing = true; paint(); } }, '+10s'),
      el('button', { id: 'w-restart', class: 'alt', title: 'restart', onclick: () => { seek(0); watch.playing = true; paint(); } }, '↺'),
      ...speeds,
      el('button', { id: 'w-cam', class: 'alt', title: 'cabin / chase / hood (C)', onclick: () => { st.watchCam = nextCamera(st.watchCam); paint(); } }, 'CAM'),
      el('button', { id: 'w-full', class: 'alt', title: 'fullscreen (F)', onclick: () => { const node = document.documentElement; if (document.fullscreenElement) document.exitFullscreen?.(); else node.requestFullscreen?.(); } }, '⛶'),
      el('button', { id: 'w-share', class: 'alt', title: 'copy a link at this second', onclick: shareAt }, '↗'),
      el('input', { id: 'w-volume', type: 'range', min: 0, max: 1, step: 0.05, value: 1, 'aria-label': 'volume', oninput: e => setVolume(e.target.value) }),
      el('button', { id: 'w-sound', class: 'alt', title: 'engine sound (M mutes)', onclick: () => { if (!audio.ctx) audio.start(); audio.muted = !audio.muted; paint(); } }, '🔇'),
      el('button', { id: 'w-map', class: 'alt', title: 'map (N)', onclick: () => toggleMap() }, 'MAP'),
      el('button', { id: 'w-hud', class: 'alt', title: 'hide the panel (H)', onclick: () => P.root.classList.toggle('hud-off') }, 'HUD'),
      el('button', { class: 'alt cb-mute', title: 'mute your own replay', onclick: () => { if (!audio.ctx) audio.start(); audio.muted = !audio.muted; paint(); } }, 'CB'),
      el('span', { id: 'w-react' }, ...['👍', '🔥', '🚚'].map((ch) => el('button', { type: 'button', class: 'alt w-react', onclick: () => { const box = $('w-feed'); if (box) box.append(el('div', { class: 'w-line react' }, ch)); } }, ch)))),
    el('div', { class: 'w-feed', id: 'w-feed', 'aria-live': 'polite' }),
    el('div', { id: 'w-me' }),
    el('div', { class: 'w-foot' }, el('span', { class: 'dim' }, 'replays the verified-play recording')));
  document.body.append(P.root, el('div', { id: 'w-stamp', class: 'w-stamp', hidden: true, role: 'status' }));
  bindReplayKeys(window, { play: playToggle, seek: (d) => { seek(Math.max(0, Math.min(replayEnd(), watch.wt + d))); watch.playing = true; paint(); }, camera: () => { st.watchCam = nextCamera(st.watchCam); paint(); }, fullscreen: () => $('w-full')?.click(), mute: () => $('w-sound')?.click() });
  for (const e of watch.events.values()) feedLine(e);
  watch.onUpdate = paint; watch.onEvent = (e, why) => (why === 'new' ? feedLine(e) : markApplied(e));
  setInterval(paintClock, 250);
  refreshMe(); paint();
}

function hoverSeek(event) {
  const sk = event.currentTarget, tip = $('w-time-tip');
  if (!sk || !tip) return;
  const rect = sk.getBoundingClientRect();
  const ratio = rect.width ? (event.clientX - rect.left) / rect.width : 0;
  tip.hidden = false;
  tip.textContent = formatClock(hoverSeconds(ratio, Number(sk.max) || replayEnd()));
  tip.style.left = `${Math.max(0, Math.min(rect.width - 8, event.clientX - rect.left))}px`;
}
function mountError() {
  document.body.append(el('aside', { id: 'watch', class: 'w-error' }, el('b', {}, t('replay.nothing')), el('p', {}, watch.error), el('a', { href: `${SITE_BASE}/lobby.html#replays` }, '← replays')));
}

async function refreshMe() {
  try { P.me = await api('me'); } catch { P.me = null; }
  paintMe();
  if (P.me) resumeDonation(addOwn).catch(() => {});
}

function paint() {
  const r = watch.ride; if (!r || !P.root) return;
  $('w-route').textContent = r.route ? getTheme(r.route).name : 'route not reported yet';
  const state = $('w-state');
  state.textContent = `REPLAY · ${STATUS[r.status] ?? r.status}`;
  state.className = 'w-badge';
  $('w-viewers').textContent = watch.viewers ? `👁 ${watch.viewers}` : '';
  $('w-play').textContent = watch.playing ? '❚❚' : '▶';
  const cam = $('w-cam'); if (cam) cam.textContent = (st.watchCam || 'cabin').slice(0, 3).toUpperCase();
  for (const b of P.root.querySelectorAll('.spd')) b.classList.toggle('sel', watch.speed === +b.dataset.x);
  $('w-sound').textContent = audio.muted || !audio.ctx ? '🔇' : '🔊';
  paintMe(); paintClock();
}

function paintEnd() {
  const r = watch.ride, ov = $('overlay'), panel = $('panel');
  if (!ov || !panel) return;
  if (!watch.atEnd || !r) { if (P.endShown) { ov.classList.add('hide'); ov.classList.remove('replay-end'); P.endShown = false; } return; }
  if (P.endShown) return;
  P.endShown = true;
  const ok = r.status === 'completed', driven = watch.rows.length ? st.t : (r.driveSeconds || 0), distM = watch.rows.length ? st.s : (r.distance || 0), hull = watch.rows.length ? st.hull : (r.hull ?? 0);
  panel.replaceChildren(el('h1', {}, ok ? 'SHIFT COMPLETE' : r.status === 'abandoned' ? 'SHIFT ABANDONED' : 'RIDE FAILED'), el('h2', {}, 'End of the replay.'),
    ...[['Result', el('b', { class: ok ? 'good' : 'bad' }, (STATUS[r.status] ?? r.status))], ['Time driven', el('b', {}, hms(driven))], ['Distance', el('b', {}, `${(distM / 1000).toFixed(2)} km`)], ['Hull', el('b', {}, `${Math.round(hull)}%`)]]
      .map(([k, v]) => el('div', { class: 'row' }, el('span', {}, k), v)),
    el('div', { class: 'btns' }, el('button', { type: 'button', id: 'lobby', class: 'alt bail-link', style: 'margin-left:auto', onclick: () => { location.href = `${SITE_BASE}/lobby.html`; } }, el('b', {}, 'BACK TO THE LOBBY'), el('small', {}, 'lobby'))));
  ov.classList.remove('hide', 'booting'); ov.classList.add('replay-end');
}

function paintClock() {
  const r = watch.ride; if (!r || !P.root) return;
  const sk = $('w-seek'), end = Math.max(1, Math.floor(replayEnd()));
  sk.max = end; if (document.activeElement !== sk) sk.value = Math.floor(watch.wt);
  $('w-time').textContent = `${hms(st.t)} / ${hms(replayEnd())}`;
  $('w-dist').textContent = `${km(st.s)} / ${km(r.completeDist)} km`;
  $('w-hull').textContent = `${Math.round(st.hull)}%`;
  const speed = $('w-speed'); if (speed) speed.textContent = `${Math.round((st.v || 0) * 3.6)}`;
  const gear = $('w-gear'); if (gear) gear.textContent = st.gear < 0 ? 'R' : st.gear ? String(st.gear) : 'N';
  const bar = $('w-damage-bar'); if (bar) bar.style.width = `${Math.max(0, Math.min(100, 100 - (st.hull ?? 100)))}%`;
  const prog = $('w-progress'); if (prog) prog.textContent = `${r.route ? getTheme(r.route).name : 'route'} · ${km(st.s)} km`;
  paintChart($('w-chart'), chartSeries(watch.rows), watch.wt);
  const note = !watch.rows.length ? (r.live || (watch.rec.lastSeq !== null && !watch.batches.has(watch.rec.lastSeq)) ? 'waiting for the first recording…' : 'no recording kept for this ride')
    : watch.buffering ? (r.live && watch.follow ? 'the driver is paused or the next batch is on its way…' : watch.wt >= replayEnd() - 1 && !r.live ? `end of the ride · ${STATUS[r.status] ?? r.status}` : 'loading…') : '';
  $('w-note').textContent = note;
  paintRoad(end); paintEnd();
}

let marksKey = '';
function paintRoad(end) {
  const c = roadCheck(), box = $('w-road');
  box.textContent = !c.holes ? 'ROAD CHECK · no planned hole reached yet' : `ROAD CHECK · ${c.holes} planned hole${c.holes > 1 ? 's' : ''} · ${c.hit} hit · ${c.avoided} avoided${c.ignored ? ` · ${c.ignored} NO IMPACT` : ''}`;
  box.classList.toggle('bad', c.ignored > 0); box.hidden = !watch.road.size && !watch.roadSeq.size && !watch.rows.length;
  const events = timelineMarks(watch.rows, [...watch.events.values()], end).filter(m => m.kind === 'damage' || m.kind === 'honk' || m.kind === 'minigame');
  const key = `${end}:${c.marks.map(m => m.hole + m.outcome).join()}:${events.map(m => m.kind + m.t).join()}`;
  if (key !== marksKey) {
    marksKey = key;
    const holes = c.marks.map(m => el('i', { class: `w-mark ${m.outcome}`, style: `left:${Math.min(100, (m.t / end) * 100).toFixed(2)}%`, title: `${m.type} at ${km(m.s)} km – ${m.outcome === 'ignored' ? `driven through untouched (the game takes ${m.expected.toFixed(1)} % hull)` : `hit: −${m.got.toFixed(1)} % hull`}`, onclick: () => { seek(Math.max(0, m.t - 6)); watch.playing = true; paint(); } }));
    $('w-marks').replaceChildren(...holes, ...events.map(m => el('i', { class: `w-mark w-event ${m.kind}`, 'data-kind': m.kind, style: `left:${Math.min(100, (m.t / end) * 100).toFixed(2)}%`, title: `${m.kind} · ${formatClock(m.t)}`, onclick: () => { seek(Math.max(0, m.t - 6)); watch.playing = true; paint(); } })));
  }
  const stamp = $('w-stamp'), on = watch.stamp && performance.now() < watch.stamp.until;
  stamp.hidden = !on;
  if (on) stamp.replaceChildren(el('b', {}, 'NO IMPACT'), el('span', {}, `the server's ${watch.stamp.type} at ${km(watch.stamp.s)} km – this truck drove through it without a scratch (the game takes ${watch.stamp.expected.toFixed(1)} % hull)`));
}

function feedLine(e) {
  const box = $('w-feed'); if (!box) return;
  const fx = EFFECT_INFO[e.effect], mine = P.me && e.wallet === P.me.wallet, honk = e.kind === 'honk';
  const body = e.kind === 'message' ? [e.text]
    : honk ? [`${fx?.icon ?? ''} ${e.text ?? ''}`.trim()]
    : [`${fx?.icon ?? '💰'} ${fx?.says ?? 'donated'} · ${solText(e.lamports)} `,
      e.signature ? el('a', { href: explorerTx(e.signature), target: '_blank', rel: 'noopener', title: 'the transfer to the driver on the Solana explorer (devnet)' }, 'paid ↗') : el('small', {}, '(mock)'), e.text ? ` – “${e.text}”` : ''];
  const row = el('div', { class: `w-line${e.kind === 'donation' ? ' gift tip' : ''}${mine ? ' me' : ''}`, 'data-id': e.id, 'data-replay-t': e.replayT ?? '' },
    el('b', { title: e.wallet }, `${formatDriver(e.wallet, e.sns)}${e.wallet === watch.ride?.wallet ? ' (driver)' : ''}: `), ...body,
    (honk || (e.kind === 'donation' && e.effect !== 'tip')) ? el('span', { class: 'w-ap dim' }, appliedText(e)) : '');
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
  box.append(row); while (box.children.length > 200) box.firstChild.remove();
  if (atBottom) box.scrollTop = box.scrollHeight;
}
const appliedText = e => (!e.applied ? ' · waiting for the driver' : e.applied.placed === false ? ' ✗ no room on the road – it fizzled' : ' ✓ on the road');
function markApplied(e) { const ap = document.querySelector(`.w-line[data-id="${e.id}"] .w-ap`); if (ap) ap.textContent = appliedText(e); }

function paintMe() {
  const box = $('w-me'); if (!box || !watch.ride) return;
  const r = watch.ride;
  if (!P.me) {
    box.replaceChildren(el('p', { class: 'w-small' }, 'Sign in with your Solana wallet to write in the replay and tip the driver.'),
      el('button', { onclick: actions.connect, onpointerdown: () => prepareSignIn(), disabled: P.busy }, 'CONNECT WALLET'), el('div', { id: 'w-msg', class: 'w-small' }));
    prepareSignIn();
    return;
  }
  if (P.me.wallet === r.wallet) { box.replaceChildren(el('p', { class: 'dim w-small' }, 'This is your own ride – spectators write here.')); return; }
  const f = watch.features, key = `${P.me.wallet}|${r.ranked ? 1 : 0}|${JSON.stringify(f)}`;
  if (box.dataset.ready === key) return;
  box.dataset.ready = key;
  const parts = [];
  if (f.chat) parts.push(el('div', { class: 'w-say' }, el('input', { id: 'w-text', maxlength: 200, placeholder: t('replay.chat'), autocomplete: 'off', onkeydown: e => { if (e.key === 'Enter') actions.send(); } }), el('button', { type: 'button', onclick: actions.send }, t('replay.send')), actions.honkBtn()));
  else parts.push(el('p', { class: 'dim w-small' }, 'Chat is off on this ride.'), el('div', { class: 'w-say' }, actions.honkBtn()));
  if (f.donations) {
    const chain = f.payment === 'chain';
    const presets = [0.01, 0.05, 0.1];
    parts.push(el('div', { class: 'w-k' }, t('replay.tip'), chain ? ' · devnet SOL' : ' · mock SOL'),
      el('div', { id: 'w-tips', class: 'w-fx' }, ...presets.map(sol => el('button', { type: 'button', class: 'alt', 'data-sol': String(sol), onclick: () => actions.donate('tip', Math.round(sol * 1e9)) }, `${sol} SOL`))),
      el('div', { class: 'w-say' }, el('input', { id: 'w-tip-custom', type: 'number', min: '0.001', max: '1', step: '0.001', placeholder: '0.001–1 SOL', 'aria-label': 'custom tip' }), el('button', { type: 'button', id: 'w-tip-send', onclick: () => { const v = Number($('w-tip-custom')?.value); if (v) actions.donate('tip', Math.round(v * 1e9)); } }, 'TIP')),
      el('input', { id: 'w-note-in', maxlength: 80, placeholder: 'note with a tip (optional)', autocomplete: 'off' }));
  } else parts.push(el('p', { class: 'dim w-small' }, 'Donations are off.'));
  box.replaceChildren(...parts, el('div', { id: 'w-msg', class: 'w-small' }), el('div', { class: 'dim w-small', title: P.me.wallet }, `signed in as ${formatDriver(P.me.wallet, P.me.sns)}`));
}
