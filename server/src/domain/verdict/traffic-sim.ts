import { RoadPlan, type PlannedHole } from '../road/road-plan.js';
import { HOLE_REF_SPEED, LW, CHUNK_LEN } from '../road/road-rules.js';
import { worldFor } from '../rides/ride-rules.js';
import {
  CAB_BACK, CRASH_CLOSING, CRASH_OVERLAP, CRASH_TRUCK_MASS, HITCH, HOLE_WARN, SCRATCH_DMG,
  TRAFFIC_CLEAR, TRAFFIC_GAP, TRAFFIC_LOOK, TRAFFIC_MAX, TRAFFIC_RUB_GAP, TRAFFIC_SEED_XOR, TRAFFIC_TYPES,
  TRAILER_BACK, TRAILER_HALF_W, TRIP_TRAFFIC, TRUCK_FRONT, TRUCK_HALF_W, VEHICLES,
  bumpDmg as sharedBumpDmg, checkTruckTrafficSwept, laneLat as sharedLaneLat, tripTrafficFor,
  createRoadGeometry, createRoadNetwork, createTrafficSimulation, HOLES, shapeHole,
  SIMULATION_CONFIG, SIMULATION_TRIPS, ROUTE_CURVATURE, clamp,
  type TripTrafficKnobs, type VehicleDef, type TrafficTruckState, type SharedTrafficVehicle,
  type SharedTrafficSimulation, type SharedTrafficContact,
} from '../shared/index.js';

export const MAX_SPEED = HOLE_REF_SPEED;
export const LANE_WIDTH = LW;
export {
  CAB_BACK,
  CRASH_CLOSING,
  CRASH_OVERLAP,
  CRASH_TRUCK_MASS,
  HITCH,
  HOLE_WARN,
  SCRATCH_DMG,
  TRAFFIC_CLEAR,
  TRAFFIC_GAP,
  TRAFFIC_LOOK,
  TRAFFIC_MAX,
  TRAFFIC_RUB_GAP,
  TRAFFIC_SEED_XOR,
  TRAFFIC_TYPES,
  TRAILER_BACK,
  TRAILER_HALF_W,
  TRIP_TRAFFIC,
  TRUCK_FRONT,
  TRUCK_HALF_W,
  VEHICLES,
  checkTruckTrafficSwept,
  tripTrafficFor,
  type TripTrafficKnobs,
  type VehicleDef,
};

export type SimVehicle = SharedTrafficVehicle;

export interface TrafficContactEvent {
  readonly vehicleId: number;
  readonly vehicleType: string;
  readonly vehicleName: string;
  readonly kind: 'crash' | 'bump' | 'scrape';
  readonly t: number;
  readonly s: number;
  readonly d: number;
  readonly vehicleS: number;
  readonly vehicleLat: number;
  readonly closingSpeed: number;
  readonly overlapFraction: number | null;
  readonly expectedDamage: number;
  readonly actualHullDrop: number;
  readonly ignored: boolean;
}

export interface TrafficSimSummary {
  readonly spawned: number;
  readonly activePeak: number;
  readonly contacts: readonly TrafficContactEvent[];
  readonly ignoredCrashes: number;
  readonly ignoredBumps: number;
}

export const laneLat = (dir: number, lane = 0): number => sharedLaneLat(dir, lane);
export const bumpDmg = (def: VehicleDef, closing: number): number => sharedBumpDmg(def, closing, CRASH_CLOSING);

/** Browser traffic kernel without renderer/sound hooks. Required proofs feed exact frames to stepPose;
 * historical samples use interpolated stepSamplePair for diagnostic collision evidence. */
export class TrafficSimulator {
  readonly contacts: TrafficContactEvent[] = [];
  readonly geometry = createRoadGeometry();
  readonly net;
  readonly state: TrafficTruckState = { s: 0, d: 2.4, psi: 0, tyaw: 0, v: 0, vel: 0, hull: 100, rev: false, crashV: 0 };
  private readonly simulation: SharedTrafficSimulation;
  private activePeak = 0;
  private time = 0;
  private hullDrop = 0;
  private continuous = true;

  constructor(
    readonly seed: number,
    readonly trip: string | null,
    readonly plan: RoadPlan = RoadPlan.forSeed(seed, trip),
    readonly route: string = worldFor(seed).route,
    readonly placed: readonly (PlannedHole & { appliedT: number })[] = [],
    readonly assist = false,
  ) {
    const knobs = SIMULATION_TRIPS[trip ?? 'classic'] ?? SIMULATION_TRIPS.classic!;
    this.net = createRoadNetwork({ config: SIMULATION_CONFIG, geometry: this.geometry, trip: knobs });
    this.net.setStyle({ curv: ROUTE_CURVATURE[route] ?? ROUTE_CURVATURE.route66! });
    this.net.reset(seed);
    this.simulation = createTrafficSimulation({
      config: SIMULATION_CONFIG, state: this.state, roadAt: this.geometry.roadAt, net: this.net, holes: HOLES, trip: knobs,
      holesNear: (s0, s1) => {
        const out = [];
        for (let ci = Math.max(0, Math.floor((s0 - 8) / CHUNK_LEN)); ci <= Math.floor((s1 + 8) / CHUNK_LEN); ci++) {
          const natural = this.plan.holeAt(ci);
          const donated = this.placed.filter((h) => Math.floor(h.s / CHUNK_LEN) === ci && h.appliedT <= this.time).at(-1);
          for (const h of [natural, donated]) if (h) out.push(shapeHole(h.id, ci, h.type, h.s, h.lat));
        }
        return out;
      },
      hurt: (damage, _closing, _label, fatal) => { this.state.hull = Math.max(0, this.state.hull - damage * (assist && !fatal ? .5 : 1)); },
      onContact: (contact) => this.recordContact(contact),
    });
    this.simulation.resetTraffic((seed ^ TRAFFIC_SEED_XOR) >>> 0);
    this.activePeak = this.cars.length;
  }

  get cars(): SimVehicle[] { return this.simulation.cars; }

  static forRide(seed: number, trip: string | null, plan: RoadPlan = RoadPlan.forSeed(seed, trip)): TrafficSimulator {
    return new TrafficSimulator(seed, trip, plan);
  }

  clearStretch(s0: number, s1: number): void { this.simulation.clearStretch(s0, s1); }

  /** Exact kernel step when the caller has the browser's full pre-contact pose and frame duration. */
  stepPose(dt: number, pose: TrafficTruckState, t: number, hullDrop = 0, clock = t - dt): string | null {
    Object.assign(this.state, pose);
    this.time = t; this.hullDrop = hullDrop; this.net.clock = clock;
    const fatal = this.simulation.updateTraffic(dt);
    this.activePeak = Math.max(this.activePeak, this.cars.length);
    return fatal;
  }

  stepSamplePair(p: readonly number[], q: readonly number[], windowHullDrop = 0): TrafficContactEvent[] {
    const dt = q[0]! - p[0]!;
    if (dt > 2) this.continuous = false; // the recording-gap check rejects this; later car positions cannot be reconstructed
    if (!(dt > 0)) return [];
    if (!this.continuous) return [];
    const first = this.contacts.length, n = Math.max(1, Math.ceil(dt / .05 - 1e-8)), h = dt / n;
    const lerp = (col: number, a: number, fallback = 0) => (p[col] ?? fallback) + ((q[col] ?? fallback) - (p[col] ?? fallback)) * a;
    const hullDrop = Math.max(0, (p[7] ?? 100) - (q[7] ?? 100), windowHullDrop);
    for (let i = 1; i <= n; i++) {
      const a = i / n, s = lerp(1, a), psi = lerp(3, a), v = lerp(4, a), rev = ((p[13] ?? 0) & 1024) !== 0;
      const vel = rev ? -v : v, hd = this.geometry.roadAt(lerp(1, (i - 1) / n)).t + lerp(3, (i - 1) / n);
      const tyaw = clamp(this.state.tyaw + vel / 8 * Math.sin(hd - this.state.tyaw) * h, hd - 1.2, hd + 1.2);
      this.stepPose(h, { s, d: lerp(2, a), psi, tyaw, v, vel, rev, hull: lerp(7, a, 100), crashV: 0 }, lerp(0, a), hullDrop);
    }
    // Branch choice is recorded after the browser's physics/contact step.
    const fork = this.net.forkAt(q[1]!);
    if (fork && this.net.setChoice(fork, q[15] === 1 ? 1 : 0)) this.clearStretch(fork.f0, fork.f1);
    return this.contacts.slice(first);
  }

  private recordContact({ car, damage, closing, kind }: SharedTrafficContact): void {
    const ignored = kind === 'crash' ? this.hullDrop < 15 : damage >= 2 && this.hullDrop < damage * .25;
    this.contacts.push({
      vehicleId: car.id, vehicleType: car.def.type, vehicleName: car.def.name, kind,
      t: this.time, s: this.state.s, d: this.state.d, vehicleS: car.s, vehicleLat: car.lat,
      closingSpeed: closing, overlapFraction: null, expectedDamage: damage, actualHullDrop: this.hullDrop, ignored,
    });
  }

  summary(): TrafficSimSummary {
    return {
      spawned: this.simulation.spawned, activePeak: this.activePeak, contacts: this.contacts,
      ignoredCrashes: this.contacts.filter((c) => c.kind === 'crash' && c.ignored).length,
      ignoredBumps: this.contacts.filter((c) => c.kind !== 'crash' && c.ignored).length,
    };
  }
}

export const maxSpeedFor = (): number => MAX_SPEED;
