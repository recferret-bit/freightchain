import { CFG } from '../config.js';
import { longitudinalForces } from '../../shared/physics.js';
import { clamp, approach } from '../util.js';
import { st, input, brakeEff } from '../state.js';
import { curv, roadAt } from '../road.js';
import { net } from '../net/network.js';
import { toast } from '../ui/toast.js';
import { collide, hitHoles } from './damage.js';
import { updateTraffic } from './traffic.js';
import { audio } from './audio.js';
import { updateClimate } from './climate.js';
import { updateBattery } from './battery.js';
import { endRide } from '../ui/game.js';
import { trip } from '../trips.js';
import { guide } from '../guide.js';
import { ENGINE_STATES, engineStateOf, tryShift, ignition, keySwitch, releaseKey, engineOff, toggleParkingBrake, stepEngine } from './engine.js';

export { ENGINE_STATES, engineStateOf, tryShift, ignition, keySwitch, releaseKey, engineOff, toggleParkingBrake, stepEngine };

let beepT = 0, washT = 0;
/* Longitudinal & lateral vehicle dynamics, steering, body sway, trailer articulation, and ride end conditions. */

/* steering authority (rad per metre at full lock): STEER_GAIN at speed, rising to STEER_GAIN_LOW at walking pace so the junction turn out of the depot works */
/* Thrust ∝ torque(rpm) · (ratio / 1st)^GEAR_EXP, scaled so 1st gear's thrust never changes with GEAR_EXP (starting off stays as tuned): a bigger exponent only weakens the taller gears.
   Engine braking keeps a fixed exponent. */
function steerGain() { const T = CFG.TRUCK; return T.STEER_GAIN + ((T.STEER_GAIN_LOW ?? T.STEER_GAIN) - T.STEER_GAIN) * clamp(1 - st.v / (T.STEER_LOW_V || 1), 0, 1); }

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
  const wasWashing = st.washing; st.washing = !!input.wash && st.wash > .02; if (st.washing && (!wasWashing || (washT -= dt) <= 0)) { washT = .55; audio.play('washer'); } st.wash = clamp(st.wash - (st.washing ? CFG.WASH_DRAIN : 0) * dt, 0, 1);   // washer-fluid tank: finite (CFG.WASH_DRAIN: 100 s of spray per ride, no refill)

  // engine + drivetrain state machine
  const { g, c, gas, pw } = stepEngine(dt);

  // longitudinal
  const vel0 = st.vel;
  const off = st.off = !net.onRoad(st.s, st.d);
  const { acceleration: a, drive: aG, overrev } = longitudinalForces(st, CFG, pw, brakeEff(), off);
  st.overrev = overrev;
  // driving against a held brake: gear in, clutch out, gas on, engine pushing (aG) but the truck is pinned (parking brake or pedal)
  st.fight = st.engineOn && g !== 0 && c > .3 && gas > .05 && st.v < 1 && (st.park || st.brake > .5) && aG > .3;
  if (st.brake > .3 && !st.engineOn && st.v > .5 && !st._noBrakeWarned) { st._noBrakeWarned = true; toast('NO BRAKES – engine off! Pull the parking brake (B)', 3000); } if (st.engineOn || st.v < .1) st._noBrakeWarned = false;
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
  if (off && !st._offWarned) { audio.play('warn'); toast('OFF ROAD!'); st._offWarned = true; } if (!off) st._offWarned = false;
  if (trip.finish && !st.complete && st.s >= CFG.COMPLETE_DIST) guide.hold = false;   // a trip that ends at the line: an open tutorial is cut off there
  if (!st.complete && !guide.hold && st.s >= CFG.COMPLETE_DIST) {   // the line is the whole condition – no minimum time (the server's governor keeps the distance honest)
    st.complete = true; audio.play('complete');
    if (trip.finish) endRide(true);   // a trip that ends at the line (trips.js – the free run): the win stamp, no "keep driving"
    else toast('SHIFT COMPLETE – the road goes on. Keep driving, or leave from the top right (lobby or the front page).', 6000);
  }

  bodySway(dt, vel0, gain);

  const wall = collide(dt); hitHoles(dt);
  const fatal = wall || updateTraffic(dt);   // other vehicles; a direct hit returns the reason the ride is over

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
