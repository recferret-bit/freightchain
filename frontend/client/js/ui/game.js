import { CFG } from '../config.js';
import { fmt, store, mulberry32 } from '../util.js';
import { st, clock, IDLE, resetDisp, rideStart, dn } from '../state.js';
import { audio } from '../sim/audio.js';
import { ambientC } from '../sim/climate.js';
import { clearDebris } from '../sim/damage.js';
import { toast } from './toast.js';
import { destroyed } from '../world/props.js';
import { roads } from '../net/orchestrator.js';
import { net } from '../net/network.js';
import { resetScreen, wip } from '../cockpit/windscreen.js';
import { telemetry, FLAGS } from '../telemetry.js';
import { radio } from '../sim/radio.js';
import { trafficSnapshot } from '../sim/traffic.js';
import { clockText, setClock } from '../world/daynight.js';
import { online, beginOnline, endOnline } from '../online.js';
import { offlineRide, connectHref } from '../offline-ride.js';
import { startLiveFeed, stopLiveFeed } from './live-feed.js';
import { startCabChain, stopCabChain, paintSeal } from './cab-chain.js';
import { failFx, winFx } from './fail-fx.js';
import { prompt } from '../prompt.js';
import { track, flushSoon } from '../analytics.js';
import { env } from '../world/environment.js';
import { guide, setGuide } from '../guide.js';
import { startGuide } from './assist.js';
import { SITE_BASE } from '../hosts.js';
import { ridePageUrl, rideShareText, xIntent } from './share.js';
import { resetMap } from './map.js';
import { phone } from '../phone.js';
import { isMobileDevice, showMobileBlocker } from '../mobile.js';
import { RIDE_MODES, canStartRide, canEndRide, canPauseRide, canResumeRide, transitionRideMode, failCode } from './ride-fsm.js';
import { paintHonkInto, syncHonk, mountHonk } from './honk-hud.js';
import { showVerdict, watchReview } from './verdict-view.js';
import { createBailController } from './bail-view.js';

/* Ride flow orchestrator: menu / start / end / pause lifecycle and per-ride reset. */
let lastOutcome = null;

export function resetRide(seed = online.ride?.seed) {   // seed: the server's for an online ride, the watched ride's for a replay (watch.js), random offline
  lastOutcome = null;
  Object.assign(st, rideStart({ rpm: CFG.START_ENGINE_OFF ? 0 : IDLE, engineOn: !CFG.START_ENGINE_OFF, temp: ambientC(), pull: 1 }));
  resetDisp(); destroyed.clear(); clearDebris(); roads.newTrip(seed); resetScreen();   // new road layout, depot, traffic
  st.pull = mulberry32(roads.seed ^ 0x2545f491)() < .5 ? -1 : 1;   // a damaged truck's pull side comes from the road seed: every rider of a pool (one seed) gets the same one
  resetMap();   // the phone back on its mount, the map's view from scratch (an end / pause closes it too: ui/map.js)
  const hour = online.ride?.startHour ?? (seed != null ? [6.5, 12, 18.5, 22][Math.floor(seed / 5) % 4] : null);
  if (hour != null) setClock(hour, true, true);
}

online.extra = () => ({ route: env.theme.id, night: dn.night });   // what the server's public live feed shows next to the ride
online.onRide = r => { if (r && 'honk' in r) { paintHonkInto('honk-line', 'honk-line-more', r.honk); syncHonk(); } };   // heartbeat / start: the server's honk field, never a client formula
prompt.onShow = () => audio.play('warn'); prompt.onAnswer = () => audio.play('ui');   // a dispatch prompt (prompt.js) is heard as well as seen
telemetry.trafficOf = () => trafficSnapshot();   // the cars around the truck, recorded beside each batch for spectators' replays
telemetry.extra = () => [Math.round(dn.t * 100) / 100,
  (st.engineOn ? FLAGS.engine : 0) | (st.keyOn ? FLAGS.key : 0) | (st.park ? FLAGS.park : 0) | (dn.head ? FLAGS.head : 0) | (dn.cab ? FLAGS.cab : 0) | (st.heater ? FLAGS.heater : 0) | (st.cooler ? FLAGS.cooler : 0)
  | (st.washing ? FLAGS.washing : 0) | (wip.mode === 1 ? FLAGS.wipeSlow : wip.mode === 2 ? FLAGS.wipeFast : 0) | (radio.on ? FLAGS.radio : 0) | (st.rev ? FLAGS.rev : 0) | (phone.open ? FLAGS.phone : 0)];

mountHonk();

const overlay = document.getElementById('overlay'), panel = document.getElementById('panel');
const FREE_HINT = `<div style="font-size:12px;color:#b9ad8d">This run is the easy straight road. It ends itself when the shift is done.</div>`;
const guestOpt = { tutorial: store.get('freightchain.guest-tutorial') !== '0', assist: store.get('freightchain.assist') !== '0' };
let menuArgs = ['FREIGHT CHAIN', 'Long-haul truck simulator', ''];

const abandonReason = () => `Shift abandoned before the finish line (${(CFG.COMPLETE_DIST / 1000).toFixed(1)} km).`;
const endShift = (silent = false) => st.complete ? endRide(true, undefined, 'shift', silent) : endRide(false, abandonReason(), 'shift', silent);

const bailCtrl = createBailController({
  overlay,
  panel,
  getMenuArgs: () => menuArgs,
  showMenu: (...args) => showMenu(...args),
  setPaused: (...args) => setPaused(...args),
  endShift,
});
export const syncBail = bailCtrl.syncBail;

function showOfflineMenu(title, sub, extra) {
  const again = !!extra;
  panel.innerHTML = `<h1>${extra ? title : 'FREE RUN'}</h1><h2>${extra ? (lastOutcome?.ok ? 'Shift complete! Connect a wallet to save your rank and claim 10 free rides.' : sub) : 'Just drive – nothing is recorded or ranked.'}</h2>${extra}
    <div class="row"><span>Finish line</span><b>${(CFG.COMPLETE_DIST / 1000).toFixed(1)} km</b></div>${FREE_HINT}
    <label class="row" style="cursor:pointer"><span>TUTORIAL – step-by-step lessons over the road</span><input type="checkbox" id="g-tutorial" ${guestOpt.tutorial ? 'checked' : ''}></label>
    <label class="row" style="cursor:pointer"><span>ASSIST – the truck lasts twice as long, a tip on every control</span><input type="checkbox" id="g-assist" ${guestOpt.assist ? 'checked' : ''}></label>
    <div class="btns"><button id="go">${again ? 'DRIVE AGAIN' : 'START FREE RUN'}</button><button class="alt" id="connect">CONNECT A WALLET</button></div>`;
  overlay.classList.remove('hide');
  document.getElementById('g-tutorial').onchange = e => { guestOpt.tutorial = e.target.checked; store.set('freightchain.guest-tutorial', guestOpt.tutorial ? '1' : '0'); };
  document.getElementById('g-assist').onchange = e => { guestOpt.assist = e.target.checked; store.set('freightchain.assist', guestOpt.assist ? '1' : '0'); };
  document.getElementById('go').onclick = startRide;
  document.getElementById('connect').onclick = () => { location.href = connectHref(); };
  syncBail();
}

export function showMenu(title, sub, extra = '') {
  if (isMobileDevice() && !st.watch) {
    showMobileBlocker();
    return;
  }
  menuArgs = [title, sub, extra];
  if (online.ride || online.error) return showOnlineMenu(title, sub, extra);
  if (offlineRide.on) showOfflineMenu(title, sub, extra);   // no page at all (the headless test): no menu
  syncBail();
}

function showOnlineMenu(title, sub, extra) {
  const over = online.done, bad = !!online.error, canRank = !!(online.ride && (online.ride.tier !== 'free' || online.ride.promo));
  panel.innerHTML = `<h1>${title}</h1><h2>${sub}</h2>${extra}
    ${bad ? `<div class="row"><span>Ride</span><span class="bad">${online.error}</span></div>` : `<div class="row"><span>Finish line</span><b>${(CFG.COMPLETE_DIST / 1000).toFixed(1)} km</b></div>
    <div class="row"><span>Route (set by the server)</span><b>${env.theme.name} · starts ${clockText()}</b></div>
    ${online.ride?.poolId != null ? '<div class="row"><span>Road</span><b class="seal">checking the seal…</b></div>' : ''}`}
    ${over || bad || !canRank ? '' : `<label class="row" style="cursor:pointer"><span>RANKED – this start counts for the weekly board (5 paid, including a granted ticket, plus 1 promo ride). Spectator weather, day and night, and road obstacles are refused. Chat HONK stays.</span><input type="checkbox" id="ranked-toggle" ${store.get('freightchain.ranked') === '1' ? 'checked' : ''}></label>`}
    <div class="btns">${over || bad ? `${over && online.ride ? '<button type="button" class="alt share-x-btn" id="share-x-end" title="Share your ride on 𝕏"><b>POST ON 𝕏</b><small>share progress & receipt</small></button>' : ''}<button class="alt bail-link" id="lobby" title="lobby" style="margin-left:auto"><b>${lastOutcome?.ok ? 'BACK TO THE LOBBY' : 'I MISS THE YARD'}</b><small>lobby</small></button>` : '<button id="go">START RIDE</button>'}</div>`;
  overlay.classList.remove('hide');
  const rankedBox = document.getElementById('ranked-toggle');
  if (rankedBox) rankedBox.onchange = (e) => { store.set('freightchain.ranked', e.target.checked ? '1' : '0'); };
  const go = document.getElementById('go');
  if (go) go.onclick = startRide;
  const lobby = document.getElementById('lobby');
  if (lobby) lobby.onclick = () => { location.href = `${SITE_BASE}/lobby.html`; };
  const shareEnd = document.getElementById('share-x-end');
  if (shareEnd) {
    shareEnd.onclick = () => {
      if (!online.ride) return;
      track('ride_share_clicked', { surface: 'end', link: 'ride', ride_id: online.ride.id });
      const outcome = lastOutcome ? (lastOutcome.ok ? 'COMPLETE' : lastOutcome.abandoned ? 'ABANDONED' : 'FAILED') : (st.complete ? 'COMPLETE' : 'FAILED');
      const text = rideShareText({ phase: 'finished', route: env.theme?.name, tier: online.ride.tier, km: (st.s / 1000).toFixed(2), outcome });
      const url = ridePageUrl(SITE_BASE, typeof location !== 'undefined' ? location.origin : '', online.ride.id);
      if (typeof window !== 'undefined' && window.open) window.open(xIntent(text, url), '_blank', 'noopener,noreferrer');
      toast('Opening 𝕏 to share ride receipt...', 2000);
    };
  }
  paintSeal(); bailCtrl.bindBail(); syncBail();
}

export async function startRide() {   // only an online ride awaits the server
  if (isMobileDevice()) {
    showMobileBlocker();
    return;
  }
  if (online.error || online.done) return;
  audio.start();   // inside this click, before the server round-trip: WebKit will not resume a context created after the await
  if (online.ride) {
    track('ride_start_clicked', { ride_id: online.ride.id, route_id: env.theme.id, phase: dn.phase });
    const canRank = !!(online.ride.tier !== 'free' || online.ride.promo);
    try { await beginOnline({ ranked: canRank && store.get('freightchain.ranked') === '1' }); } catch (e) {
      track('ride_start_failed', { ride_id: online.ride.id, http_status: typeof e.status === 'number' ? e.status : null, code: typeof e.code === 'string' ? e.code : null });
      if (e.code === 'ranked_ineligible' || e.code === 'ranked_training' || e.code === 'guest_easy_only' || e.code === 'ranked_window' || e.code === 'ranked_promo_cap' || e.code === 'ranked_paid_cap') {
        store.set('freightchain.ranked', '0');
        showMenu('RANKED REFUSED', e.message || 'Uncheck RANKED to drive this run unranked.');
        return;
      }
      online.error = e.message;
      if (e.code === 'rides_closed') { online.done = true; showMenu('RIDES CLOSED', 'This pool counts only shifts that end by its play deadline – one started now could not reach the line in time. Your ticket stays in the pool.'); }
      else showMenu('RIDE REFUSED', 'The server did not accept this ride.');
      return;
    }
    if (online.ride.tier !== 'free') startLiveFeed();
    startCabChain();
  } else if (offlineRide.on) {
    if (!canStartRide()) return;
    if (!offlineRide.dev) setGuide({ tutorial: guestOpt.tutorial, assist: guestOpt.assist });
  }
  resetRide(); transitionRideMode(RIDE_MODES.DRIVE); audio.play('start'); overlay.classList.add('hide'); startGuide(); syncBail();
  if (online.ride && 'honk' in online.ride) paintHonkInto('honk-line', 'honk-line-more', online.ride.honk);
  if (!guide.tutorial && !guide.assist) toast(CFG.START_ENGINE_OFF ? 'Press I (engine) · B (release brake) · SHIFT+E (1st gear) · W (gas)' : 'Release parking brake (B) · SHIFT+E (1st gear) · W (gas)', 5000);
  armRoadHint();
}

let roadGen = 0;
function armRoadHint() {
  const gen = ++roadGen;
  const fire = () => {
    if (gen !== roadGen || st.mode !== 'drive' || st.s >= 60) return;
    if (guide.hold || document.body?.classList?.contains?.('tutorial')) { setTimeout(fire, 1000); return; }
    toast(net.straight ? 'Loaded. The road runs straight ahead – go up through the gears' : 'Loaded. Drive slowly to the main road, stop at the line, turn RIGHT into a gap', 7000);
  };
  setTimeout(fire, 6500);
}

function outcomeRows(ok, abandoned, reason, extraRows = '') {
  return `<div class="row"><span>Result</span><b class="${ok ? 'good' : 'bad'}">${ok ? 'COMPLETE' : abandoned ? 'ABANDONED' : 'FAILED'}</b></div>
    <div class="row"><span>Time driven</span><b>${fmt(st.t)}</b></div>
    <div class="row"><span>Distance</span><b>${(st.s / 1000).toFixed(2)} km</b></div>
    ${extraRows}${ok ? '' : `<div class="row"><span>Reason</span><span class="bad">${reason}</span></div>`}`;
}

export function endRide(ok, reason, outcome = ok ? 'shift' : 'failed', silent = false) {
  if (!canEndRide()) return;
  const abandoned = !ok && outcome === 'shift', title = ok ? 'SHIFT COMPLETE' : abandoned ? 'SHIFT ABANDONED' : 'RIDE FAILED';
  if (offlineRide.on) {
    transitionRideMode(RIDE_MODES.DONE); if (!ok && outcome !== 'shift') audio.play('game-over');
    if (!silent) {
      showMenu(title, ok ? 'The road ends here. Another run?' : '', outcomeRows(ok, abandoned, reason));
      if (outcome === 'failed') failFx(); else if (ok) winFx();
    } else syncBail();
    return;
  }
  if (online.ride) { track('ride_end_requested', { outcome, client_complete: !!st.complete, fail_code: failCode(outcome, reason) }); flushSoon(); }
  transitionRideMode(RIDE_MODES.DONE); stopLiveFeed(); stopCabChain(); if (!ok && outcome !== 'shift') audio.play('game-over');
  const verdict = endOnline(outcome, reason);
  lastOutcome = { ok, abandoned };
  const onlineRows = `${st.reds ? `<div class="row"><span>Red lights run</span><b class="bad">${st.reds}</b></div>` : ''}
    ${online.ride ? '<div class="row"><span>Server verdict</span><b id="verdict">…</b></div><div class="row" id="honk-end" hidden><span id="honk-end-k"></span><b id="honk-end-v"></b></div><div class="row" id="honk-end-more" hidden><span id="honk-end-more-k"></span><b id="honk-end-more-v"></b></div>' : ''}`;
  if (!silent) {
    showMenu(title, ok ? 'Freight on its way. Another one?' : '', outcomeRows(ok, abandoned, reason, onlineRows));
    if (online.ride && 'honk' in online.ride) paintHonkInto('honk-end', 'honk-end-more', online.ride.honk);
    if (outcome === 'failed') failFx(); else if (ok) winFx();
  } else syncBail();
  verdict?.then(v => { if (showVerdict(v)) watchReview(); });
  return verdict;
}

export function setPaused(p, source = 'key') {
  if (st.watch) return;
  if (p && canPauseRide()) {
    transitionRideMode(RIDE_MODES.PAUSED); bailCtrl.paintPause();
    if (online.ride) { track('ride_paused', { via: source }); if (source === 'visibility') flushSoon(); }
  }
  else if (!p && canResumeRide()) {
    transitionRideMode(RIDE_MODES.DRIVE); overlay.classList.add('hide'); clock.last = performance.now();
    if (online.ride) track('ride_unpaused', { via: source });
    syncBail();
  }
}

document.addEventListener('visibilitychange', () => { if (document.hidden) setPaused(true, 'visibility'); });
