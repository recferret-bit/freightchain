import { RoadLayout, laneLat, rnd } from './road-layout.js';
import { CHUNK_LEN, HOLE_CHANCE, HOLE_FIRST, HOLE_TYPES, HOLES_ON, ROAD_PLAN_MAX_S, type HoleType } from './road-rules.js';

/* The ride's OBSTACLE PLAN – the server's answer to "where were the holes on this ride's road?". A pure function of the seed: the layout (road-layout.ts)
   plus the game's per-chunk roll (client/js/net/obstacles.js `naturalHole`), ported line for line. It is what the server
   - hands the driver's game (GET /api/watch/:id/road – the game draws and drives over THESE holes, its own roll is only the offline fallback),
   - hands spectators (the same route: a replay shows the server's holes, not anything the driver's game reported),
   - judges the recording against (telemetry/world-facts.ts measures every pass at upload time, verdict/world-checks.ts decides). */

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

const TYPE_IDS = Object.keys(HOLE_TYPES).filter((k) => HOLE_TYPES[k]!.cones); // only these are rolled onto the road

export class RoadPlan {
  private readonly cache = new Map<number, PlannedHole | null>();

  private constructor(readonly layout: RoadLayout) {}

  static forSeed(seed: number): RoadPlan {
    return new RoadPlan(new RoadLayout(seed));
  }

  get seed(): number { return this.layout.seed; }

  /** the natural hole of chunk ci, or null – client/js/net/obstacles.js naturalHole */
  holeAt(ci: number): PlannedHole | null {
    const known = this.cache.get(ci);
    if (known !== undefined) return known;
    const net = this.layout, q = (k: number) => rnd(ci * 97.13 + k * 3.71), s = ci * CHUNK_LEN + 4 + q(1) * 24;
    let h: PlannedHole | null = null;
    if (HOLES_ON && ci >= 0 && s < ROAD_PLAN_MAX_S && q(2) < HOLE_CHANCE && s >= net.Sm + HOLE_FIRST && net.plain(s, 70)) {
      const type = TYPE_IDS[Math.floor(q(3) * TYPE_IDS.length)]!, T = HOLE_TYPES[type]!, r = q(4), j = q(5) - 0.5;
      const dir = T.lane ? (r < 0.7 ? 1 : -1) : r < 0.6 ? 1 : -1, lane = laneLat(dir, Math.floor(q(6) * net.lanes(s, dir)));
      const lat = T.lane ? lane : r < 0.85 ? lane + j * 1.6 : j * 1.2;
      h = { id: 'h' + ci, ci, type, s, lat };
    }
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
const PLANS = new Map<number, RoadPlan>();
const PLANS_MAX = 64;
export function roadPlanFor(seed: number): RoadPlan {
  const key = seed >>> 0;
  let plan = PLANS.get(key);
  if (plan) { PLANS.delete(key); PLANS.set(key, plan); return plan; }
  plan = RoadPlan.forSeed(key);
  PLANS.set(key, plan);
  if (PLANS.size > PLANS_MAX) PLANS.delete(PLANS.keys().next().value!);
  return plan;
}
