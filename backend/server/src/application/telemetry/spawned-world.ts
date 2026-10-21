import { roadPlanFor } from '../../domain/road/road-plan.js';
import { TrafficSimulator } from '../../domain/verdict/traffic-sim.js';

/** The chk window. Same objects the ride's road plan and traffic simulator already spawned. */
export const WORLD_DIGEST_WINDOW_M = 300;

/**
 * Ids of the holes, junctions, and cars the server spawned within ±300 m of `s`.
 * Built from `roadPlanFor(seed)` and `TrafficSimulator.forRide(seed)`, the same world the 10 Hz judge uses.
 * The salt text is not an id.
 */
export function spawnedWorldIds(seed: number, trip: string | null, s: number): string[] {
  const plan = roadPlanFor(seed, trip);
  const near = (at: number) => Math.abs(at - s) <= WORLD_DIGEST_WINDOW_M;
  const holes = plan.holesNear(s - WORLD_DIGEST_WINDOW_M, s + WORLD_DIGEST_WINDOW_M).map((hole) => hole.id);
  const junctions = plan.layout.describe(s + WORLD_DIGEST_WINDOW_M).junctions.filter((junction) => near(junction.s)).map((junction) => junction.id);
  const cars = TrafficSimulator.forRide(seed, trip).cars.filter((car) => near(car.s)).map((car) => `car-${car.id}`);
  return [...holes, ...junctions, ...cars];
}
