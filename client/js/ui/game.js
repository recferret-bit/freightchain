import { CFG } from '../config.js';
import { Wallet } from '../wallet.js';
import { fmt } from '../util.js';
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
import { routesHTML, bindRoutes, timeHTML, bindTime } from './routes.js';
import { online, beginOnline, endOnline } from '../online.js';
import { startLiveFeed, stopLiveFeed } from './live-feed.js';
import { failFx, winFx } from './fail-fx.js';
import { prompt } from '../prompt.js';
import { track, flushSoon } from '../analytics.js';
import { env } from '../world/environment.js';
import { SITE_BASE } from '../hosts.js';

/* Ride flow: menu / start / end / pause overlay and per-ride reset. */

export function resetRide(seed = online.ride?.seed) {   // seed: the server's for an online ride, the watched ride's for a replay (watch.js), random offline
  Object.assign(st, rideStart({ rpm: CFG.START_ENGINE_OFF ? 0 : IDLE, engineOn: !CFG.START_ENGINE_OFF, temp: ambientC(), pull: Math.random() < .5 ? -1 : 1 }));
  resetDisp(); destroyed.clear(); clearDebris(); roads.newTrip(seed); resetScreen();   // new road layout, depot, traffic
}

online.extra = () => ({ route: env.theme.id, night: dn.night });   // what the server's public live feed shows next to the ride
prompt.onShow = () => audio.play('warn'); prompt.onAnswer = () => audio.play('ui');   // a dispatch prompt (prompt.js) is heard as well as seen
/* the recording's two replay columns (telemetry.js): the hour of the day + the cab's switches, so a spectator sees the lights / wipers the driver had */
telemetry.trafficOf = () => trafficSnapshot();   // the cars around the truck, recorded beside each batch for spectators' replays
telemetry.extra = () => [Math.round(dn.t * 100) / 100,
  (st.engineOn ? FLAGS.engine : 0) | (st.keyOn ? FLAGS.key : 0) | (st.park ? FLAGS.park : 0) | (dn.head ? FLAGS.head : 0) | (dn.cab ? FLAGS.cab : 0) | (st.heater ? FLAGS.heater : 0)
  | (st.washing ? FLAGS.washing : 0) | (wip.mode === 1 ? FLAGS.wipeSlow : wip.mode === 2 ? FLAGS.wipeFast : 0) | (radio.on ? FLAGS.radio : 0) | (st.rev ? FLAGS.rev : 0)];

/* ───────────────────────── overlay / game flow ───────────────────────── */
const overlay = document.getElementById('overlay'), panel = document.getElementById('panel');
const CONTROLS = `<table>
<tr><td>W / ↑</td><td>Gas</td></tr><tr><td>S / ↓</td><td>Brake</td></tr>
<tr><td>A D / ← →</td><td>Steer (the road bends – and the wind pushes you!)</td></tr>
<tr><td>SHIFT / SPACE</td><td>Hold = clutch pedal in</td></tr>
<tr><td>E / Q</td><td>Gear up / down (clutch must be in) · 1-7 / 0 select gear / neutral · Q from neutral or G = REVERSE (stop first; beeper + slow, trailer swings)</td></tr>
<tr><td>I</td><td>Start engine (and restart after a stall) · P pause · M mute</td></tr><tr><td>N / L / C</td><td>Night / day · headlights · cab light (or the HEAD / NIGHT dash buttons and the dome lamp above the windscreen)</td></tr><tr><td>H</td><td>Cab heater (HEAT button) – clears frost on the glass, but only as warm as the engine is · cold engine: keep the revs low until TEMP rises</td></tr><tr><td>R / X</td><td>Wipers off / slow / fast · hold X = washer spray + wipe (or click WIPER / WASH on the dash)</td></tr></table>
<div style="font-size:12px;color:#b9ad8d">Launch: hold clutch → E (1st) → press gas, ease the clutch out. Clutch out too fast at low revs = stall.<br>Everything beside the road can be smashed – but it damages the hull. 0% hull = wrecked.<br>Other traffic: scratches cost hull, a direct head-on / rear-end hit ends the ride – overtake only when the opposite lane is clear.<br>You start at the depot: give way at the main road, turn right slowly. Crossroads have traffic lights – side traffic goes on its green.</div>`;
export function showMenu(title, sub, extra = '') {
  if (online.ride || online.error) return showOnlineMenu(title, sub, extra);
  const bal = Wallet.balance(), can = bal >= CFG.FARE;
  panel.innerHTML = `<h1>${title}</h1><h2>${sub}</h2>${extra}${routesHTML()}${timeHTML()}
    <div class="row"><span>Wallet</span><b>${bal.toFixed(1)} FRT</b></div>
    <div class="row"><span>Ride fare</span><b>${CFG.FARE.toFixed(1)} FRT</b></div>
    <div class="row"><span>Shift (the road never ends)</span><b>${fmt(CFG.RIDE_MIN_SECONDS)} · ${(CFG.COMPLETE_DIST / 1000).toFixed(1)} km</b></div>${CONTROLS}
    <div class="btns"><button id="go" ${can ? '' : 'disabled'}>${can ? 'START RIDE  (−' + CFG.FARE + ' FRT)' : 'INSUFFICIENT FUNDS'}</button><button class="alt" id="topup">+100 test FRT</button></div>`;
  overlay.classList.remove('hide'); bindRoutes(panel); bindTime(panel);
  document.getElementById('go').onclick = startRide;
  document.getElementById('topup').onclick = () => { Wallet.credit(100); showMenu(title, sub, extra); };
}
/* online ride (play.html?ride=…): the server issued it, so no mock wallet here – START begins the server-timed ride, afterwards the only way on is the lobby */
function showOnlineMenu(title, sub, extra) {
  const over = online.done, bad = !!online.error;
  panel.innerHTML = `<h1>${title}</h1><h2>${sub}</h2>${extra}${over || bad ? '' : routesHTML() + timeHTML()}
    ${bad ? `<div class="row"><span>Ride</span><span class="bad">${online.error}</span></div>` : `<div class="row"><span>Shift (server-timed)</span><b>${fmt(CFG.RIDE_MIN_SECONDS)} · ${(CFG.COMPLETE_DIST / 1000).toFixed(1)} km${online.ride.timeScale > 1 ? ` · DEMO ×${online.ride.timeScale}` : ''}</b></div>`}${over || bad ? '' : CONTROLS}
    <div class="btns"><button id="go" ${bad || over ? 'disabled' : ''}>START RIDE</button><button class="alt" id="lobby">${over || bad ? 'BACK TO LOBBY' : 'LOBBY'}</button></div>`;
  overlay.classList.remove('hide');
  if (!over && !bad) { bindRoutes(panel); bindTime(panel); }
  document.getElementById('go').onclick = startRide;
  document.getElementById('lobby').onclick = () => { location.href = `${SITE_BASE}/lobby.html`; };
}
/* Same strings the server stores, so a client "I finished" can be compared with the verdict. Not a completion metric. */
function failCode(outcome, reason) {
  if (outcome !== 'failed' || typeof reason !== 'string' || !reason) return null;
  if (reason.startsWith('heartbeat lost')) return 'heartbeat_lost';
  if (reason.startsWith('implausible progress (')) return 'implausible_progress';
  if (reason.startsWith('shift complete') || reason.startsWith('shift abandoned') || reason.startsWith('Shift abandoned') || reason === 'replaced by a paid ride') return null;
  if (reason.includes('brakes')) return 'brakes';
  if (reason.includes('blew') || reason.includes('max revs')) return 'engine_blown';
  if (reason.includes('cold')) return 'cold_engine';
  if (reason.includes('hull')) return 'hull';
  if (reason.includes('off the road')) return 'off_road';
  if (reason.includes('collision') || reason.includes('crashed into') || reason.includes('drove into') || reason.includes('ran into')) return 'crash';
  return 'other';
}
export async function startRide() {   // (offline there is no await, so it still runs synchronously)
  if (online.error || online.done) return;
  if (online.ride) {
    track('ride_start_clicked', { ride_id: online.ride.id, route_id: env.theme.id, phase: dn.phase });
    try { await beginOnline(); } catch (e) {
      online.error = e.message;
      track('ride_start_failed', { ride_id: online.ride.id, http_status: typeof e.status === 'number' ? e.status : null, code: typeof e.code === 'string' ? e.code : null });
      showMenu('RIDE REFUSED', 'The server did not accept this ride.');
      return;
    }
    startLiveFeed();   // spectators' chat + effects (live streams)
  }
  else if (!Wallet.charge(CFG.FARE)) return;
  resetRide(); st.mode = 'drive'; audio.start(); audio.play('start'); overlay.classList.add('hide');
  toast(CFG.START_ENGINE_OFF ? 'Press I to start the engine and B to release the parking brake, then SHIFT (clutch) → E (1st) → W (gas) → ease the clutch out' : 'Release the parking brake (B), then hold SHIFT (clutch) → E (1st gear) → W (gas) → ease the clutch out', 6000);
  setTimeout(() => { if (st.mode === 'drive' && st.s < 60) toast(net.straight ? 'Loaded. The road runs straight ahead – go up through the gears' : 'Loaded. Drive slowly to the main road, stop at the line, turn RIGHT into a gap', 7000); }, 6500);
}
/* The road never ends: a ride ends by failing, or by the driver ending the shift (pause menu). It pays out only once the shift is complete
   (st.complete: RIDE_MIN_SECONDS driven AND CFG.COMPLETE_DIST covered, set in sim/physics.js). */
export function endRide(ok, reason, outcome = ok ? 'shift' : 'failed') {   // outcome: what the server is told – abandoning a shift is 'shift' (the server judges it), a crash is 'failed'
  if (st.mode !== 'drive' && st.mode !== 'paused') return;
  if (online.ride) { track('ride_end_requested', { outcome, client_complete: !!st.complete, fail_code: failCode(outcome, reason) }); flushSoon(); }   // before endOnline; the server verdict is the completion metric
  st.mode = 'done'; stopLiveFeed(); if (!ok) audio.play('game-over');
  const verdict = endOnline(outcome, reason);   // null offline
  if (ok && !online.ride) Wallet.credit(CFG.REWARD);
  showMenu(ok ? 'SHIFT COMPLETE' : 'RIDE FAILED', ok ? 'Freight on its way. Another one?' : 'Fare is non-refundable.',
    `<div class="row"><span>Result</span><b class="${ok ? 'good' : 'bad'}">${ok ? 'COMPLETE' : 'FAILED'}</b></div>
     <div class="row"><span>Time driven</span><b>${fmt(st.t)}</b></div>
     <div class="row"><span>Distance</span><b>${(st.s / 1000).toFixed(2)} km</b></div>
     ${st.reds ? `<div class="row"><span>Red lights run</span><b class="bad">${st.reds}</b></div>` : ''}
     ${online.ride ? '<div class="row"><span>Server verdict</span><b id="verdict">…</b></div>' : ''}
     ${ok ? `<div class="row"><span>Payout</span><b>${CFG.REWARD.toFixed(1)} FRT</b></div>` : `<div class="row"><span>Reason</span><span class="bad">${reason}</span></div>`}`);
  if (outcome === 'failed') failFx();   // not for an abandoned shift – only a real failure (crash, red light, wreck…)
  else if (ok) winFx();   // a complete shift: the same beat in green
  verdict?.then(v => { const el = document.getElementById('verdict'); if (el && v) el.textContent = verdictText(v); });
}
/* the server's answer: the ride's outcome, then for a completed shift its recording check (verified play) – only VERIFIED shifts rank for prizes */
const verdictText = v => {
  const outcome = `${v.status.toUpperCase()}${v.status === 'completed' ? '' : ` – ${v.reason ?? ''}`}`;
  if (!v.verdict) return outcome;
  const why = v.verdict.reasons.map(r => r.detail).join('; ');
  return `${outcome} · ${v.verdict.status.toUpperCase()}${why ? ` – ${why}` : ''}`;
};
const endShift = () => st.complete ? endRide(true) : endRide(false, `Shift abandoned before it was complete (${fmt(CFG.RIDE_MIN_SECONDS)} and ${(CFG.COMPLETE_DIST / 1000).toFixed(1)} km).`, 'shift');
export function setPaused(p, source = 'key') {
  if (st.watch) return;   // a spectator has nothing to pause: the watch panel has its own play / pause
  if (p && st.mode === 'drive') {
    st.mode = 'paused'; panel.innerHTML = `<h1>PAUSED</h1><h2>Time does not accrue while paused. The road never ends – end the shift here.</h2><div class="btns"><button id="resume">RESUME</button><button class="alt" id="endshift">${st.complete ? 'END SHIFT (complete)' : 'ABANDON SHIFT'}</button></div>`;
    overlay.classList.remove('hide'); document.getElementById('resume').onclick = () => setPaused(false); document.getElementById('endshift').onclick = endShift;
    if (online.ride) { track('ride_paused', { source }); if (source === 'visibility') flushSoon(); }   // transition only, not per frame
  }
  else if (!p && st.mode === 'paused') {
    st.mode = 'drive'; overlay.classList.add('hide'); clock.last = performance.now();
    if (online.ride) track('ride_unpaused', { source });   // not ride_resumed: that name is the server event for an existing open ride, and the relay drops it
  }
}
document.addEventListener('visibilitychange', () => { if (document.hidden) setPaused(true, 'visibility'); });
