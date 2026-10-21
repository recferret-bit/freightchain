import { CFG } from '../config.js';
import { clamp, approach } from '../util.js';
import { RATIOS, MAX_GEAR, REV_RATIO, K_RPM, IDLE, REDLINE, STALL_RPM, st, coldK, driveHull } from '../state.js';
import { toast } from '../ui/toast.js';
import { SHAKE_START } from './shake.js';
import { audio } from './audio.js';

/* Engine, ignition state machine, manual gearbox, and parking brake service.
   States:
   - OFF:       key OFF, engine off
   - ACC_ON:    key ON (accessory power + bulb check), engine off, not cranking
   - PRE_CRANK: ignition sequence 0..1 s (gauge sweep + bulb check before starter engages)
   - CRANKING:  starter motor cranking (1..2 s manual / 1..2.3 s auto)
   - RUNNING:   engine running (idle..redline, clutch slip, lugging, stall check) */

const LUG_RPM = 900;   // below this (gear in, clutch out) the engine labours

export const ENGINE_STATES = Object.freeze({
  OFF: 'off',
  ACC_ON: 'acc_on',
  PRE_CRANK: 'pre_crank',
  CRANKING: 'cranking',
  RUNNING: 'running',
});

export function engineStateOf(s = st) {
  if (s.engineOn) return ENGINE_STATES.RUNNING;
  if (s.ign) return s.ign.t < 1.0 ? ENGINE_STATES.PRE_CRANK : ENGINE_STATES.CRANKING;
  return s.keyOn ? ENGINE_STATES.ACC_ON : ENGINE_STATES.OFF;
}

export function tryShift(to) {
  if (st.mode !== 'drive' || to < -1 || to > MAX_GEAR || to === st.gear) return;
  if (st.clutch < 0.8) { st.grind = 0.5; st.jolt = 1; audio.play('grind'); toast('⚠ GRIND! Hold the clutch (SHIFT) to change gear'); return; }
  if (to !== 0 && st.v > .8 && (to < 0) !== st.rev) { st.grind = 0.5; st.jolt = 1; audio.play('grind'); toast('⚠ GRIND! Stop before changing between forward and reverse'); return; }
  if (st.shiftT > 0) return;   // still moving the lever
  if (to !== 0) st.shiftT = CFG.TRUCK.SHIFT_TIME;
  audio.play('shift', to === 0 ? .6 : 1, to === 0 ? .85 : 1);
  st.gear = to;
}

export function ignition(manual = false) {   // manual = key held with the mouse: cranks only while held (~1 s), release aborts
  if (st.mode !== 'drive' || st.engineOn || st.ign) return;
  if (st.batt < CFG.BATT.START_MIN) { st.keyDeny = 1; toast('Battery too flat to crank – switch lights, heater, cooler and radio off and wait: it recovers by itself', 4000); return; }
  if (st.gear !== 0 && st.clutch < 0.8) { st.keyDeny = 1; toast('Press the clutch (SHIFT) or select neutral to start'); return; }
  audio.play('key'); st.ign = { t: manual ? (st.keyOn ? 1.0 : .6) : 0, manual }; st.keyOn = true; st.test = 1; st.rpm = 0; st.stalled = false; st.shiftT = 0; st.stall = 0;   // 0-1 s key-on gauge sweep + bulb check, 1-2.3 s starter cranking, then the engine catches
}

export function keySwitch(on) {   // OFF / ON zones of the ignition (the engine, if running, is switched off by OFF)
  if (st.mode !== 'drive' || st.ign) return;
  if (!on && st.engineOn) { engineOff(); return; }
  if (on && !st.keyOn) { st.test = 0; audio.play('key'); }   // gauge sweep + bulb check
  st.keyOn = on; if (!on) st.stalled = false;
}

export function releaseKey() {
  if (!st.ign || !st.ign.manual) return;
  st.ign = null; toast('Hold the key in START until the engine catches', 1800);
}

export function engineOff() {
  if (st.mode !== 'drive' || !st.engineOn) return;
  st.engineOn = false; st.keyOn = false; st.stallT = 0; st.lug = 0; st.jolt = Math.max(st.jolt, SHAKE_START); st.rumble = Math.max(st.rumble, .6);   // key off: shut-off shudder, no STALL banner
  audio.play('engine-off'); toast('Engine off', 1200);
}

/* parking brake (B key / PARK button on the dash) */
export function toggleParkingBrake() { st.park = !st.park; audio.play(st.park ? 'park' : 'park-off'); toast(st.park ? 'Parking brake ON' : 'Parking brake released', 1200); }

/* Step the ignition/engine/clutch state machine by `dt` seconds and return `{ g, c, gas, pw }` for longitudinal dynamics. */
export function stepEngine(dt) {
  const T = CFG.TRUCK, g = st.gear, ratio = g < 0 ? REV_RATIO : RATIOS[g], c = 1 - st.clutch, wheelRpm = st.v * ratio * K_RPM;
  if (st.v < .05 && g !== 0) st.rev = g < 0;   // at a standstill the selected gear picks the direction of travel (st.v is the speed, st.vel its signed value)
  const gas = st.gas, pw = (0.4 + 0.6 * driveHull() / 100) * (1 - CFG.COLD_POWER * coldK());   // bodywork restores pull; recorded hull stays put
  // clutch slip: until the clutch has locked up (wheels caught up with the engine) the engine isn't dragged down to wheel speed but holds revs set by the gas
  // (less in tall gears, none while braking) – a gas-on launch pulls away; no gas, 6th/7th or the brake still stalls. Pressing the clutch / neutral re-arms it.
  if (g === 0 || st.clutch > .5) st.slip = true;
  const hold = STALL_RPM * .8 + T.LAUNCH_RPM * gas * (1 - st.brake) * pw * Math.min(1, (ratio / RATIOS[2]) ** 2.5);
  if (st.slip && c > .95 && wheelRpm >= hold) st.slip = false;
  if (st.ign) {
    st.ign.t += dt; const it = st.ign.t;
    if (it < 1.0) st.rpm = 0;
    else if (it < (st.ign.manual ? 2.0 : 2.3)) st.rpm = 150 + 80 * Math.sin(it * 26) + (it - 1) * 90;   // lumpy starter cranking
    else { st.ign = null; st.engineOn = true; st.rpm = 260; st.freeRpm = 1600; st.stallT = 0; st.rumble = 1; st.jolt = Math.max(st.jolt, .6 * SHAKE_START); toast('Engine running', 1200); }
  }
  if (st.engineOn) {
    // clutch in while rolling in a gear (a shift): the throttle is cut, so the revs fall away from where they were instead of flaring to the redline
    const free = IDLE + (g !== 0 && c < .5 && st.v > 1.5 ? 0 : gas) * (REDLINE - IDLE);
    st.freeRpm += (free - st.freeRpm) * Math.min(1, dt * (free > st.freeRpm ? 4 : 2.5));
    const target = (g === 0 || c < 0.02) ? st.freeRpm : st.freeRpm * (1 - c) + (st.slip ? Math.max(wheelRpm, hold) : wheelRpm) * c;
    st.rpm += (target - st.rpm) * Math.min(1, dt * 18);
    if (g !== 0 && c > .9) st.freeRpm = st.rpm;   // clutch engaged: the unloaded-engine state IS the engine speed, so pressing the clutch continues from there (it used to jump to the throttle target)
    if (st.noStall > 0) st.noStall -= dt;
    if (g !== 0 && c > 0.55 && st.rpm < STALL_RPM && !(st.noStall > 0)) st.stallT += dt; else st.stallT = 0;
    // lugging: revs sag towards the stall point with a gear in and the clutch out -> the whole cab shudders and the STALL lamp blinks (shake scales with SHAKE_START)
    st.lug = g !== 0 && c > 0.3 ? clamp((LUG_RPM - st.rpm) / (LUG_RPM - STALL_RPM), 0, 1) * Math.min(1, c * 1.5) : 0;
    if (st.lug > 0) { st.rumble = Math.max(st.rumble, st.lug * .6); st.jolt = Math.max(st.jolt, st.lug * SHAKE_START * .7 * (.5 + .5 * Math.sin(st.t * 30))); }
    if (st.stallT > 0.12) {   // the engine dies: violent kick + shutdown shudder, thump sound, flashing STALL lamp + banner
      st.engineOn = false; st.stallT = 0; st.lug = 0; st.stall = 1; st.stalled = true; st.jolt = SHAKE_START * 2; st.rumble = 1; audio.stall();
      toast('ENGINE STALLED – clutch in (SHIFT) and press I to start', 3500);
    }
  } else { st.lug = 0; if (!st.ign) st.rpm = approach(st.rpm, 0, 2500, dt); }
  return { g, c, gas, pw };
}
