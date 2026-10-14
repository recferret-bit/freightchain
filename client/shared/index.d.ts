export function rnd(n: number): number;
export function mulberry32(a: number): () => number;
export function clamp(v: number, a: number, b: number): number;
export function approach(v: number, t: number, r: number, dt: number): number;

export const CHUNK_LEN: number;
export const START_ACCESS: number;
export const START_TURN_R: number;
export const SIGNAL_GREEN: readonly [number, number];
export const SIGNAL_CROSS: readonly [number, number];
export const SIGNAL_AMBER: number;
export const SIGNAL_CLEAR: number;
export const HOLES_ON: boolean;
export const HOLE_CHANCE: number;
export const HOLE_FIRST: number;
export const OFFROAD_FAIL_SECONDS: number;
export const HOLE_REF_SPEED: number;

export const LANE0: number;
export const LW: number;
export const TAPER: number;
export const SHOULDER: number;
export const SIDE_LEN: number;

export function edgeOf(n: number): number;
export function laneLat(dir: number, i?: number): number;

export const FORK_LEN: number;
export const FORK_SWITCH_REACH: number;
export const FORK_SWITCH_JUMP: number;
export const FORK: {
  readonly len: number;
  readonly bulge: number;
  readonly commit: number;
  readonly corridor: number;
  readonly reach: number;
};
export const FORK_RULES: {
  readonly len: number;
  readonly commit: number;
  readonly corridor: number;
};

export interface JunctionPattern {
  readonly gap: readonly [number, number];
  readonly cross: number;
  readonly signal: number;
  readonly side: readonly number[];
}

export interface RoadPattern {
  readonly lanes: readonly (readonly [number, number, number])[];
  readonly seg: readonly [number, number];
  readonly len: readonly [number, number];
  readonly bends: number;
  readonly junction: JunctionPattern | null;
  readonly fork?: boolean;
}

export interface ClientRoadPattern extends RoadPattern {
  readonly name: string;
  readonly centre: string | null;
}

export const PATTERNS: Readonly<Record<string, ClientRoadPattern>>;
export const ROAD_PATTERNS: Readonly<Record<string, RoadPattern>>;
export const DEFAULT_WEIGHTS: Readonly<Record<string, number>>;
export const DEFAULT_FIRST_LEN: readonly [number, number];

export const TRIP_HOLE_FIRST: Readonly<Record<string, number>>;
export function holeFirstOf(trip: string | null): number;

export interface TripRoad {
  readonly first: readonly string[];
  readonly weights: Readonly<Record<string, number>>;
  readonly holeChance: number;
  readonly firstLen: readonly [number, number];
}
export const TRIP_ROADS: Readonly<Record<string, TripRoad>>;
export function tripRoadOf(trip: string | null): TripRoad;

export interface HoleEllipse {
  readonly ds: number;
  readonly dl: number;
  readonly a: number;
  readonly b: number;
}

export interface HoleType {
  readonly ells: readonly HoleEllipse[];
  readonly dmg: number;
  readonly slow: number;
  readonly lane: boolean;
  readonly cones: boolean;
}

export interface ClientHoleDef extends HoleType {
  readonly name: string;
  readonly jolt: number;
  readonly kick: number;
  readonly crawl: number;
}

export type HoleTypeId = 'pothole' | 'deep' | 'cluster' | 'trench' | 'sinkhole';
export const HOLES: Readonly<Record<string, ClientHoleDef>>;
export const HOLE_TYPES: Readonly<Record<string, HoleType>>;
export const CONE_HOLE_IDS: readonly string[];

export interface RolledHole {
  id: string;
  ci: number;
  type: string;
  s: number;
  lat: number;
}

export function rollChunkHole(
  ci: number,
  net: { readonly Sm: number; plain(s: number, pad: number): boolean; lanes(s: number, dir: 1 | -1): number },
  holeChance?: number,
  holeFirst?: number,
  maxS?: number,
): RolledHole | null;

export const AXLES: readonly number[];
export const WHEEL: number;
export const REAR_AXLE_SHARE: number;
export const CRAWL_SPEED: number;
export const MIN_HURT: number;

export function holeDamage(type: { readonly dmg: number }, v: number, axle: number): number;

export const ROAD_PLAN_MAX_SPAN: number;
export const ROAD_PLAN_WINDOW: number;
export const ROAD_PLAN_MAX_S: number;

export const TRAFFIC_SEED_XOR: number;
export const TRUCK_FRONT: number;
export const CAB_BACK: number;
export const HITCH: number;
export const TRAILER_BACK: number;
export const TRUCK_HALF_W: number;
export const TRAILER_HALF_W: number;
export const TRAFFIC_MAX: number;
export const TRAFFIC_GAP: number;
export const TRAFFIC_CLEAR: number;
export const TRAFFIC_LOOK: number;
export const TRAFFIC_RUB_GAP: number;
export const CRASH_TRUCK_MASS: number;
export const CRASH_OVERLAP: number;
export const CRASH_CLOSING: number;
export const SCRATCH_DMG: number;
export const HOLE_WARN: number;
export const HORIZON: number;
export const HOLE_MARGIN: number;

export const CAR_COLORS: readonly number[];

export interface VehicleDef {
  readonly type: string;
  readonly name: string;
  readonly len: number;
  readonly w: number;
  readonly h: number;
  readonly mass: number;
  readonly v: readonly [number, number];
  readonly rare: number;
  readonly presets: Readonly<Record<string, number>>;
}

export const VEHICLES: Readonly<Record<string, VehicleDef>>;
export const TRAFFIC_TYPES: readonly string[];

export interface PresetDef {
  readonly speed: number;
  readonly T: number;
  readonly over?: boolean;
  readonly weave?: number;
  readonly siren?: boolean;
}

export const PRESETS: Readonly<Record<string, PresetDef>>;
export const BEHIND_OK: readonly string[];
export const CROSS_OK: readonly string[];
export const CALM_OK: readonly string[];

export interface TripTrafficKnobs {
  readonly traffic: number;
  readonly cross: number;
  readonly calm: boolean;
  readonly start: 'depot' | 'straight';
}

export const TRIP_TRAFFIC: Readonly<Record<string, TripTrafficKnobs>>;
export function tripTrafficFor(trip: string | null): TripTrafficKnobs;
export function bumpDmg(def: VehicleDef, closing: number, crashClosing?: number): number;

export interface TruckTrafficSweptHit {
  readonly kind: 'crash' | 'bump' | 'scrape';
  readonly bestAlpha: number;
  readonly ts: number;
  readonly td: number;
  readonly cs: number;
  readonly cl: number;
  readonly rel: number;
  readonly closing: number;
  readonly overlapFraction: number;
  readonly expectedDamage: number;
}

export function checkTruckTrafficSwept(
  car: { readonly def: VehicleDef; readonly dir: 1 | -1; readonly s: number; readonly sPrev?: number; readonly lat: number; readonly latPrev?: number; readonly v: number },
  s0: number,
  s1: number,
  d0: number,
  d1: number,
  vTruck: number,
): TruckTrafficSweptHit | null;

export const REPLAY_SIM_HZ: number;
export const REPLAY_PHYSICS_SUBSTEPS: number;
export const EVENT_APPLY_GRACE_MS: number;
export const GEAR_RATIOS: readonly number[];
export const RATIOS: readonly number[];
export const TRUCK_MASS: number;
export const TRUCK_POWER: number;
export const TRUCK_GEAR_EXP: number;
export const TRUCK_ROLL_RES: number;
export const TRUCK_DRAG: number;
export const TRUCK_BRAKE: number;
export const OFFROAD_DRAG: number;

export function stepTruckPhysics(
  v0: number,
  gas: number,
  brake: number,
  gear: number,
  offroad: boolean,
  dt: number,
  substeps?: number,
): { vSim: number; vMaxPossible: number };

export function stepLongitudinalPhysics(
  v0: number,
  gas: number,
  brake: number,
  gear: number,
  offroad: boolean,
  dt: number,
  substeps?: number,
): { vSim: number; vMaxPossible: number };
