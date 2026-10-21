export function rnd(n: number): number;
export const TRAFFIC_PROOF_WIDTH: number;
export const TRAFFIC_PROOF_MAX_CHARS: number;
export function encodeTrafficProof(rows: readonly (readonly number[])[]): string;
export function decodeTrafficProof(text: string): number[][] | null;
export function mulberry32(a: number): () => number;
export const MINIGAME_KINDS: readonly string[];
export const MINIGAME_ACCEPTED: readonly string[];
export const MG_RULES_VERSION: string;
export const MG_SALT_VERSION: string;
export const TELEMETRY_KEY_ID: string;
export const BATCH_MAC_LABEL: string;
export function batchMacGenesisMessage(rideId: string): string;
export function batchMacMessage(rideId: string, seq: number, prevMac: string, canonical: string): string;
export function enforceBatchMacMessage(rideId: string, seq: number, startTick: number, endTick: number, inpSha256Hex: string, chkSha256Hex: string): string;
export const NAMED_STREAMS: readonly string[];
export const STEP_30_DT: number;
export function requireNamedStreams<T extends Record<string, string>>(named: T): T;
export function stepInpAt30Hz(initial: Partial<LongitudinalState> | null, inp: readonly { tick: number; gas?: number; brake?: number; gear?: number }[] | null, ticks: number): LongitudinalState;
export function continueInpAt30Hz(state: LongitudinalState, inp: readonly { tick: number; gas?: number; brake?: number; gear?: number }[] | null, fromTick: number, toTick: number): LongitudinalState;
export function worldDigest32(ids: readonly string[]): number;
export function judgeWorldDigest(points: readonly { tSec: number; client: number; server: number }[]): 'ok' | 'flag' | 'reject';
export const TRAFFIC_SALT_LABEL: string;
export const HOLE_SALT_LABEL: string;
export function saltMessage(label: string, rideId: string): string;
/** Home-grid ids, length 12. Null is an empty slot. */
export const MG_GRID: readonly (string | null)[];
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

export interface ShapedHole extends RolledHole { ells: readonly HoleEllipse[]; l0: number; l1: number; ext: number }
export function shapeHole(id: string, ci: number, type: string, s: number, lat: number): ShapedHole;

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
export const SHADOW_STEP_DT: number;
export function stepAt30Hz(state: LongitudinalState, config?: LongitudinalConfig, powerFactor?: number, brakeEfficiency?: number, offroad?: boolean): LongitudinalState;
export const REPLAY_PHYSICS_SUBSTEPS: number;
export const EVENT_APPLY_GRACE_MS: number;
export const GEAR_RATIOS: readonly number[];
export interface LongitudinalState {
  v: number; gear: number; clutch: number; gas: number; brake: number; rpm: number;
  engineOn: boolean; park: boolean; rev: boolean;
}
export interface LongitudinalConfig {
  MAX_SPEED: number; REVERSE_MAX: number;
  TRUCK: { POWER: number; MASS: number; GEAR_EXP: number; DRAG: number; ROLL_RES: number; BRAKE: number };
  TORQUE_PEAK: number; TORQUE_LOW_W: number; TORQUE_HIGH_W: number; TORQUE_MIN: number;
  PARK_BRAKE: number; OFFROAD_DRAG: number;
}
export function longitudinalForces(state: LongitudinalState, config: LongitudinalConfig, powerFactor: number, brakeEfficiency: number, offroad: boolean): { acceleration: number; drive: number; overrev: boolean };
export function integrateLongitudinal(state: LongitudinalState, config: LongitudinalConfig, powerFactor: number, brakeEfficiency: number, offroad: boolean, dt: number, substeps?: number): number;
export const REV_RATIO: number;
export const REDLINE: number;
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

export interface RoadPoint { x: number; z: number; t: number }
export interface RoadGeometry {
  roadAt(s: number): RoadPoint;
  curv(s: number): number;
  setRoadProfile(fn: (s: number) => number): void;
  invalidateRoad(s: number): void;
}
export interface SimulationTrip extends TripTrafficKnobs { bends: number; road?: Partial<TripRoad> }
export interface SharedFork { f0: number; f1: number; choice: number }
export interface SharedRoadNetwork {
  seed: number; Sm: number; clock: number; straight: boolean;
  reset(seed: number): SharedRoadNetwork;
  setStyle(style: { curv: (s: number) => number }): void;
  lanes(s: number, dir: number): number;
  onRoad(s: number, d: number): boolean;
  forkAt(s: number): SharedFork | null;
  setChoice(fork: SharedFork, choice: number): boolean;
}
export interface TrafficTruckState { s: number; d: number; psi: number; tyaw: number; v: number; vel: number; hull: number; rev: boolean; crashV: number }
export interface SharedTrafficVehicle {
  id: number; pick: number; def: VehicleDef; P: PresetDef; preset: string; dir: 1 | -1;
  s: number; lat: number; v: number; vDes: number; lane: number; target: number; lv: number;
  t: number; ph: number; lcT: number; cool: number; touch: number; worst: number; counted: boolean; over: boolean;
  dLat: number | null; dV: number; hz: boolean; state: string;
  road: { main?: boolean; j?: { id: string }; at(s: number): RoadPoint };
}
export interface SharedTrafficContact { car: SharedTrafficVehicle; damage: number; closing: number; kind: 'crash' | 'bump' | 'scrape' }
export interface SharedTrafficSimulation {
  cars: SharedTrafficVehicle[]; readonly spawned: number;
  resetTraffic(seed?: number): void;
  updateTraffic(dt: number): string | null;
  clearStretch(s0: number, s1: number): void;
  spawn(type: string, preset: string, zone?: string, dist?: number, lat?: number): SharedTrafficVehicle | null;
}
export const SIMULATION_CONFIG: LongitudinalConfig & Readonly<Record<string, unknown>>;
export const SIMULATION_TRIPS: Readonly<Record<string, SimulationTrip>>;
export const ROUTE_CURVATURE: Readonly<Record<string, (s: number) => number>>;
export const FINISH_RULES_VERSION: number;
export const V_BASE: number;
export const FINISH_MIN_M: number;
export const FINISH_MAX_M: number;
export interface FinishForResult {
  finishS: number;
  expectedSeconds: number;
  finishRulesVersion: number;
  rx: number;
  rz: number;
  rt: number;
}
export function finishFor(roadSeed: number, trip: string, finishRulesVersion?: number): FinishForResult;
export function finishBlocked(roadSeed: number, trip: string, s: number): boolean;
export function snapSafe(net: object, holes: readonly { s: number }[], sStar: number): number;

export const DAMAGE_SOURCES: readonly ['holes', 'vehicles', 'props', 'cold', 'other'];
export interface DamageBuckets { holes: number; vehicles: number; props: number; cold: number; other: number }
export function emptyBuckets(): DamageBuckets;
export function addBucket(buckets: DamageBuckets, source: string, amount: number): DamageBuckets;
export function bucketTotal(buckets: DamageBuckets): number;
export function sourceOfLabel(label: string): 'holes' | 'vehicles' | 'props' | 'cold' | 'other';
export function bucketsFromCharges(holeAmounts: readonly number[], vehicleAmounts: readonly number[], hullAtFinish: number): DamageBuckets;
export function crossedRed(net: { near(lo: number, hi: number): readonly object[]; stopLine(j: object, dir: number): number; signal(j: object, app: string): string }, s0: number, s1: number): number;
export function countRedLights(net: { clock: number; near(lo: number, hi: number): readonly object[]; stopLine(j: object, dir: number): number; signal(j: object, app: string): string }, samples: readonly { s: number; t: number }[]): number;
export function roadNetFor(roadSeed: number, trip: string): { clock: number; world(s: number, d: number): { x: number; z: number }; near(lo: number, hi: number): readonly object[]; stopLine(j: object, dir: number): number; signal(j: object, app: string): string };

export function createRoadGeometry(): RoadGeometry;
export function createRoadNetwork(options: { config: object; geometry: RoadGeometry; trip: SimulationTrip }): SharedRoadNetwork;
export function createTrafficSimulation(options: {
  config: object; state: TrafficTruckState; roadAt: RoadGeometry['roadAt']; net: SharedRoadNetwork;
  holes: typeof HOLES; holesNear: (s0: number, s1: number) => readonly ShapedHole[]; trip: SimulationTrip;
  hurt?: (damage: number, closing: number, label: string, silent?: boolean) => void;
  onContact?: (contact: SharedTrafficContact) => void;
}): SharedTrafficSimulation;
