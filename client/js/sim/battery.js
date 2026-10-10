import { CFG } from '../config.js';
import { guide } from '../guide.js';
import { clamp } from '../util.js';
import { st, dn, powered, REDLINE } from '../state.js';
import { radio } from './radio.js';
import { toast } from '../ui/toast.js';
import { audio } from './audio.js';

/* Battery (st.batt 0..1, the BAT lamp + VOLT gauge). Drained by the headlights, cab lamp, heater blower, radio, the key-on instruments and the starter;
   the alternator refills it while the engine runs (more at higher revs, tapering off as it fills). With the engine OFF every consumer drains OFF_X× faster (nothing recharges it);
   with no lights / heater / radio (key ON or OFF) it slowly heals up to REST_MAX, so a flat battery is never a dead end: flat (≤ DEAD) cuts every consumer, then it recovers until the starter can crank again. */
/* the cab light works whenever the electrics are on – key ON with the engine off, cranking or running (its switch is the dome lamp / the CAB button / C) */
export const cabAllowed = () => powered();
export function toggleCab() {
  if (!dn.cab && !cabAllowed()) { toast('Cab light needs the key on – turn it to ON first', 1800); return; }
  dn.cab = !dn.cab; audio.play(dn.cab ? 'switch' : 'switch-off'); toast(dn.cab ? 'Cab light on' : 'Cab light off', 1000);
}
export function updateBattery(dt) {
  if (!cabAllowed()) dn.cab = false;   // key off: the lamp goes out with it
  const cranking = st.ign && st.ign.t >= 1.0, B = CFG.BATT;
  let drain = 0, loads = 0;
  const flatten = st.engineOn ? 1 : B.OFF_X;   // engine off: the battery is all there is
  if (dn.head) drain += B.HEAD;
  if (dn.cab) drain += B.CAB;
  if (powered()) {
    if (!st.engineOn) drain += B.KEY_ON;   // instruments + ECU with the engine off
    if (st.heater) drain += B.HEATER;
    if (radio.on) drain += B.RADIO;
  }
  loads = drain - (powered() && !st.engineOn ? B.KEY_ON : 0);   // anything beyond the bare instruments blocks the recovery
  drain *= flatten;
  if (cranking) drain += B.STARTER;
  if (guide.assist) drain *= CFG.ASSIST.BATT_DRAIN;   // assist mode: the battery lasts twice as long
  let charge = 0;
  if (st.engineOn) charge = (B.CHARGE_MIN + B.CHARGE_RPM * clamp(st.rpm / REDLINE, 0, 1)) * clamp((1 - st.batt) * 4, .15, 1);
  if (!st.engineOn && !cranking && loads === 0 && st.batt < B.REST_MAX) charge = B.REST;   // nothing but the instruments on: the battery recovers a little (up to REST_MAX)
  const was = st.batt;
  st.batt = clamp(st.batt + (charge - drain) * dt, 0, 1);
  if (!st.engineOn && !cranking && was >= B.CRITICAL && st.batt < B.CRITICAL) audio.play('alarm'), toast('BATTERY CRITICAL – switch everything off to let it recover, or start the engine', 4500);
  if (was >= B.LOW && st.batt < B.LOW) audio.play('warn'), toast(st.engineOn ? 'Battery low – too many consumers for these revs' : 'Battery low – switch things off or start the engine to recharge', 3500);
  if (st.batt < B.DEAD) {   // flat: everything electric cuts out until the engine has put some charge back
    if (!st.battDead) { st.battDead = true; audio.play('alarm'); toast('BATTERY DEAD – lights, radio and heater are out' + (st.engineOn ? '' : ', the engine will not start'), 4000); }
  } else if (st.battDead && st.batt > B.DEAD * 3) st.battDead = false;
  if (st.battDead) { dn.head = false; dn.cab = false; st.heater = false; if (radio.on) radio.toggle(); }
}
