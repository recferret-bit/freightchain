import { HOLE_REF_SPEED } from './road.js';
import { SIMULATION_CONFIG } from './simulation-config.js';

/* Shared truck longitudinal physics constants and 10 Hz substepped integrator used by both client/ and server/. */

export const REPLAY_SIM_HZ = 10;
export const REPLAY_PHYSICS_SUBSTEPS = 2;
export const EVENT_APPLY_GRACE_MS = 25000;

export const GEAR_RATIOS = [0, 6.15, 4.33, 3.05, 2.15, 1.51, 1.065, 0.75];
export const RATIOS = GEAR_RATIOS;
export const REV_RATIO = 3.8;
export const REDLINE = 2800;
export const TRUCK_MASS = 2.5;
export const TRUCK_POWER = 2.4;
export const TRUCK_GEAR_EXP = 0.4;
export const TRUCK_ROLL_RES = 0.18;
export const TRUCK_DRAG = 0.0013;
export const TRUCK_BRAKE = 5.5;
export const OFFROAD_DRAG = 1.2;

/** The game's longitudinal force calculation. State is read only; engine RPM/temperature and controls are advanced by the caller. */
export function longitudinalForces(st, cfg, powerFactor, brakeEfficiency, offroad) {
  const T = cfg.TRUCK, g = st.gear, ratio = g < 0 ? REV_RATIO : RATIOS[g], c = 1 - st.clutch, gas = st.gas;
  const overrev = st.engineOn && g !== 0 && c > .3 && st.rpm > 2900;
  let drive = 0;
  if (g !== 0 && c > .05) {
    if (st.engineOn) {
      const rp = st.rpm, w = rp < cfg.TORQUE_PEAK ? cfg.TORQUE_LOW_W : cfg.TORQUE_HIGH_W;
      let tq = Math.max(cfg.TORQUE_MIN, 1 - Math.pow((rp - cfg.TORQUE_PEAK) / w, 2)); if (rp > REDLINE) tq = 0;
      drive += T.POWER / T.MASS * tq * gas * Math.pow(RATIOS[1], .4) * Math.pow(ratio / RATIOS[1], T.GEAR_EXP) * c * powerFactor;
      drive -= (gas < .05 ? .85 : .15) / T.MASS * Math.pow(ratio, .4) * c * (rp / 2000);
      if (overrev) drive -= (rp - REDLINE) / 60;
    } else drive -= 1.6 / T.MASS * Math.pow(ratio, .4) * c;
  }
  let acceleration = (g < 0) === st.rev ? drive : -Math.abs(drive);
  if (st.v > .01) acceleration -= T.DRAG / T.MASS * st.v * st.v + T.ROLL_RES;
  acceleration -= st.brake * T.BRAKE * brakeEfficiency * (st.engineOn ? 1 : 0);
  if (st.park) acceleration -= cfg.PARK_BRAKE * brakeEfficiency;
  if (offroad && st.v > 2) acceleration -= cfg.OFFROAD_DRAG;
  return { acceleration, drive, overrev };
}

/** Integrates the actual force law while the supplied engine/control state stays fixed. */
export function integrateLongitudinal(state, config, powerFactor, brakeEfficiency, offroad, dt, substeps = REPLAY_PHYSICS_SUBSTEPS) {
  const n = Math.max(1, Math.ceil(substeps)), h = dt / n;
  let v = state.v;
  for (let i = 0; i < n; i++) {
    const { acceleration } = longitudinalForces({ ...state, v }, config, powerFactor, brakeEfficiency, offroad);
    v = Math.max(0, Math.min(state.rev ? config.REVERSE_MAX : config.MAX_SPEED, v + acceleration * h));
  }
  return v;
}

/** Legacy callers supply only pedals and gear. Peak torque is an estimate, not reconstructed engine state.
 * The independent upper bound allows the best gear/torque and ignores braking; it is only an acceleration ceiling. */
export function stepTruckPhysics(v0, gas, brake, gear, offroad, dt, substeps = REPLAY_PHYSICS_SUBSTEPS) {
  const state = { v: v0, gas: Math.max(0, Math.min(1, gas)), brake: Math.max(0, Math.min(1, brake)), gear: Math.max(-1, Math.min(7, Math.round(gear))), rpm: 2000, clutch: 0, engineOn: true, park: false, rev: gear < 0 };
  const vSim = integrateLongitudinal(state, SIMULATION_CONFIG, 1, .25, offroad, dt, substeps);
  const maxThrust = TRUCK_POWER / TRUCK_MASS * Math.pow(RATIOS[1], .4);
  const vMaxPossible = Math.min(HOLE_REF_SPEED * 1.05, v0 + maxThrust * dt) + .35;
  return { vSim, vMaxPossible };
}
export const stepLongitudinalPhysics = stepTruckPhysics;
