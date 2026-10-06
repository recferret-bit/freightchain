import { CFG } from '../config.js';
import { Wallet } from '../wallet.js';
import { fmt } from '../util.js';
import { st, clock, IDLE, resetDisp, rideStart } from '../state.js';
import { audio } from '../sim/audio.js';
import { ambientC } from '../sim/climate.js';
import { clearDebris } from '../sim/damage.js';
import { toast } from './toast.js';
import { destroyed } from '../world/props.js';
import { roads } from '../net/orchestrator.js';
import { resetScreen } from '../cockpit/windscreen.js';
import { routesHTML, bindRoutes, timeHTML, bindTime } from './routes.js';

/* Ride flow: menu / start / end / pause overlay and per-ride reset. */

export function resetRide() {
  Object.assign(st, rideStart({ rpm: CFG.START_ENGINE_OFF ? 0 : IDLE, engineOn: !CFG.START_ENGINE_OFF, temp: ambientC(), pull: Math.random() < .5 ? -1 : 1 }));
  resetDisp(); destroyed.clear(); clearDebris(); roads.newTrip(); resetScreen();   // new road layout, depot, traffic
}

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
export function startRide() {
  if (!Wallet.charge(CFG.FARE)) return;
  resetRide(); st.mode = 'drive'; audio.start(); overlay.classList.add('hide');
  toast(CFG.START_ENGINE_OFF ? 'Press I to start the engine and B to release the parking brake, then SHIFT (clutch) → E (1st) → W (gas) → ease the clutch out' : 'Release the parking brake (B), then hold SHIFT (clutch) → E (1st gear) → W (gas) → ease the clutch out', 6000);
  setTimeout(() => { if (st.mode === 'drive' && st.s < 60) toast('Loaded. Drive slowly to the main road, stop at the line, turn RIGHT into a gap', 7000); }, 6500);
}
/* The road never ends: a ride ends by failing, or by the driver ending the shift (pause menu). It pays out only once the shift is complete
   (st.complete: RIDE_MIN_SECONDS driven AND CFG.COMPLETE_DIST covered, set in sim/physics.js). */
export function endRide(ok, reason) {
  if (st.mode !== 'drive' && st.mode !== 'paused') return;
  st.mode = 'done';
  if (ok) Wallet.credit(CFG.REWARD);
  showMenu(ok ? 'SHIFT COMPLETE' : 'RIDE FAILED', ok ? 'Freight on its way. Another one?' : 'Fare is non-refundable.',
    `<div class="row"><span>Result</span><b class="${ok ? 'good' : 'bad'}">${ok ? 'COMPLETE' : 'FAILED'}</b></div>
     <div class="row"><span>Time driven</span><b>${fmt(st.t)}</b></div>
     <div class="row"><span>Distance</span><b>${(st.s / 1000).toFixed(2)} km</b></div>
     ${st.reds ? `<div class="row"><span>Red lights run</span><b class="bad">${st.reds}</b></div>` : ''}
     ${ok ? `<div class="row"><span>Payout</span><b>${CFG.REWARD.toFixed(1)} FRT</b></div>` : `<div class="row"><span>Reason</span><span class="bad">${reason}</span></div>`}`);
}
const endShift = () => st.complete ? endRide(true) : endRide(false, `Shift abandoned before it was complete (${fmt(CFG.RIDE_MIN_SECONDS)} and ${(CFG.COMPLETE_DIST / 1000).toFixed(1)} km).`);
export function setPaused(p) {
  if (p && st.mode === 'drive') {
    st.mode = 'paused'; panel.innerHTML = `<h1>PAUSED</h1><h2>Time does not accrue while paused. The road never ends – end the shift here.</h2><div class="btns"><button id="resume">RESUME</button><button class="alt" id="endshift">${st.complete ? 'END SHIFT (complete)' : 'ABANDON SHIFT'}</button></div>`;
    overlay.classList.remove('hide'); document.getElementById('resume').onclick = () => setPaused(false); document.getElementById('endshift').onclick = endShift;
  }
  else if (!p && st.mode === 'paused') { st.mode = 'drive'; overlay.classList.add('hide'); clock.last = performance.now(); }
}
document.addEventListener('visibilitychange', () => { if (document.hidden) setPaused(true); });
