import { createRoadGeometry } from './road-geometry.js';
import { createRoadNetwork } from './road-network.js';
import { ROUTE_CURVATURE } from './route-curvature.js';
import { HOLE_CHANCE, ROAD_PLAN_MAX_S, CHUNK_LEN, holeFirstOf, rollChunkHole, tripRoadOf } from './road.js';

/* The 1h finish. Inputs are only the road seed, the trip and the rules version – not trafficSalt, mgSalt or holeSalt –
   so every rider of one pool (one roadSeed) gets the same line. V_BASE is 65 km/h on a clear straight (decision 38). */

export const FINISH_RULES_VERSION = 1;
export const V_BASE = 65 / 3.6; // m/s – 65 km/h (the spec's 18.06)
export const A_LAT = 2;
export const A_ACC = 1;
export const A_DEC = 2.5;
export const DS = 5;
export const T_TARGET = 3600;
export const T_START = 25;
export const MAX_SPEED = 28;
export const FINISH_MIN_M = 48_000;
export const FINISH_MAX_M = 65_000;
export const SNAP_CLEAR_M = 60;
export const SNAP_SHIFT_M = 300;
export const HOLE_PAD_M = 30;
const ROAD_CAP_M = ROAD_PLAN_MAX_S - 5000;

const ROAD_CFG = {
  START_TURN_R: 22, START_ACCESS: 190, START_FADE: 150,
  SIGNAL_GREEN: [16, 26], SIGNAL_CROSS: [9, 14], SIGNAL_AMBER: 3, SIGNAL_CLEAR: 2,
};
const ROUTE_IDS = ['route66', 'stuart', 'siberia', 'brenner', 'panamerican'];
const FREE_ROUTE = {
  free: 'stuart', 'free-1': 'stuart', 'free-1b': 'stuart', 'free-1c': 'stuart', 'free-g': 'stuart',
  'free-2': 'route66', 'free-2b': 'route66', 'free-2c': 'route66',
  'free-3': 'brenner', 'free-3b': 'brenner', 'free-3c': 'brenner',
};
/* bends / traffic / start mirror client/js/trips.js. Trip ids stay frozen; this table is only how the finish walk reads them. */
const TRIP_STYLE = {
  classic: { bends: 1, traffic: 1, start: 'depot' },
  free: { bends: 0.4, traffic: 0.4, start: 'straight' },
  'free-1': { bends: 0.5, traffic: 0.4, start: 'straight' },
  'free-2': { bends: 0.8, traffic: 0.7, start: 'depot' },
  'free-3': { bends: 1.3, traffic: 1.4, start: 'depot' },
  'free-g': { bends: 1.6, traffic: 0.4, start: 'straight' },
  'free-1b': { bends: 2, traffic: 0.4, start: 'straight' },
  'free-2b': { bends: 1.1, traffic: 0.7, start: 'depot' },
  'free-1c': { bends: 3, traffic: 0.4, start: 'straight' },
  'free-2c': { bends: 1.35, traffic: 0.8, start: 'depot' },
  'free-3b': { bends: 1.6, traffic: 1.4, start: 'depot' },
  'free-3c': { bends: 1.6, traffic: 1.4, start: 'depot' },
  '1h': { bends: 1, traffic: 1, start: 'depot' },
  '4h': { bends: 1.2, traffic: 1.4, start: 'depot' },
  '8h': { bends: 1.4, traffic: 1.8, start: 'depot' },
};
const F_PATTERN = { country: 1, highway: 1.05, arterial: 0.92, town: 0.8, dual: 1.02, fork: 0.88, open: 1, xroad: 0.9, xroad4: 0.92, access: 0.85 };

const NETS = new Map();
const FINISHES = new Map();

export function routeForFinish(seed, trip) {
  return FREE_ROUTE[trip] ?? ROUTE_IDS[(seed >>> 0) % ROUTE_IDS.length];
}

export function roadNetFor(roadSeed, trip) {
  const seed = roadSeed >>> 0, id = trip || 'classic', key = `${seed}:${id}`;
  const hit = NETS.get(key);
  if (hit) return hit;
  const style = TRIP_STYLE[id] ?? TRIP_STYLE['1h'];
  const road = tripRoadOf(id);
  const geometry = createRoadGeometry();
  const net = createRoadNetwork({
    config: ROAD_CFG, geometry,
    trip: { start: style.start, bends: style.bends, traffic: style.traffic, road },
  });
  net.setStyle({ curv: ROUTE_CURVATURE[routeForFinish(seed, id)] ?? (() => 0) });
  net.reset(seed);
  NETS.set(key, net);
  if (NETS.size > 24) NETS.delete(NETS.keys().next().value);
  return net;
}

function factorsAt(net, trip, s) {
  const seg = net.segAt(Math.max(s, net.Sm));
  const kappa = Math.abs(net.curv(s));
  const vCurve = kappa > 1e-4 ? Math.sqrt(A_LAT / kappa) : MAX_SPEED;
  const rx = Math.min(1, Math.max(0.45, vCurve / V_BASE)); // horizontal curvature: slower in a bend
  const rz = 1; // the spine has no grade; world z still comes from the (RX, RZ, RT) integration roadAt uses
  const lanes = (seg.nR ?? 1) + (seg.nL ?? 1);
  const fLanes = lanes >= 5 ? 1.04 : lanes >= 3 ? 1 : 0.95;
  const style = TRIP_STYLE[trip] ?? TRIP_STYLE['1h'];
  const rt = Math.min(1.08, Math.max(0.72, (F_PATTERN[seg.pat] ?? 1) * fLanes * (1.12 - 0.1 * style.traffic)));
  const v = Math.min(V_BASE * rx * rz * rt, vCurve, MAX_SPEED);
  return { rx, rz, rt, v: Math.max(4, v) };
}

function holesUntil(net, trip, maxS) {
  const road = tripRoadOf(trip);
  const chance = HOLE_CHANCE * (road.holeChance ?? 1);
  const first = holeFirstOf(trip);
  const out = [];
  const last = Math.min(maxS, ROAD_CAP_M);
  for (let ci = 0; ci * CHUNK_LEN < last; ci++) {
    const h = rollChunkHole(ci, net, chance, first, last);
    if (h) out.push(h);
  }
  return out;
}

function blocked(net, holes, s) {
  for (const j of net.near(s - SNAP_CLEAR_M, s + SNAP_CLEAR_M)) {
    if (j.kind === 'start') continue;
    if (Math.abs(s - j.s) < SNAP_CLEAR_M) return true;
    if (Math.abs(s - net.stopLine(j, 1)) < SNAP_CLEAR_M) return true;
    if (Math.abs(s - net.stopLine(j, -1)) < SNAP_CLEAR_M) return true;
  }
  for (const f of net.forksNear(s - SNAP_CLEAR_M, s + SNAP_CLEAR_M)) {
    if (s > f.f0 - SNAP_CLEAR_M && s < f.f1 + SNAP_CLEAR_M) return true;
  }
  for (const h of holes) if (Math.abs(h.s - s) <= HOLE_PAD_M) return true;
  return false;
}

/** First point at or past `sStar` (then back) that is clear of junctions, stop lines, forks and holes. Shift stays within 300 m when it can. */
export function snapSafe(net, holes, sStar) {
  const local = holes.filter((h) => Math.abs(h.s - sStar) < 4000);
  const tryAt = (s) => s >= net.Sm + SNAP_CLEAR_M && s <= ROAD_CAP_M && !blocked(net, local, s);
  for (let d = 0; d <= SNAP_SHIFT_M; d += 1) if (tryAt(sStar + d)) return sStar + d;
  for (let d = 1; d <= 1600; d += 1) if (tryAt(sStar + SNAP_SHIFT_M + d)) return sStar + SNAP_SHIFT_M + d;
  for (let d = 1; d <= SNAP_SHIFT_M; d += 1) if (tryAt(sStar - d)) return sStar - d;
  return Math.min(ROAD_CAP_M, Math.max(net.Sm + SNAP_CLEAR_M, sStar));
}

function inBand(net, holes, s) {
  const clamped = Math.min(FINISH_MAX_M, Math.max(FINISH_MIN_M, s));
  if (!blocked(net, holes, clamped) && clamped <= ROAD_CAP_M) return clamped;
  return snapSafe(net, holes, clamped);
}

export function finishBlocked(roadSeed, trip, s) {
  const id = trip || 'classic';
  const net = roadNetFor(roadSeed, id);
  return blocked(net, holesUntil(net, id, s + HOLE_PAD_M + 1), s);
}

function lss(v) { return (v / 2) * (1 / A_DEC + 1 / A_ACC); }

export function finishFor(roadSeed, trip, finishRulesVersion = FINISH_RULES_VERSION) {
  if (finishRulesVersion !== FINISH_RULES_VERSION) throw new Error(`unknown finish rules ${finishRulesVersion}`);
  const id = trip || 'classic';
  const seed = roadSeed >>> 0;
  const key = `${seed}:${id}:${finishRulesVersion}`;
  const cached = FINISHES.get(key);
  if (cached) return cached;
  const net = roadNetFor(seed, id);
  const holes = holesUntil(net, id, FINISH_MAX_M + 2000);
  let s = net.Sm;
  let v = 0;
  let T = T_START + 3 * (30 + lss(V_BASE)); // fixed minigame allowance, the same for every rider
  let rx = 0, rz = 0, rt = 0, n = 0;
  let lastJ = '';
  let lastFork = null;
  while (T < T_TARGET && s < FINISH_MAX_M + DS) {
    const f = factorsAt(net, id, s);
    const vNext = f.v >= v ? Math.min(f.v, v + A_ACC * (DS / Math.max(v, 1))) : Math.max(f.v, v - A_DEC * (DS / Math.max(v, 1)));
    const vStep = Math.max(1, (v + vNext) / 2);
    T += DS / vStep;
    for (const j of net.near(s, s + DS)) {
      if (j.kind === 'start' || j.id === lastJ || j.s < s || j.s >= s + DS) continue;
      lastJ = j.id;
      if (j.signal && j.cyc) {
        const pNg = (j.cyc.T - j.cyc.g) / j.cyc.T;
        const W = (j.cyc.T - j.cyc.g) / 2;
        T += pNg * (W + lss(vStep));
      } else T += 2;
    }
    const fork = net.forkAt(s + DS);
    if (fork && fork !== lastFork) { T += 3; lastFork = fork; }
    rx += f.rx; rz += f.rz; rt += f.rt; n += 1;
    v = vNext;
    s += DS;
  }
  // world() integrates the spine (RX, RZ, RT) from the same curv() the walk used.
  const pose = net.world(s, 0);
  if (!Number.isFinite(pose.x) || !Number.isFinite(pose.z)) throw new Error('finish spine did not integrate');
  const star = snapSafe(net, holes, s);
  const finishS = inBand(net, holes, star);
  if (!(finishS <= ROAD_CAP_M)) throw new Error('finish past the road plan');
  const result = {
    finishS, expectedSeconds: T, finishRulesVersion,
    rx: n ? rx / n : 1, rz: n ? rz / n : 1, rt: n ? rt / n : 1,
  };
  FINISHES.set(key, result);
  if (FINISHES.size > 64) FINISHES.delete(FINISHES.keys().next().value);
  return result;
}
