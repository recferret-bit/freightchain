import { HOLE_REF_SPEED } from './road.js';

/* Shared truck longitudinal physics constants and 10 Hz substepped integrator used by both client/ and server/. */

export const REPLAY_SIM_HZ = 10;
export const REPLAY_PHYSICS_SUBSTEPS = 2;
export const EVENT_APPLY_GRACE_MS = 25000;

export const GEAR_RATIOS = [0, 6.15, 4.33, 3.05, 2.15, 1.51, 1.065, 0.75];
export const RATIOS = GEAR_RATIOS;
export const TRUCK_MASS = 2.5;
export const TRUCK_POWER = 2.4;
export const TRUCK_GEAR_EXP = 0.4;
export const TRUCK_ROLL_RES = 0.18;
export const TRUCK_DRAG = 0.0013;
export const TRUCK_BRAKE = 5.5;
export const OFFROAD_DRAG = 1.2;

/** Advances the truck's longitudinal speed over `dt` using `substeps` (default 2 × 0.05 s at 10 Hz) to compute both simulated speed and upper bound. */
export function stepTruckPhysics(v0, gas, brake, gear, offroad, dt, substeps = REPLAY_PHYSICS_SUBSTEPS) {
  const h = dt / Math.max(1, substeps);
  const ratio = GEAR_RATIOS[Math.max(1, Math.min(7, Math.round(gear || 5)))] ?? 1.51;
  const maxRatio = Math.max(ratio, 4.33);
  let vSim = v0;
  let vMax = v0;
  for (let s = 0; s < substeps; s++) {
    const thrustSim = gas > 0.01 ? (TRUCK_POWER / TRUCK_MASS) * Math.pow(ratio, TRUCK_GEAR_EXP) * Math.min(1, gas) : 0;
    const dragSim = TRUCK_ROLL_RES + (TRUCK_DRAG / TRUCK_MASS) * vSim * vSim + (offroad ? OFFROAD_DRAG : 0) + Math.min(1, Math.max(0, brake)) * TRUCK_BRAKE;
    vSim = Math.max(0, Math.min(HOLE_REF_SPEED, vSim + (thrustSim - dragSim) * h));

    const thrustMax = (TRUCK_POWER / TRUCK_MASS) * Math.pow(maxRatio, TRUCK_GEAR_EXP) * Math.max(0.15, Math.min(1, gas));
    const dragMin = TRUCK_ROLL_RES * 0.5 + (TRUCK_DRAG / TRUCK_MASS) * vMax * vMax * 0.5;
    vMax = Math.max(0, Math.min(HOLE_REF_SPEED * 1.05, vMax + (thrustMax - dragMin) * h));
  }
  return { vSim, vMaxPossible: vMax + 0.35 };
}
export const stepLongitudinalPhysics = stepTruckPhysics;
