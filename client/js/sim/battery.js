import { CFG } from '../config.js';
import { clamp } from '../util.js';
import { st, dn, powered, REDLINE } from '../state.js';
import { radio } from './radio.js';
import { toast } from '../ui/toast.js';

/* Battery (st.batt 0..1, the BAT lamp + VOLT gauge). Drained by the headlights, cab lamp, heater blower, radio, the key-on instruments and the starter;
   the alternator refills it while the engine runs (more at higher revs, tapering off as it fills). Dead = lights, radio and heater cut out and the engine can't be started. */
/* the cab light only works with the engine running or starting (its switch is the dome lamp / C) */
export const cabAllowed = () => st.engineOn || !!st.ign;
export function toggleCab() {
  if (!dn.cab && !cabAllowed()) { toast('Cab light needs the engine running – start it first', 1800); return; }
  dn.cab = !dn.cab; toast(dn.cab ? 'Cab light on' : 'Cab light off', 1000);
}
export function updateBattery(dt) {
  if (!cabAllowed()) dn.cab = false;   // engine stopped / stalled / key off: the lamp goes out with it
  const cranking = st.ign && st.ign.t >= 1.0, B = CFG.BATT;
  let drain = 0;
  if (dn.head) drain += B.HEAD;
  if (dn.cab) drain += B.CAB;
  if (powered()) {
    if (!st.engineOn) drain += B.KEY_ON;   // instruments + ECU with the engine off
    if (st.heater) drain += B.HEATER;
    if (radio.on) drain += B.RADIO;
  }
  if (cranking) drain += B.STARTER;
  let charge = 0;
  if (st.engineOn) charge = (B.CHARGE_MIN + B.CHARGE_RPM * clamp(st.rpm / REDLINE, 0, 1)) * clamp((1 - st.batt) * 4, .15, 1);
  const was = st.batt;
  st.batt = clamp(st.batt + (charge - drain) * dt, 0, 1);
  if (was >= B.LOW && st.batt < B.LOW) toast(st.engineOn ? 'Battery low – too many consumers for these revs' : 'Battery low – switch things off or start the engine to recharge', 3500);
  if (st.batt < B.DEAD) {   // flat: everything electric cuts out until the engine has put some charge back
    if (!st.battDead) { st.battDead = true; toast('BATTERY DEAD – lights, radio and heater are out' + (st.engineOn ? '' : ', the engine will not start'), 4000); }
  } else if (st.battDead && st.batt > B.DEAD * 3) st.battDead = false;
  if (st.battDead) { dn.head = false; dn.cab = false; st.heater = false; if (radio.on) radio.toggle(); }
}
