import { fmt } from '../util.js';
import { st } from '../state.js';
import { audio } from '../sim/audio.js';
import { getTheme } from '../themes/index.js';
import { SITE_BASE } from '../hosts.js';
import { watch, seek, goLive, addEvent, roadCheck, replayEnd, LIVE_LAG } from '../watch.js';
import { EFFECT_INFO, solText } from '../live-effects.js';
import { el } from '../../site/dom.js';
import { api, prepareSignIn } from '../../site/wallet.js';
import { explorerTx } from '../../site/pools.js';
import { formatDriver, getCachedSns, reverseResolveSns } from '../../site/sns.js';
import { paintPledges, pledgeForm } from './watch-pledges.js';
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

export function mountWatchPanel() {
  document.getElementById('overlay')?.classList.add('hide');
  if (watch.error && !watch.ride) return mountError();
  const r = watch.ride;
  const speeds = [1, 4, 16].map(x => el('button', { class: 'alt spd', 'data-x': x, onclick: () => { watch.speed = x; watch.follow = false; watch.playing = true; paint(); } }, `${x}×`));
  const toggleFold = () => {
    P.root.classList.toggle('folded');
    const btn = P.root.querySelector('.w-fold');
    if (btn) btn.textContent = P.root.classList.contains('folded') ? '⇤' : '⇥';
  };
  const whoEl = el('b', { class: 'w-who', title: r.wallet }, formatDriver(r.wallet, r.sns ?? getCachedSns(r.wallet)));
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
    el('div', { class: 'w-stats' }, el('span', {}, '⏱ ', el('b', { id: 'w-time' })), el('span', {}, '↦ ', el('b', { id: 'w-dist' })), el('span', {}, 'hull ', el('b', { id: 'w-hull' }))),
    el('div', { id: 'w-note', class: 'dim w-small' }),
    el('div', { id: 'w-road', class: 'w-road', title: 'the holes on this road are the server\'s, rebuilt from the ride\'s seed – this is what the recorded truck did at them' }),
    el('div', { class: 'w-track' },
      el('input', { id: 'w-seek', type: 'range', min: 0, max: 1, step: 1, value: 0, 'aria-label': 'position in the ride', oninput: e => seek(+e.target.value) }),
      el('div', { id: 'w-marks', class: 'w-marks', 'aria-hidden': 'true' })),
    el('div', { class: 'w-ctl' },
      el('button', { id: 'w-play', class: 'alt', onclick: () => { watch.playing = !watch.playing; paint(); } }, '❚❚'), ...speeds,
      el('button', { id: 'w-live', class: 'alt', onclick: () => { goLive(); paint(); } }, '● LIVE'),
      el('button', { id: 'w-sound', class: 'alt', title: 'engine sound (M mutes)', onclick: () => { if (audio.ctx) audio.muted = !audio.muted; else { audio.start(); audio.muted = false; } paint(); } }, '🔇')),
    el('div', { class: 'w-feed', id: 'w-feed', 'aria-live': 'polite' }),
    el('div', { id: 'w-me' }),
    el('div', { id: 'w-pledges', class: 'w-pledges' }),
    el('div', { class: 'w-foot' }, el('span', { class: 'dim' }, 'replays the verified-play recording')));
  document.body.append(P.root, el('div', { id: 'w-stamp', class: 'w-stamp', hidden: true, role: 'status' }));
  for (const e of watch.events.values()) feedLine(e);
  watch.onUpdate = paint; watch.onEvent = (e, why) => (why === 'new' ? feedLine(e) : markApplied(e));
  setInterval(paintClock, 250);
  refreshMe(); paint();
  if (r.poolId !== null && r.poolId !== undefined) { const pl = () => paintPledges($('w-pledges'), watch.ride, P.me); pl(); setInterval(pl, 20000); }
}

function mountError() {
  document.body.append(el('aside', { id: 'watch', class: 'w-error' }, el('b', {}, 'NOTHING TO WATCH'), el('p', {}, watch.error), el('a', { href: `${SITE_BASE}/lobby.html#live` }, '← trucks on the road')));
}

async function refreshMe() {
  try { P.me = await api('me'); } catch { P.me = null; }
  paintMe();
  if (watch.ride && watch.ride.poolId !== null && watch.ride.poolId !== undefined) paintPledges($('w-pledges'), watch.ride, P.me);
  if (P.me) resumeDonation(addOwn).catch(() => {});
}

function paint() {
  const r = watch.ride; if (!r || !P.root) return;
  $('w-route').textContent = r.route ? getTheme(r.route).name : 'route not reported yet';
  const live = r.live && watch.follow, state = $('w-state');
  state.textContent = r.live ? (live ? `● LIVE · ~${LIVE_LAG} s behind` : '● LIVE · you are behind') : `REPLAY · ${STATUS[r.status] ?? r.status}`;
  state.className = `w-badge${r.live ? ' on' : ''}`;
  $('w-viewers').textContent = r.live ? `👁 ${watch.viewers}` : ''; $('w-viewers').hidden = !r.live;
  $('w-live').hidden = !r.live; $('w-live').classList.toggle('sel', live);
  $('w-play').textContent = watch.playing ? '❚❚' : '▶';
  for (const b of P.root.querySelectorAll('.spd')) { b.hidden = live; b.classList.toggle('sel', !live && watch.speed === +b.dataset.x); }
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
  $('w-time').textContent = `${hms(st.t)} / ${hms(r.live ? r.minSeconds : replayEnd())}`;
  $('w-dist').textContent = `${km(st.s)} / ${km(r.completeDist)} km`;
  $('w-hull').textContent = `${Math.round(st.hull)}%`;
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
  const key = `${end}:${c.marks.map(m => m.hole + m.outcome).join()}`;
  if (key !== marksKey) {
    marksKey = key;
    $('w-marks').replaceChildren(...c.marks.map(m => el('i', { class: `w-mark ${m.outcome}`, style: `left:${Math.min(100, (m.t / end) * 100).toFixed(2)}%`, title: `${m.type} at ${km(m.s)} km – ${m.outcome === 'ignored' ? `driven through untouched (the game takes ${m.expected.toFixed(1)} % hull)` : `hit: −${m.got.toFixed(1)} % hull`}`, onclick: () => { seek(Math.max(0, m.t - 6)); watch.playing = true; paint(); } })));
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
  const row = el('div', { class: `w-line${e.kind === 'donation' ? ' gift' : ''}${mine ? ' me' : ''}`, 'data-id': e.id },
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
  if (!r.live) { box.replaceChildren(el('p', { class: 'dim w-small' }, 'This ride is over – the feed is read-only. Chat and donations go to rides on the road.')); return; }
  if (!P.me) {
    box.replaceChildren(el('p', { class: 'w-small' }, 'Sign in with your Solana wallet to write to the driver and send donations that change their ride.'),
      el('button', { onclick: actions.connect, onpointerdown: () => prepareSignIn(), disabled: P.busy }, 'CONNECT WALLET'), el('div', { id: 'w-msg', class: 'w-small' }));
    prepareSignIn();
    return;
  }
  if (P.me.wallet === r.wallet) { box.replaceChildren(el('p', { class: 'dim w-small' }, 'This is your own ride – spectators write here.')); return; }
  const f = watch.features, key = `${P.me.wallet}|${r.ranked ? 1 : 0}|${JSON.stringify(f)}`;
  if (box.dataset.ready === key) return;
  box.dataset.ready = key;
  const parts = [];
  if (f.chat) parts.push(el('div', { class: 'w-say' }, el('input', { id: 'w-text', maxlength: 140, placeholder: 'say something to the driver…', autocomplete: 'off', onkeydown: e => { if (e.key === 'Enter') actions.send(); } }), el('button', { type: 'button', onclick: actions.send }, 'SEND'), actions.honkBtn()));
  else parts.push(el('p', { class: 'dim w-small' }, 'Chat is off on this ride.'), el('div', { class: 'w-say' }, actions.honkBtn()));
  if (!r.ranked) parts.push(...actions.timeControls());
  if (f.donations) {
    const fx = Object.entries(EFFECT_INFO).filter(([id]) => f.effects || id === 'tip'), chain = f.payment === 'chain';
    parts.push(el('div', { class: 'w-k' }, chain ? 'DONATE · devnet SOL, sent from your wallet to the driver' : 'DONATE · mock SOL – nothing is charged', f.effects ? ' · one effect per 20 s on a ride' : ' · effects are off on this ride – tips only'),
      el('div', { class: 'w-fx' }, ...fx.map(([id, e]) => el('button', { class: 'alt', title: `${e.says}${chain ? ' – paid to the driver in devnet SOL' : ''}`, onclick: () => actions.donate(id) }, `${e.icon} ${e.label}`, el('small', {}, `${e.sol} SOL`)))),
      el('input', { id: 'w-note-in', maxlength: 80, placeholder: 'note with a donation (optional)', autocomplete: 'off' }));
  } else parts.push(el('p', { class: 'dim w-small' }, 'Donations are off.'));
  const pf = pledgeForm(r, say, () => paintPledges($('w-pledges'), watch.ride, P.me));
  if (pf) parts.push(pf);
  box.replaceChildren(...parts, el('div', { id: 'w-msg', class: 'w-small' }), el('div', { class: 'dim w-small', title: P.me.wallet }, `signed in as ${formatDriver(P.me.wallet, P.me.sns)}`));
}
