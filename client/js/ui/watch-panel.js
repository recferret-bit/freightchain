import { fmt } from '../util.js';
import { st } from '../state.js';
import { audio } from '../sim/audio.js';
import { getTheme } from '../themes/index.js';
import { SITE_BASE } from '../hosts.js';
import { watch, seek, goLive, addEvent, roadCheck, replayEnd, LIVE_LAG } from '../watch.js';
import { EFFECT_INFO, solText } from '../live-effects.js';
import { el } from '../../site/dom.js';
import { api, signIn } from '../../site/wallet.js';
import { phoneStep, signAndSend } from '../../site/pay.js';
import { solanaPayUrl, donationPayPath } from '../../site/solana-pay.js';
import { API_BASE } from '../hosts.js';
import { explorerTx } from '../../site/pools.js';
import { formatDriver, getCachedSns, reverseResolveSns } from '../../site/sns.js';
import { paintPledges, pledgeForm } from './watch-pledges.js';

/* The watch page's panel (play.html?watch=<id>): who / where / how far, the timeline (live edge or replay with speeds), the ride's feed, and – signed in –
   the chat box, the donation buttons and – on a ticket ride – pledges per km (watch-pledges.js). Server text only through el() / textContent. Spectator actions go to /api/watch/:id/* (server/src/presentation/live). */
const TIER = { free: 'TEST RIDE', '1h': '1 HOUR', '4h': '4 HOURS', '8h': '8 HOURS' };
const STATUS = { running: 'ON THE ROAD', completed: 'COMPLETED', abandoned: 'ABANDONED', failed: 'FAILED' };
const P = { me: null, root: null, busy: false, endShown: false };
const $ = id => document.getElementById(id);
const hms = t => (t >= 3600 ? `${Math.floor(t / 3600)}:${fmt(t % 3600)}` : fmt(t));
const km = m => (m / 1000).toFixed(1);

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

const donationKey = rideId => `freightchain.donation.${rideId}`;
const rememberDonation = (rideId, orderId) => { try { sessionStorage.setItem(donationKey(rideId), orderId); } catch { /* private mode */ } };
const forgetDonation = rideId => { try { sessionStorage.removeItem(donationKey(rideId)); } catch { /* private mode */ } };
async function refreshMe() {
  try { P.me = await api('me'); } catch { P.me = null; }
  paintMe();
  if (P.me) resumeDonation().catch(() => {});
}
/** A phone payment whose page reloaded before confirm: the order id is in this browser, the reference is on the server. */
async function resumeDonation() {
  if (watch.features?.payment !== 'chain' || !watch.id) return;
  let orderId = null; try { orderId = sessionStorage.getItem(donationKey(watch.id)); } catch { return; }
  if (!orderId) return;
  const r = await api(`watch/${encodeURIComponent(watch.id)}/donation-orders/${orderId}/reconcile`, {}).catch(() => null);
  if (r?.status !== 'paid') return;
  forgetDonation(watch.id);
  if (!watch.events.has(r.event.id)) addOwn(r.event);
}

/* ───── the parts that change ───── */
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
/* the end of a finished ride's replay: the same result dialog a driver gets (game.js showOnlineMenu), with the lobby as the only way on. It hides again when the viewer seeks back. */
function paintEnd() {
  const r = watch.ride, ov = $('overlay'), panel = $('panel');
  const atEnd = !!r && !r.live && r.status !== 'running' && watch.rows.length > 0 && !watch.playing && !watch.buffering && watch.wt >= replayEnd() - 0.5;
  if (!ov || !panel) return;
  if (!atEnd) { if (P.endShown) { ov.classList.add('hide'); P.endShown = false; } return; }
  if (P.endShown) return;
  P.endShown = true;
  const ok = r.status === 'completed';
  panel.replaceChildren(el('h1', {}, ok ? 'SHIFT COMPLETE' : r.status === 'abandoned' ? 'SHIFT ABANDONED' : 'RIDE FAILED'), el('h2', {}, 'End of the replay.'),
    ...[['Result', el('b', { class: ok ? 'good' : 'bad' }, (STATUS[r.status] ?? r.status))], ['Time driven', el('b', {}, hms(st.t))], ['Distance', el('b', {}, `${(st.s / 1000).toFixed(2)} km`)], ['Hull', el('b', {}, `${Math.round(st.hull)}%`)]]
      .map(([k, v]) => el('div', { class: 'row' }, el('span', {}, k), v)),
    el('div', { class: 'btns' }, el('button', { type: 'button', id: 'lobby', class: 'alt bail-link', style: 'margin-left:auto', onclick: () => { location.href = `${SITE_BASE}/lobby.html`; } }, el('b', {}, 'BACK TO THE LOBBY'), el('small', {}, 'lobby'))));
  ov.classList.remove('hide');
}
function paintClock() {
  const r = watch.ride; if (!r || !P.root) return;
  const sk = $('w-seek'), end = Math.max(1, Math.floor(replayEnd()));
  sk.max = end; if (document.activeElement !== sk) sk.value = Math.floor(watch.wt);
  $('w-time').textContent = `${hms(st.t)} / ${hms(r.live ? r.minSeconds : replayEnd())}`;   // a finished ride: its own length, not the nominal shift
  $('w-dist').textContent = `${km(st.s)} / ${km(r.completeDist)} km`;
  $('w-hull').textContent = `${Math.round(st.hull)}%`;
  const note = !watch.rows.length ? (watch.rec.lastSeq === null && !r.live ? 'no recording kept for this ride' : 'waiting for the first recording…')
    : watch.buffering ? (r.live && watch.follow ? 'the driver is paused or the next batch is on its way…' : watch.wt >= replayEnd() - 1 && !r.live ? `end of the ride · ${STATUS[r.status] ?? r.status}` : 'loading…') : '';
  $('w-note').textContent = note;
  paintRoad(end); paintEnd();
}

/* the ROAD CHECK: what the recorded truck did at the server's holes (watch.js roadCheck) – a line in the panel, a mark on the timeline per hole hit (amber)
   or driven through untouched (red, click = jump there), and the NO IMPACT stamp while the replay passes one */
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

/* ───── feed ───── */
function feedLine(e) {
  const box = $('w-feed'); if (!box) return;
  const fx = EFFECT_INFO[e.effect], mine = P.me && e.wallet === P.me.wallet;
  const body = e.kind === 'message' ? [e.text] : [`${fx?.icon ?? '💰'} ${fx?.says ?? 'donated'} · ${solText(e.lamports)} `,
    e.signature ? el('a', { href: explorerTx(e.signature), target: '_blank', rel: 'noopener', title: 'the transfer to the driver on the Solana explorer (devnet)' }, 'paid ↗') : el('small', {}, '(mock)'), e.text ? ` – “${e.text}”` : ''];
  const row = el('div', { class: `w-line${e.kind === 'donation' ? ' gift' : ''}${mine ? ' me' : ''}`, 'data-id': e.id },
    el('b', { title: e.wallet }, `${formatDriver(e.wallet, e.sns)}${e.wallet === watch.ride?.wallet ? ' (driver)' : ''}: `), ...body,
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
  const f = watch.features, key = `${P.me.wallet}|${JSON.stringify(f)}`;
  if (box.dataset.ready === key) return;   // built once per signed-in wallet and feature set (keeps what is being typed)
  box.dataset.ready = key;
  const parts = [];
  if (f.chat) parts.push(el('div', { class: 'w-say' }, el('input', { id: 'w-text', maxlength: 140, placeholder: 'say something to the driver…', autocomplete: 'off', onkeydown: e => { if (e.key === 'Enter') send(); } }), el('button', { onclick: send }, 'SEND')));
  else parts.push(el('p', { class: 'dim w-small' }, 'Chat is off on this ride.'));
  if (f.donations) {
    const fx = Object.entries(EFFECT_INFO).filter(([id]) => f.effects || id === 'tip'), chain = f.payment === 'chain';
    parts.push(el('div', { class: 'w-k' }, chain ? 'DONATE · devnet SOL, sent from your wallet to the driver' : 'DONATE · mock SOL – nothing is charged', f.effects ? ' · one effect per 20 s on a ride' : ' · effects are off on this ride – tips only'),
      el('div', { class: 'w-fx' }, ...fx.map(([id, e]) => el('button', { class: 'alt', title: `${e.says}${chain ? ' – paid to the driver in devnet SOL' : ''}`, onclick: () => donate(id) }, `${e.icon} ${e.label}`, el('small', {}, `${e.sol} SOL`)))),
      el('input', { id: 'w-note-in', maxlength: 80, placeholder: 'note with a donation (optional)', autocomplete: 'off' }));
  } else parts.push(el('p', { class: 'dim w-small' }, 'Donations are off.'));
  const pf = pledgeForm(r, say, () => paintPledges($('w-pledges'), watch.ride, P.me));
  if (pf) parts.push(pf);
  box.replaceChildren(...parts, el('div', { id: 'w-msg', class: 'w-small' }), el('div', { class: 'dim w-small', title: P.me.wallet }, `signed in as ${formatDriver(P.me.wallet, P.me.sns)}`));
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
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function showDonationQr(url) {
  if (!url) { $('w-qr')?.remove(); return; }
  const { payQrBlock } = await import('../../site/qr.js');
  const msg = $('w-msg'); if (!msg?.isConnected) return;
  let box = $('w-qr');
  if (!box) { box = el('div', { id: 'w-qr', class: 'pay-qr' }); msg.before(box); }
  box.replaceChildren(...payQrBlock(url, 'dim w-small'));
}
const sent = (effect, how) => (effect === 'tip' ? `Tip sent (${how}).` : `${EFFECT_INFO[effect].label} sent (${how}) – it happens when the driver's game picks it up; you see it here ~${LIVE_LAG} s later.`);
async function donate(effect) {
  if (P.busy) return;
  const n = $('w-note-in'), note = n?.value.trim() || null, id = encodeURIComponent(watch.id);
  P.busy = true;
  const stop = { done: false };   // set when this donation is settled either way: the phone poll must not outlive it
  try {
    if (watch.features.payment !== 'chain') {   // MOCK: nothing is charged
      addOwn(await api(`watch/${id}/donations`, { effect, note })); say(sent(effect, 'mock'), 'good');
    } else {   // PAID: the server builds the transfer to the driver, your wallet signs and sends it, the server sees it on chain
      say('Preparing the transfer…');
      const { order, transaction } = await api(`watch/${id}/donation-orders`, { effect, note });
      rememberDonation(watch.id, order.id);
      await showDonationQr(solanaPayUrl(API_BASE, location.origin, donationPayPath(order.id)));
      const phone = async () => {
        const end = Date.now() + 90000;
        while (!stop.done && Date.now() < end) {
          const r = await api(`watch/${id}/donation-orders/${order.id}/reconcile`, {}).catch(() => null);
          if (r?.status === 'paid') return r;
          await sleep(3000);
        }
        return null;
      };
      let signature;
      try {
        say(`Approve ${solText(order.lamports)} (devnet) to the driver in your wallet…`);
        signature = await signAndSend(transaction.transaction);
      } catch (e) {
        say(e?.code === 'no_wallet' ? 'No browser wallet. Scan the code with the phone wallet that holds this account (devnet)…' : phoneStep(e));
        const found = await phone();
        if (found?.status === 'paid') { forgetDonation(watch.id); if (n) n.value = ''; addOwn(found.event); say(found.event.effect === effect ? sent(effect, 'paid') : `Paid – ${found.event.text ?? 'delivered as a tip'}.`, 'good'); return; }
        throw e;
      }
      say('Sent – waiting for the network to confirm…');
      const phonePaid = phone();
      for (let i = 0; i < 60; i++) {
        const r = await Promise.race([
          api(`watch/${id}/donation-orders/${order.id}/confirm`, { signature }),
          phonePaid.then(hit => hit ?? new Promise(() => {})),
        ]);
        if (r.status === 'paid') { forgetDonation(watch.id); if (n) n.value = ''; addOwn(r.event); say(r.event.effect === effect ? sent(effect, 'paid') : `Paid – ${r.event.text ?? 'delivered as a tip'}.`, 'good'); return; }
        await sleep(1500);
      }
      const late = await phonePaid;
      if (late?.status === 'paid') { forgetDonation(watch.id); if (n) n.value = ''; addOwn(late.event); say(late.event.effect === effect ? sent(effect, 'paid') : `Paid – ${late.event.text ?? 'delivered as a tip'}.`, 'good'); return; }
      say('The network has not confirmed it yet – it appears in the feed once it does (reload to check).', 'dim');
    }
    if (n) n.value = '';
  } catch (e) { say(e.message, 'bad'); if (e.status === 401) refreshMe(); }
  finally { stop.done = true; P.busy = false; $('w-qr')?.remove(); }
}
const addOwn = e => addEvent(e);   // shown at once (onEvent paints it); the next poll knows the id
