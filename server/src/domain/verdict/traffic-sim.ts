import { RoadPlan } from '../road/road-plan.js';
import { HOLE_REF_SPEED, HOLE_TYPES, LW } from '../road/road-rules.js';
import {
  BEHIND_OK,
  CAB_BACK,
  CALM_OK,
  CRASH_CLOSING,
  CRASH_OVERLAP,
  CRASH_TRUCK_MASS,
  HITCH,
  HOLE_MARGIN,
  HOLE_WARN,
  HORIZON,
  PRESETS,
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
  approach,
  bumpDmg as sharedBumpDmg,
  checkTruckTrafficSwept,
  clamp,
  laneLat as sharedLaneLat,
  mulberry32,
  tripTrafficFor,
  type PresetDef,
  type TripTrafficKnobs,
  type VehicleDef,
} from '../shared/index.js';
import { SAMPLE_D_COL, SAMPLE_FORK_COL, SAMPLE_HULL_COL, SAMPLE_PSI_COL, SAMPLE_S_COL, SAMPLE_T_COL, SAMPLE_V_COL } from '../telemetry/telemetry-rules.js';

/* Deterministic backend traffic simulator consuming @freightchain/shared (via ../shared/index.js).
   Seeded from (ride.seed ^ 0x9e3779b9) >>> 0, stepped at REPLAY_SIM_HZ (10 Hz, dt = 0.1 s) with swept continuous collision detection (CCD) over [s0, s1]. */

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

export interface SimVehicle {
  id: number;
  pick: number;
  def: VehicleDef;
  P: PresetDef;
  preset: string;
  dir: 1 | -1;
  s: number;
  sPrev: number;
  lat: number;
  latPrev: number;
  lane: number;
  target: number;
  lv: number;
  v: number;
  vDes: number;
  lcT: number;
  ph: number;
  t: number;
  cool: number;
  touch: number;
  worst: number;
  counted: boolean;
  over: boolean;
  dLat: number | null;
  dV: number;
  hz: boolean;
  state: 'drive' | 'crashed';
}

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
  readonly overlapFraction: number;
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

interface TruckStepPose { t: number; s: number; d: number; psi: number; v: number; vd: number; hull: number; fork: number }

/** Deterministic backend traffic simulator (matches client/js/sim/traffic.js). */
export class TrafficSimulator {
  readonly cars: SimVehicle[] = [];
  readonly contacts: TrafficContactEvent[] = [];
  private readonly rng: () => number;
  private readonly knobs: TripTrafficKnobs;
  private readonly straight: boolean;
  private spawnT: number;
  private ids = 0;
  private activePeak = 0;

  constructor(
    readonly seed: number,
    readonly trip: string | null,
    readonly plan: RoadPlan = RoadPlan.forSeed(seed, trip),
  ) {
    this.knobs = tripTrafficFor(trip);
    this.straight = this.knobs.start === 'straight';
    this.rng = mulberry32((seed ^ TRAFFIC_SEED_XOR) >>> 0);
    this.spawnT = TRAFFIC_GAP / this.knobs.traffic;
    this.seedInitialCars();
  }

  static forRide(seed: number, trip: string | null, plan: RoadPlan = RoadPlan.forSeed(seed, trip)): TrafficSimulator {
    return new TrafficSimulator(seed, trip, plan);
  }

  private pick(weights: Readonly<Record<string, number>>, filter: (k: string) => boolean = () => true): string | null {
    const ks = Object.keys(weights).filter(filter), sum = ks.reduce((a, k) => a + (weights[k] ?? 0), 0);
    if (!ks.length || sum <= 0) return null;
    let r = this.rng() * sum;
    for (const k of ks) if ((r -= weights[k] ?? 0) <= 0) return k;
    return ks[ks.length - 1] ?? null;
  }

  private pickType(ok?: (k: string) => boolean): [string, string] | null {
    const filter = this.knobs.calm ? (k: string) => CALM_OK.includes(k) && (!ok || ok(k)) : ok;
    const entries = this.knobs.calm ? Object.entries(VEHICLES).filter(([, d]) => Object.keys(d.presets).some(filter!)) : Object.entries(VEHICLES);
    if (!entries.length) return null;
    const typeWeights = Object.fromEntries(entries.map(([k, d]) => [k, d.rare]));
    for (let i = 0; i < 4; i++) {
      const type = this.pick(typeWeights);
      if (!type) continue;
      const preset = this.pick(VEHICLES[type]!.presets, filter);
      if (preset) return [type, preset];
    }
    return null;
  }

  private lanesAt(s: number, dir: 1 | -1): number {
    return this.plan.layout.lanes(s, dir);
  }

  private spawnAt(type: string, preset: string, dir: 1 | -1, s: number, lat?: number): SimVehicle | null {
    const def = VEHICLES[type], P = PRESETS[preset];
    if (!def || !P) return null;
    const Sm = this.plan.layout.Sm;
    if (s < Sm - 1400 || (this.straight && s < Sm + 30)) return null;
    const n = this.lanesAt(s, dir);
    const lane = lat !== undefined ? 0 : P.speed < 1 || def.mass > 1.5 ? n - 1 - Math.floor(this.rng() * this.rng() * n) : Math.floor(this.rng() * n);
    const home = lat ?? laneLat(dir, lane);
    for (const o of this.cars) {
      if (Math.abs(o.lat - home) < 2.5 && Math.abs(o.s - s) < 40 + (o.def.len + def.len) / 2) return null;
    }
    const vDes = Math.min(34, (def.v[0] + this.rng() * (def.v[1] - def.v[0])) * P.speed);
    const pick = (this.rng() * 100) | 0, ph = this.rng() * 6.28;
    const a: SimVehicle = {
      id: ++this.ids, pick, def, P, preset, dir, s, sPrev: s, lat: home, latPrev: home, lane, target: home,
      lv: 0, v: vDes, vDes, lcT: 0, ph, t: 0, cool: 0, touch: 99, worst: 0, counted: false, over: false, dLat: null, dV: Number.POSITIVE_INFINITY, hz: false, state: 'drive',
    };
    this.cars.push(a);
    if (this.cars.length > this.activePeak) this.activePeak = this.cars.length;
    return a;
  }

  private spawnZone(zone: 'ahead' | 'behind' | 'oncoming', truckS: number, truckV: number): SimVehicle | null {
    const actualZone = this.knobs.calm && zone === 'behind' ? 'ahead' : zone;
    for (let i = 0; i < 3; i++) {
      const tp = this.pickType(actualZone === 'behind' ? (k) => BEHIND_OK.includes(k) : undefined);
      if (!tp) continue;
      const dir: 1 | -1 = actualZone === 'oncoming' ? -1 : 1;
      const early = truckS < this.plan.layout.Sm;
      const dist = actualZone === 'ahead' ? 300 + this.rng() * 300 : actualZone === 'behind' ? -(early ? 300 + this.rng() * 250 : 120 + this.rng() * 120) : 450 + this.rng() * 250;
      const a = this.spawnAt(tp[0], tp[1], dir, Math.max(truckS, this.plan.layout.Sm) + dist);
      if (a) {
        if (actualZone === 'behind') a.v = a.vDes = Math.max(a.vDes, truckV + 2 + this.rng() * 4);
        return a;
      }
    }
    return null;
  }

  private seedInitialCars(): void {
    const Sm = this.plan.layout.Sm, r = this.rng;
    const candidates: [1 | -1, number][] = [
      [1, Sm + 112 + r() * 10], [1, Sm + 420 + r() * 150], [-1, Sm + 260 + r() * 120],
      [-1, Sm + 650 + r() * 150], [1, Sm - 200 - r() * 120], [1, Sm - 520 - r() * 150], [-1, Sm - 140 - r() * 100],
    ];
    const picked = candidates.slice(0, Math.round(7 * Math.min(1, this.knobs.traffic))).filter(([, s]) => s > Sm);
    let firstAhead = true;
    for (const [dir, s] of picked) {
      if (firstAhead && dir > 0) {
        const a = this.spawnAt('sedan', 'cruise', 1, s, laneLat(1, 0));
        if (a) { a.v = a.vDes = 0.5; a.dV = 0.5; a.hz = true; firstAhead = false; }
        continue;
      }
      for (let i = 0; i < 3; i++) {
        const tp = this.pickType(), a = tp ? this.spawnAt(tp[0], tp[1], dir, s) : null;
        if (a) { if (dir > 0) a.v = a.vDes = Math.max(a.vDes, 21); break; }
      }
    }
  }

  clearStretch(s0: number, s1: number): void {
    for (let i = this.cars.length - 1; i >= 0; i--) if (this.cars[i]!.s >= s0 && this.cars[i]!.s <= s1) this.cars.splice(i, 1);
  }

  /** Steps traffic from `p` to `q` at 10 Hz (`dt = 0.1 s`) and performs swept continuous collision detection over `[p, q]`. */
  stepSamplePair(p: readonly number[], q: readonly number[], windowHullDrop?: number): TrafficContactEvent[] {
    const t0 = p[SAMPLE_T_COL]!, t1 = q[SAMPLE_T_COL]!, rawDt = t1 - t0;
    if (!(rawDt > 0 && rawDt <= 2)) return [];
    const dt = clamp(rawDt, 0.01, 0.25);
    const s0 = p[SAMPLE_S_COL]!, s1 = q[SAMPLE_S_COL]!, d0 = p[SAMPLE_D_COL]!, d1 = q[SAMPLE_D_COL]!;
    const v0 = p[SAMPLE_V_COL]!, v1 = q[SAMPLE_V_COL]!, hull0 = p[SAMPLE_HULL_COL]!, hull1 = q[SAMPLE_HULL_COL]!;
    const fork0 = p[SAMPLE_FORK_COL] ?? 0, fork1 = q[SAMPLE_FORK_COL] ?? 0;
    if (fork0 !== fork1 || this.plan.layout.forkSwitch(s0, s1)) {
      const seg = this.plan.layout.segAt(s1);
      if (seg.fork) this.clearStretch(seg.s0, seg.s1);
    }
    const vdRaw = (d1 - d0) / dt;
    const pose: TruckStepPose = {
      t: t1, s: s1, d: d1, psi: q[SAMPLE_PSI_COL]!, v: v1,
      vd: Math.sign(vdRaw) * Math.max(0, Math.abs(vdRaw) - 0.6), hull: hull1, fork: fork1,
    };

    if ((this.spawnT -= dt) <= 0) {
      this.spawnT = (TRAFFIC_GAP / this.knobs.traffic) * (0.6 + this.rng() * 0.8);
      if (this.cars.length < Math.round(TRAFFIC_MAX * this.knobs.traffic)) {
        const r = this.rng();
        const zone = this.straight && s1 < this.plan.layout.Sm + 30 ? 'ahead' : (r < 0.5 ? 'ahead' : 'oncoming');
        const a = this.spawnZone(zone, s1, v1);
        if (a && a.dir > 0) a.v = a.vDes = Math.max(a.vDes, v1 + 2);
      }
    }

    const stepContacts: TrafficContactEvent[] = [];
    const m = Math.max(s1, this.plan.layout.Sm), vTruck = Math.max(v0, v1);
    const hullDrop = Math.max(0, hull0 - hull1, windowHullDrop ?? 0);
    for (let i = this.cars.length - 1; i >= 0; i--) {
      const a = this.cars[i]!;
      a.sPrev = a.s; a.latPrev = a.lat; a.t += dt; a.touch += dt; a.cool = Math.max(0, a.cool - dt);
      this.think(a, dt, pose);
      if (a.s < m - 300 || a.s > m + 900 || a.s < (this.straight ? 40 : this.plan.layout.Sm - 1450)) {
        this.cars.splice(i, 1);
        continue;
      }
      if (vTruck >= 3 && s1 >= this.plan.layout.knownFrom && Math.abs(a.s - s1) < 35 + a.def.len) {
        const hit = this.sweptContact(a, t0, t1, s0, s1, d0, d1, vTruck, hullDrop);
        if (hit) { this.contacts.push(hit); stepContacts.push(hit); }
      }
    }
    return stepContacts;
  }

  private leadOf(a: SimVehicle, pose: TruckStepPose): { gap: number; raw: number; vl: number; who: 'car' | 'truck' } | null {
    let best: { gap: number; raw: number; vl: number; who: 'car' | 'truck' } | null = null;
    const see = (bs: number, lo: number, hi: number, bl: number, vl: number, margin: number, who: 'car' | 'truck') => {
      const rel = (bs - a.s) * a.dir;
      if (rel <= 0 || lo > a.lat + a.def.w / 2 + margin || hi < a.lat - a.def.w / 2 - margin) return;
      const raw = rel - (a.def.len + bl) / 2;
      if (!best || raw < best.raw) best = { gap: Math.max(raw, 0.3), raw, vl, who };
    };
    for (const b of this.cars) if (b !== a) see(b.s, b.lat - b.def.w / 2, b.lat + b.def.w / 2, b.def.len, a.dir * b.dir * b.v, 0.15, 'car');
    see(pose.s - (TRAILER_BACK - TRUCK_FRONT) / 2, pose.d - TRAILER_HALF_W, pose.d + TRAILER_HALF_W, TRUCK_FRONT + TRAILER_BACK, a.dir * pose.v, TRAFFIC_CLEAR, 'truck');
    return best;
  }

  private truckFree(a: SimVehicle, lat: number, pose: TruckStepPose, H = TRAFFIC_LOOK): boolean {
    const lo = pose.d - TRAILER_HALF_W, hi = pose.d + TRAILER_HALF_W, m = TRAFFIC_CLEAR + 0.1;
    if (lo > lat + a.def.w / 2 + m || hi < lat - a.def.w / 2 - m) return true;
    const bs = pose.s - (TRAILER_BACK - TRUCK_FRONT) / 2, bl = TRUCK_FRONT + TRAILER_BACK;
    const r0 = (bs - a.s) * a.dir, r1 = r0 + (a.dir * pose.v - a.v) * H, need = (a.def.len + bl) / 2 + 9;
    return r0 * r1 > 0 && Math.min(Math.abs(r0), Math.abs(r1)) >= need;
  }

  private laneFree(a: SimVehicle, lat: number, pose?: TruckStepPose): boolean {
    for (const b of this.cars) {
      if (b === a) continue;
      if (b.lat - b.def.w / 2 > lat + a.def.w / 2 + 0.6 || b.lat + b.def.w / 2 < lat - a.def.w / 2 - 0.6) continue;
      const r0 = (b.s - a.s) * a.dir, r1 = r0 + (b.dir * a.dir * b.v - a.v) * HORIZON, need = (a.def.len + b.def.len) / 2 + 9;
      if (!(r0 * r1 > 0 && Math.min(Math.abs(r0), Math.abs(r1)) >= need)) return false;
    }
    return !pose || this.truckFree(a, lat, pose, TRAFFIC_LOOK);
  }

  private dodgeHoles(a: SimVehicle, pose: TruckStepPose): void {
    if (a.dV <= 1) return; // stationary/crawl lead vehicle stays put in its lane
    a.dLat = null; a.dV = Number.POSITIVE_INFINITY; a.hz = false;
    const look = HOLE_WARN + 10 + a.v * 2, w = a.def.w / 2 + HOLE_MARGIN;
    const hs = this.plan.holesNear(a.dir > 0 ? a.s - 15 : a.s - look, a.dir > 0 ? a.s + look : a.s + 15);
    if (!hs.length) return;
    const active = hs.filter((h) => { const rel = (h.s - a.s) * a.dir; return rel >= -(a.def.len / 2 + 4.5) && rel <= look; });
    if (!active.length) return;
    a.hz = true;
    const blocked = (lat: number) => active.some((h) => {
      const spec = HOLE_TYPES[h.type];
      const hw = spec ? Math.max(...spec.ells.map((e) => Math.abs(e.dl) + e.b)) : 1.8;
      return lat + w > h.lat - hw && lat - w < h.lat + hw;
    });
    if (!blocked(a.target)) return;
    const [leftEdge, rightEdge] = this.plan.layout.edges(a.s);
    const side = Math.sign(a.target) || 1;
    const lo = side > 0 ? 0.25 + a.def.w / 2 : leftEdge - 0.2 + a.def.w / 2;
    const hi = side > 0 ? rightEdge + 0.2 - a.def.w / 2 : -0.25 - a.def.w / 2;
    for (let k = 0; k <= 40; k++) {
      for (const sg of k ? [1, -1] : [1]) {
        const c = a.target + sg * k * 0.15;
        if (c >= lo && c <= hi && !blocked(c) && ((Math.abs(c - a.target) < 2 && this.truckFree(a, c, pose, 4)) || this.laneFree(a, c, pose))) {
          a.dLat = c;
          return;
        }
      }
    }
    a.dV = Math.min(a.dV, 4);
  }

  private think(a: SimVehicle, dt: number, pose: TruckStepPose): void {
    if (a.state === 'crashed') { a.v = approach(a.v, 0, 4, dt); a.s += a.dir * a.v * dt; return; }
    a.target = a.over ? laneLat(-a.dir, 0) : laneLat(a.dir, a.lane);
    this.dodgeHoles(a, pose);
    const n = this.lanesAt(a.s, a.dir), nAhead = this.lanesAt(a.s + a.dir * 150, a.dir);
    if (a.lane >= nAhead && this.laneFree(a, laneLat(a.dir, nAhead - 1), pose)) a.lane = nAhead - 1;
    const lead = this.leadOf(a, pose);
    if (a.P.over && (a.lcT -= dt) <= 0) {
      a.lcT = 0.5;
      const slow = lead && lead.gap < 50 && lead.vl < a.vDes - 3;
      if (n >= 2) {
        a.over = false;
        if (slow && a.lane > 0 && this.laneFree(a, laneLat(a.dir, a.lane - 1), pose)) a.lane--;
        else if (!slow && a.lane < Math.min(n, nAhead) - 1 && this.rng() < 0.2 && this.laneFree(a, laneLat(a.dir, a.lane + 1), pose)) a.lane++;
      }
    }
    const aMax = 2.5, b = 3.5, v = a.v;
    let acc = aMax * (1 - (v / Math.max(0.1, Math.min(a.vDes, a.dV))) ** 4);
    if (lead) {
      const sStar = 2 + v * a.P.T + (v * (v - lead.vl)) / (2 * Math.sqrt(aMax * b));
      acc -= aMax * (Math.max(sStar, 0) / lead.gap) ** 2;
    }
    acc = clamp(acc, -9, aMax);
    a.v = Math.max(0, v + acc * dt);
    const want = (a.dLat ?? a.target) + (a.P.weave && !a.hz ? Math.sin(a.t * 0.9 + a.ph) * a.P.weave : 0);
    a.lv = approach(a.lv, clamp((want - a.lat) * 1.2, -1.8, 1.8), 3, dt);
    a.lat += a.lv * dt;
    a.s += a.dir * a.v * dt;
  }

  /** Swept continuous collision test along the 0.1 s step [t0, t1]: delegates 4-sub-instant cab + trailer geometry to checkTruckTrafficSwept in @freightchain/shared. */
  private sweptContact(
    a: SimVehicle, t0: number, t1: number, s0: number, s1: number, d0: number, d1: number, vTruck: number, hullDrop: number,
  ): TrafficContactEvent | null {
    if (a.cool > 0) return null;
    const hit = checkTruckTrafficSwept(a, s0, s1, d0, d1, vTruck);
    if (!hit) return null;
    if (a.touch > TRAFFIC_RUB_GAP) { a.worst = 0; a.counted = false; }
    a.touch = 0; a.cool = 0.8;
    if (hit.kind === 'crash' || hit.kind === 'bump') a.state = 'crashed';
    const pay = Math.max(0, hit.expectedDamage - a.worst);
    if (pay > 0.05) a.worst = hit.expectedDamage;
    const ignored = hit.kind === 'crash' ? hullDrop < 15 : hit.kind === 'bump' && hit.rel > TRUCK_FRONT / 2 && pay >= 2 && hullDrop < pay * 0.25;
    return {
      vehicleId: a.id, vehicleType: a.def.type, vehicleName: a.def.name, kind: hit.kind,
      t: Math.round((t0 + (t1 - t0) * hit.bestAlpha) * 100) / 100, s: Math.round(hit.ts * 10) / 10, d: Math.round(hit.td * 100) / 100,
      vehicleS: Math.round(hit.cs * 10) / 10, vehicleLat: Math.round(hit.cl * 100) / 100,
      closingSpeed: Math.round(hit.closing * 100) / 100, overlapFraction: Math.round(hit.overlapFraction * 100) / 100,
      expectedDamage: Math.round(hit.expectedDamage * 10) / 10, actualHullDrop: Math.round(hullDrop * 10) / 10, ignored,
    };
  }

  summary(): TrafficSimSummary {
    return {
      spawned: this.ids, activePeak: this.activePeak, contacts: this.contacts,
      ignoredCrashes: this.contacts.filter((c) => c.kind === 'crash' && c.ignored).length,
      ignoredBumps: this.contacts.filter((c) => c.kind !== 'crash' && c.ignored).length,
    };
  }
}

export const maxSpeedFor = (): number => MAX_SPEED;
