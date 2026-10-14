import { rollChunkHole } from '../shared/index.js';
import { RoadLayout } from './road-layout.js';
import { CHUNK_LEN, HOLE_CHANCE, HOLE_TYPES, HOLES_ON, ROAD_PLAN_MAX_S, holeFirstOf, tripRoadOf, type HoleType } from './road-rules.js';

/* The ride's OBSTACLE PLAN – the server's answer to "where were the holes on this ride's road?". Built with the shared rollChunkHole function
   (@freightchain/shared via ../shared/index.js) consumed directly by both client/js/net/obstacles.js and server/. */

export interface PlannedHole {
  /** 'h' + chunk index – the same id the game uses */
  id: string;
  ci: number;
  type: string;
  /** centre: s along the road, lat across it (+ = right) */
  s: number;
  lat: number;
}

/** the wire view of a stretch of the plan */
export interface RoadPlanDto {
  rideId: string;
  /** what the plan is a function of – the game checks it against the seed it was handed */
  seed: number;
  /** generator version: bumped whenever the generator changes, so a cached plan is never mixed with a newer one */
  version: number;
  from: number;
  to: number;
  chunk: number;
  holes: PlannedHole[];
}

export const ROAD_PLAN_VERSION = 1;

export class RoadPlan {
  private readonly cache = new Map<number, PlannedHole | null>();

  private constructor(readonly layout: RoadLayout, private readonly holeFirst: number, private readonly holeChance: number) {}

  /** trip: the ride's (Ride.trip; null = a ride from before trips) – its layout, its first sinkhole and its hole chance */
  static forSeed(seed: number, trip: string | null = null): RoadPlan {
    return new RoadPlan(new RoadLayout(seed, trip), holeFirstOf(trip), HOLE_CHANCE * tripRoadOf(trip).holeChance);
  }

  get seed(): number { return this.layout.seed; }

  /** the natural hole of chunk ci, or null – shared/road.js rollChunkHole */
  holeAt(ci: number): PlannedHole | null {
    const known = this.cache.get(ci);
    if (known !== undefined) return known;
    const h = HOLES_ON ? rollChunkHole(ci, this.layout, this.holeChance, this.holeFirst, ROAD_PLAN_MAX_S) : null;
    this.cache.set(ci, h);
    return h;
  }

  /** every natural hole whose chunk lies in [from, to) */
  holesBetween(from: number, to: number): PlannedHole[] {
    const out: PlannedHole[] = [];
    for (let ci = Math.max(0, Math.floor(from / CHUNK_LEN)); ci * CHUNK_LEN < to; ci++) {
      const h = this.holeAt(ci);
      if (h) out.push(h);
    }
    return out;
  }

  /** the holes whose footprint reaches into [s0, s1] (a little margin for the footprint) */
  holesNear(s0: number, s1: number): PlannedHole[] {
    return this.holesBetween(Math.floor((s0 - 8) / CHUNK_LEN) * CHUNK_LEN, s1 + 8 + CHUNK_LEN);
  }

  /** a stretch of the plan, chunk-aligned (`from` rounds down, `to` up) */
  window(rideId: string, from: number, to: number): RoadPlanDto {
    const a = Math.max(0, Math.floor(from / CHUNK_LEN) * CHUNK_LEN), b = Math.min(ROAD_PLAN_MAX_S, Math.ceil(to / CHUNK_LEN) * CHUNK_LEN);
    return { rideId, seed: this.seed, version: ROAD_PLAN_VERSION, from: a, to: b, chunk: CHUNK_LEN, holes: this.holesBetween(a, b) };
  }

  static type(id: string): HoleType | null {
    return HOLE_TYPES[id] ?? null;
  }
}

/* One RoadPlan per seed for a while: a ride's batches arrive every 15 s and each one measures against the same plan (building the layout is cheap,
   but there is no reason to do it 120 times a ride). Bounded – a plan of a finished ride simply falls out. */
const PLANS = new Map<string, RoadPlan>();
const PLANS_MAX = 64;
export function roadPlanFor(seed: number, trip: string | null = null): RoadPlan {
  const key = `${seed >>> 0}:${trip ?? ''}`;
  let plan = PLANS.get(key);
  if (plan) { PLANS.delete(key); PLANS.set(key, plan); return plan; }
  plan = RoadPlan.forSeed(seed >>> 0, trip);
  PLANS.set(key, plan);
  if (PLANS.size > PLANS_MAX) PLANS.delete(PLANS.keys().next().value!);
  return plan;
}
