import { CFG } from '../config.js';
import { clamp, approach } from '../util.js';
import { RATIOS, MAX_GEAR, REV_RATIO, K_RPM, IDLE, REDLINE, STALL_RPM, st, input, coldK, brakeEff } from '../state.js';
import { curv, roadAt } from '../road.js';
import { net } from '../net/network.js';
import { toast } from '../ui/toast.js';
import { collide, hitHoles } from './damage.js';
import { updateTraffic } from './traffic.js';
import { SHAKE_START } from './shake.js';
import { audio } from './audio.js';
import { updateClimate } from './climate.js';
import { updateBattery } from './battery.js';
import { endRide } from '../ui/game.js';

let beepT = 0;
const LUG_RPM = 900;   // below this (gear in, clutch out) the engine labours
/* Drivetrain (clutch / gears / stall / ignition sequence), steering and ride end conditions. */

/* steering authority (rad per metre at full lock): STEER_GAIN at speed, rising to STEER_GAIN_LOW at walking pace so the junction turn out of the depot works */
/* Thrust ∝ torque(rpm) · (ratio / 1st)^GEAR_EXP, scaled so 1st gear's thrust never changes with GEAR_EXP (starting off stays as tuned): a bigger exponent only weakens the taller gears.
   Engine braking keeps a fixed exponent. */
const ENGINE_BRAKE_EXP = .4, THRUST_REF = Math.pow(RATIOS[1], ENGINE_BRAKE_EXP);
function steerGain() { const T = CFG.TRUCK; return T.STEER_GAIN + ((T.STEER_GAIN_LOW ?? T.STEER_GAIN) - T.STEER_GAIN) * clamp(1 - st.v / (T.STEER_LOW_V || 1), 0, 1); }
export function tryShift(to) {
  if (st.mode !== 'drive' || to < -1 || to > MAX_GEAR || to === st.gear) return;
  if (st.clutch < 0.8) { st.grind = 0.5; st.jolt = 1; toast('⚠ GRIND! Hold the clutch (SHIFT) to change gear'); return; }
  if (to !== 0 && st.v > .8 && (to < 0) !== st.rev) { st.grind = 0.5; st.jolt = 1; toast('⚠ GRIND! Stop before changing between forward and reverse'); return; }
  if (st.shiftT > 0) return;   // still moving the lever
  if (to !== 0) st.shiftT = CFG.TRUCK.SHIFT_TIME;
  st.gear = to;
}
export function ignition(manual = false) {   // manual = key held with the mouse: cranks only while held (~1 s), release aborts
  if (st.mode !== 'drive' || st.engineOn || st.ign) return;
  if (st.batt < CFG.BATT.START_MIN) { st.keyDeny = 1; toast('Battery too flat to crank the engine', 2500); return; }
  if (st.gear !== 0 && st.clutch < 0.8) { st.keyDeny = 1; toast('Press the clutch (SHIFT) or select neutral to start'); return; }
  st.ign = { t: manual ? (st.keyOn ? 1.0 : .6) : 0, manual }; st.keyOn = true; st.test = 1; st.rpm = 0; st.stalled = false; st.shiftT = 0; st.stall = 0;   // 0-1 s key-on gauge sweep + bulb check, 1-2.3 s starter cranking, then the engine catches
}
export function keySwitch(on) {   // OFF / ON zones of the ignition (the engine, if running, is switched off by OFF)
  if (st.mode !== 'drive' || st.ign) return;
  if (!on && st.engineOn) { engineOff(); return; }
  if (on && !st.keyOn) st.test = 0;   // gauge sweep + bulb check
  st.keyOn = on; if (!on) st.stalled = false;
}
export function releaseKey() {
  if (!st.ign || !st.ign.manual) return;
  st.ign = null; toast('Hold the key in START until the engine catches', 1800);
}
export function engineOff() {
  if (st.mode !== 'drive' || !st.engineOn) return;
  st.engineOn = false; st.keyOn = false; st.stallT = 0; st.lug = 0; st.jolt = Math.max(st.jolt, SHAKE_START); st.rumble = Math.max(st.rumble, .6);   // key off: shut-off shudder, no STALL banner
  toast('Engine off', 1200);
}

export function update(dt) {
  if (st.t === 0) { st.stalled = false; st.stall = 0; st.lug = 0; st.ste = st.pitch = st.roll = st.pitchV = st.rollV = 0; }   // first step of a ride (resetRide zeroes st.t)
  st.t += dt; st.stall = Math.max(0, st.stall - dt * .7);
  // pedals / steering
  st.shiftT = Math.max(0, (st.shiftT || 0) - dt);
  st.clutch = approach(st.clutch, input.clutch ? 1 : 0, input.clutch ? 7 : 1.7, dt);
  if (st.shiftT > 0) st.clutch = Math.max(st.clutch, .9);   // the lever is still moving: the clutch stays in (even if the key is released), so engagement afterwards is gradual, not a stall
  st.gas = approach(st.gas, input.gas ? 1 : 0, input.gas ? 3.5 : 5, dt);
  st.brake = approach(st.brake, input.brake ? 1 : 0, 6, dt);
  const tgt = input.right - input.left, T = CFG.TRUCK;
  st.steer = approach(st.steer, tgt, tgt ? T.STEER_RATE : T.STEER_RETURN, dt);
  st.keyDeny = Math.max(0, (st.keyDeny || 0) - dt * 2.5); st.grind = Math.max(0, st.grind - dt); st.jolt = Math.max(0, st.jolt - dt * 2.5); st.rumble = Math.max(0, st.rumble - dt * .7); st.crash = Math.max(0, st.crash - dt * 2.2); st.flash = Math.max(0, st.flash - dt * 1.6);
  st.washing = !!input.wash && st.wash > .02; st.wash = clamp(st.wash + (st.washing ? -.15 : .02) * dt, 0, 1);   // washer-fluid tank

  // engine
  const g = st.gear, ratio = g < 0 ? REV_RATIO : RATIOS[g], c = 1 - st.clutch, wheelRpm = st.v * ratio * K_RPM;
  if (st.v < .05 && g !== 0) st.rev = g < 0;   // at a standstill the selected gear picks the direction of travel (st.v is the speed, st.vel its signed value)
  const gas = st.gas, pw = (0.4 + 0.6 * st.hull / 100) * (1 - CFG.COLD_POWER * coldK());   // damaged or cold engine = less power
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

  // longitudinal
  const vel0 = st.vel;
  let a = 0, aG = 0;   // aG = acceleration along the selected gear's direction
  st.overrev = st.engineOn && g !== 0 && c > 0.3 && st.rpm > REDLINE + 100;
  if (g !== 0 && c > 0.05) {
    if (st.engineOn) {
      const rp = st.rpm;
      const w = rp < CFG.TORQUE_PEAK ? CFG.TORQUE_LOW_W : CFG.TORQUE_HIGH_W;
      let tq = Math.max(CFG.TORQUE_MIN, 1 - Math.pow((rp - CFG.TORQUE_PEAK) / w, 2)); if (rp > REDLINE) tq = 0;
      aG += T.POWER / T.MASS * tq * gas * THRUST_REF * Math.pow(ratio / RATIOS[1], T.GEAR_EXP) * c * pw;
      aG -= (gas < 0.05 ? 0.85 : 0.15) / T.MASS * Math.pow(ratio, ENGINE_BRAKE_EXP) * c * (rp / 2000);                // engine braking
      if (st.overrev) aG -= (rp - REDLINE) / 60;
    } else aG -= 1.6 / T.MASS * Math.pow(ratio, ENGINE_BRAKE_EXP) * c;                                                 // dead engine drags
  }
  // driving against a held brake: gear in, clutch out, gas on, engine pushing (aG) but the truck is pinned (parking brake or pedal)
  st.fight = st.engineOn && g !== 0 && c > .3 && gas > .05 && st.v < 1 && (st.park || st.brake > .5) && aG > .3;
  a += (g < 0) === st.rev ? aG : -Math.abs(aG);   // a gear that opposes the current motion only slows the truck
  if (st.v > 0.01) a -= T.DRAG / T.MASS * st.v * st.v + T.ROLL_RES;
  a -= st.brake * T.BRAKE * brakeEff() * (st.engineOn ? 1 : 0);   // overheated brakes fade; with the engine off there is no brake pressure at all (only the parking brake works)
  if (st.park) a -= CFG.PARK_BRAKE * brakeEff();   // hot brakes fade, the parking brake too (fighting it heats it up – climate.js)   // spring brake: always on until released, holds the truck against engine thrust too
  if (st.brake > .3 && !st.engineOn && st.v > .5 && !st._noBrakeWarned) { st._noBrakeWarned = true; toast('NO BRAKES – engine off! Pull the parking brake (B)', 3000); } if (st.engineOn || st.v < .1) st._noBrakeWarned = false;
  const off = st.off = !net.onRoad(st.s, st.d);   // lanes, junction aprons, side roads, the depot yard (net/network.js)
  if (off && st.v > 2) a -= CFG.OFFROAD_DRAG;
  st.v = clamp(st.v + a * dt, 0, st.rev ? CFG.REVERSE_MAX : CFG.MAX_SPEED); st.vel = st.rev ? -st.v : st.v;
  if (st.gear < 0 && st.v > .1) { if ((beepT -= dt) <= 0) { beepT = .9; audio.beep(); } } else beepT = 0;   // reverse beeper

  // air tank (compressor runs with the engine), coolant, trailer articulation
  if (st.engineOn) st.air = Math.min(.9, st.air + dt * .06);   // engine off: air pressure stays frozen (the gauge doesn't drift)
  updateClimate(dt); updateBattery(dt);   // engine temperature (cools towards ambient when off), heater, cold-engine wear
  trailerYaw(dt);

  // lateral (road frame: s along the centre-line, d across; ds/dt = v·cosψ / (1 − k·d), so the inside of a tight junction turn is shorter)
  const k = curv(st.s), gain = steerGain();
  st.ste += (st.steer - st.ste) * (T.YAW_LAG > 0 ? Math.min(1, dt / T.YAW_LAG) : 1);   // heavy truck: heading answers the wheel late
  const ds = st.vel * Math.cos(st.psi) / Math.max(.3, 1 - k * st.d) * dt;
  st.psi += st.vel * (st.ste * gain + st.pull * (1 - st.hull / 100) * 0.003) * dt - k * ds;   // damaged steering pulls to one side
  const windK = Math.min(1, st.v / 6);   // wind/drift only act on a moving truck
  st.d += (st.vel * Math.sin(st.psi) - st.v * st.v * k * T.CENTRIF + (0.12 + Math.sin(st.t / 6) * 0.08) * windK) * dt;   // centrifugal drift + steady side-wind
  st.s += ds;
  if (st.s < 0) { st.s = 0; st.v = st.vel = 0; toast('Loading dock – no further back'); }
  st.offT = off ? st.offT + dt : Math.max(0, st.offT - dt * 2);
  if (off && !st._offWarned) { toast('OFF ROAD!'); st._offWarned = true; } if (!off) st._offWarned = false;
  if (!st.complete && st.t >= CFG.RIDE_MIN_SECONDS && st.s >= CFG.COMPLETE_DIST) { st.complete = true; toast('SHIFT COMPLETE – the road goes on. Keep driving, or P → END SHIFT to collect.', 6000); }

  bodySway(dt, vel0, gain);

  collide(dt); hitHoles(dt);
  const fatal = updateTraffic(dt);   // other vehicles; a direct hit returns the reason the ride is over

  // windshield bugs
  st.bugT -= dt;
  if (st.bugT <= 0) { st.bugT = 15 + Math.random() * 25; if (st.v > 5 && st.bugs.length < 5) st.bugs.push({ n: Math.random() * 1e4, sm: 0, x: .12 + Math.random() * .76, y: .1 + Math.random() * .8, r: .004 + Math.random() * .008, c: Math.random() < .5 ? '#8a9a3a' : '#d8cf6a', a: Math.random() * 6 }); }

  // end conditions
  if (fatal) endRide(false, fatal);
  else if (st.hull <= 0) endRide(false, st.blown ? (st.blownWhy === 'brakes' ? 'The drivetrain gave out – you drove against the brakes for too long.' : 'The engine blew – it was held at max revs for too long.') : st.coldT > 0 ? 'The engine gave out – you pushed it hard while it was still cold.' : 'Your truck was wrecked – the hull gave out.');
  else if (st.offT > CFG.OFFROAD_FAIL_SECONDS || Math.abs(st.d) > 80) endRide(false, 'You spent too long off the road – the truck is stuck in the sand.');
}

/* body sway: spring-damper driven by longitudinal accel (brake dives, throttle squats) and cornering. The ACTUAL change of velocity, not the net force `a`:
   a stationary truck held by the brake / a dead engine feels a force but doesn't accelerate, so the cab must not dive (and flip when R is selected).
   Also run by a replay (watch.js) on the recorded speed, so a spectator's cab moves like the driver's. */
export function bodySway(dt, vel0, gain = steerGain()) {
  const T = CFG.TRUCK, w = 2 * Math.PI * T.SWAY_HZ, z = T.SWAY_DAMP, ax = (st.vel - vel0) / Math.max(dt, 1e-3), ay = st.vel * st.vel * st.ste * gain;
  st.pitchV += (-w * w * (st.pitch - clamp(ax, -10, 6) * T.PITCH_GAIN) - 2 * z * w * st.pitchV) * dt; st.pitch += st.pitchV * dt;
  st.rollV += (-w * w * (st.roll - clamp(ay, -8, 8) * T.ROLL_GAIN) - 2 * z * w * st.rollV) * dt; st.roll += st.rollV * dt;
}
/* trailer articulation from the truck's heading; reversing makes the trailer swing out (jackknife, limited) */
export function trailerYaw(dt) { const hd = roadAt(st.s).t + st.psi; st.tyaw = clamp(st.tyaw + st.vel / 8 * Math.sin(hd - st.tyaw) * dt, hd - 1.2, hd + 1.2); }

/* parking brake (B key / PARK button on the dash) */
export function toggleParkingBrake() { st.park = !st.park; toast(st.park ? 'Parking brake ON' : 'Parking brake released', 1200); }
