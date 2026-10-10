/* The road the server judges a ride on – the numbers that must stay identical to the game (client/js/config.js, net/network.js, net/patterns.js,
   net/obstacles.js, sim/damage.js). The layout and the sinkholes are a pure function of the ride's seed, so the server rebuilds them from that seed alone
   (road-layout.ts, road-plan.ts) and never takes the client's word for where an obstacle was. test/unit/domain/road/road-drift.spec.ts runs the game's own
   modules next to this port on many seeds and fails on any difference. */

/** CFG.CHUNK_LEN – metres of road per streamed chunk; at most one natural hole per chunk */
export const CHUNK_LEN = 32;
/** CFG.START_ACCESS / CFG.START_TURN_R – the depot's access road and the right turn onto the main road */
export const START_ACCESS = 190;
export const START_TURN_R = 22;
/** CFG.SIGNAL_* – traffic-light cycle (the generator draws them from the seed, so they shape the layout's random stream) */
export const SIGNAL_GREEN: readonly [number, number] = [16, 26];
export const SIGNAL_CROSS: readonly [number, number] = [9, 14];
export const SIGNAL_AMBER = 3;
export const SIGNAL_CLEAR = 2;
/** CFG.HOLES / HOLE_CHANCE / HOLE_FIRST – road holes: chance per chunk, none in the first metres of the main road */
export const HOLES_ON = true;
export const HOLE_CHANCE = 0.045;
export const HOLE_FIRST = 150;
/** …per trip (client/js/trips.js `holesFrom`; a ride's trip is Ride.trip, domain/rides/ride-trip.ts): the free run's natural sinkholes start where its
    one minute can never reach (a brisk driver covers ~820 m of a 60 s run from the depot) – every other trip, and a ride from before trips, HOLE_FIRST */
export const TRIP_HOLE_FIRST: Readonly<Record<string, number>> = { free: 1200, 'free-1': 1200, 'free-2': 400 };
export const holeFirstOf = (trip: string | null): number => (trip !== null ? TRIP_HOLE_FIRST[trip] : undefined) ?? HOLE_FIRST;
/** CFG.OFFROAD_FAIL_SECONDS – the game ends the ride after this long off the tarmac (draining 2× as fast once back on it) */
export const OFFROAD_FAIL_SECONDS = 20;
/** CFG.MAX_SPEED (= ride-rules.ts MAX_SPEED) – the damage of a hole scales with (v / this)² */
export const HOLE_REF_SPEED = 28;

/* net/network.js – lanes: lane i of a direction is centred at ±(LANE0 + i·LW); a lane-count change is a TAPER m transition */
export const LANE0 = 2.4;
export const LW = 4.2;
export const TAPER = 120;
export const SHOULDER = 1.2;
export const SIDE_LEN = 450;

/* net/patterns.js – the road PATTERNS the generator strings together (keys in this order: the generator walks them in it) */
export interface JunctionPattern { gap: readonly [number, number]; cross: number; signal: number; side: readonly number[] }
export interface RoadPattern {
  lanes: readonly (readonly [number, number, number])[];
  seg: readonly [number, number];
  len: readonly [number, number];
  bends: number;
  junction: JunctionPattern | null;
  /** the road splits in two and meets again (FORK) */
  fork?: boolean;
}
export const PATTERNS: Readonly<Record<string, RoadPattern>> = {
  country: { lanes: [[1, 1, 1]], seg: [700, 1600], len: [900, 2400], bends: 1, junction: { gap: [420, 950], cross: 0.5, signal: 0.35, side: [1, 1, 2] } },
  highway: { lanes: [[2, 2, 3], [3, 3, 1], [3, 2, 1], [2, 3, 1]], seg: [500, 1100], len: [1600, 3600], bends: 0.55, junction: null },
  arterial: { lanes: [[2, 2, 3], [2, 1, 1], [1, 2, 1], [3, 3, 1]], seg: [400, 900], len: [800, 1700], bends: 0.35, junction: { gap: [260, 520], cross: 0.85, signal: 0.9, side: [1, 2] } },
  town: { lanes: [[1, 1, 2], [2, 2, 1]], seg: [300, 700], len: [500, 1100], bends: 0.15, junction: { gap: [170, 320], cross: 0.7, signal: 0.75, side: [1] } },
  dual: { lanes: [[2, 2, 1]], seg: [700, 1500], len: [1500, 3200], bends: 0.6, junction: null },
  fork: { lanes: [[1, 1, 1]], seg: [1200, 1200], len: [1200, 1200], bends: 0, junction: null, fork: true },
};
/** net/patterns.js FORK – a fork pattern splits the road into two mirror-image roads of the same length that meet again `len` m on: in (s, d) they are one
    road, so the judge needs nothing of the geometry – only that before `commit` m after the split, and in the last `commit` m before the merge, both
    roads' tarmac is one apron, `corridor` m wider either way than the road's edges (the gap between the two roads at the commit point). */
export const FORK = { len: 1200, commit: 205, corridor: 15 } as const;
/** The game samples the truck BEFORE it moves it onto the other road of a fork (client/js/main.js: physics → tickTelemetry → roads.update → forkCommit), so
    the last sample on the old road may already lie one frame past the commit point (dt ≤ 0.05 s at the governor: 1.4 m). So a forward step that ends at
    or beyond the commit point and starts before it – or at most this far past it – may be the switch (RoadLayout.forkSwitch). */
export const FORK_SWITCH_REACH = 1.5;
/** …and that step moves d by the gap between the two roads (14.3 m at the commit point: the truck keeps its place in the world, the spine moves under it),
    while a truck moves at most 2.8 m sideways in a 0.1 s sample step even at the governor. So a step over the commit point that moves d less than this is
    no switch – the truck stayed on its road, and its wheels are measured against the holes there like anywhere else (world-facts.ts holePasses). */
export const FORK_SWITCH_JUMP = 4;
/** client/js/trips.js `road` – a trip's LAYOUT: the patterns it opens with (first = the depot exit, drawn with the length 500–1100 m), the pattern weights after
    them, and × HOLE_CHANCE. Judged, so every trip id is here or gets the default (the old trips and a ride from before trips). road-drift.spec.ts. */
export interface TripRoad { first: readonly string[]; weights: Readonly<Record<string, number>>; holeChance: number }
export const TRIP_ROADS: Readonly<Record<string, TripRoad>> = {
  'free-1': { first: ['dual'], weights: { dual: 1 }, holeChance: 1 },
  'free-2': { first: ['country', 'fork'], weights: { country: 3, arterial: 1, town: 1, fork: 2 }, holeChance: 1.5 },
  'free-3': { first: ['country', 'fork'], weights: { country: 3, highway: 1, arterial: 1.5, town: 1.5, fork: 1.5 }, holeChance: 2 },
};
/** net/patterns.js DEFAULT_WEIGHTS – no route sets its own `roads.weights`, so every route gets this layout (the drift spec pins that too) */
export const DEFAULT_WEIGHTS: Readonly<Record<string, number>> = { country: 3, highway: 1, arterial: 1, town: 1 };

export const tripRoadOf = (trip: string | null): TripRoad => (trip !== null ? TRIP_ROADS[trip] : undefined) ?? { first: ['country'], weights: DEFAULT_WEIGHTS, holeChance: 1 };

/* net/obstacles.js HOLES – the hole types. Only types with `cones` are rolled onto the road (today: the sinkhole); the others are what spectators can pay for.
   ells = ellipses relative to the hole's centre: ds along the road (+ forward), dl across (+ right), a / b half length / half width.
   dmg = hull % per axle entry at HOLE_REF_SPEED (× (v / ref)², rear axles × REAR_AXLE_SHARE), slow = speed fraction lost per entry (same scale). */
export interface HoleType { ells: readonly { ds: number; dl: number; a: number; b: number }[]; dmg: number; slow: number; lane: boolean; cones: boolean }
export const HOLE_TYPES: Readonly<Record<string, HoleType>> = {
  pothole: { ells: [{ ds: 0, dl: 0, a: 0.6, b: 0.5 }], dmg: 2.5, slow: 0.04, lane: false, cones: false },
  deep: { ells: [{ ds: 0, dl: 0, a: 0.85, b: 0.8 }], dmg: 7, slow: 0.12, lane: false, cones: false },
  cluster: { ells: [{ ds: -3, dl: -0.9, a: 0.5, b: 0.45 }, { ds: 0, dl: 0.8, a: 0.6, b: 0.5 }, { ds: 3, dl: -0.3, a: 0.5, b: 0.45 }], dmg: 1.8, slow: 0.03, lane: false, cones: false },
  trench: { ells: [{ ds: 0, dl: 0, a: 0.45, b: 2.3 }], dmg: 6, slow: 0.15, lane: true, cones: false },
  sinkhole: { ells: [{ ds: 0, dl: 0, a: 2, b: 2 }], dmg: 14, slow: 0.35, lane: true, cones: true },
};
export type HoleTypeId = keyof typeof HOLE_TYPES & string;

/* sim/damage.js – how the game drives over a hole: three axles (m from the driver's eye along the road: front, drive, trailer), a wheel ±WHEEL m either side
   of the truck's centre line. An axle entering a pit at ≥ CRAWL_SPEED costs dmg × (v / ref)² (× REAR_AXLE_SHARE on the rear two) – applied when ≥ MIN_HURT. */
export const AXLES: readonly number[] = [2.2, -0.4, -11.5];
export const WHEEL = 1;
export const REAR_AXLE_SHARE = 0.6;
export const CRAWL_SPEED = 3;
export const MIN_HURT = 0.3;

/** the hull % one axle entering a hole of this type at speed v costs in the game (0 when crawling, or below the game's MIN_HURT) */
export function holeDamage(type: HoleType, v: number, axle: number): number {
  if (v < CRAWL_SPEED) return 0;
  const sc = Math.min(Math.max(v / HOLE_REF_SPEED, 0), 1.2) ** 2 * (axle ? REAR_AXLE_SHARE : 1);
  const dmg = type.dmg * sc;
  return dmg >= MIN_HURT ? dmg : 0;
}

/** the largest window one plan request may ask for (m) – the game asks for ROAD_PLAN_WINDOW at a time */
export const ROAD_PLAN_MAX_SPAN = 10_000;
export const ROAD_PLAN_WINDOW = 6000;
/** the plan stops here: no ride reaches it (28 m/s × 8 h ≈ 806 km) */
export const ROAD_PLAN_MAX_S = 1_000_000;
