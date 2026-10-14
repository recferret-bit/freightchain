import { clamp, rnd } from './prng.js';

/* Shared road network, pattern, fork, obstacle, and hole-damage rules used by both client/ and server/. */

export const CHUNK_LEN = 32;
export const START_ACCESS = 190;
export const START_TURN_R = 22;
export const SIGNAL_GREEN = [16, 26];
export const SIGNAL_CROSS = [9, 14];
export const SIGNAL_AMBER = 3;
export const SIGNAL_CLEAR = 2;
export const HOLES_ON = true;
export const HOLE_CHANCE = 0.045;
export const HOLE_FIRST = 150;
export const OFFROAD_FAIL_SECONDS = 20;
export const HOLE_REF_SPEED = 28;

export const LANE0 = 2.4;
export const LW = 4.2;
export const TAPER = 120;
export const SHOULDER = 1.2;
export const SIDE_LEN = 450;

export const edgeOf = n => 4.5 + (n - 1) * LW;
export const laneLat = (dir, i) => dir * (LANE0 + i * LW);

export const FORK_LEN = 1200;
export const FORK_SWITCH_REACH = 1.5;
export const FORK_SWITCH_JUMP = 4;
export const FORK = { len: FORK_LEN, bulge: 0.55, commit: 205, corridor: 15, reach: FORK_SWITCH_REACH };
export const FORK_RULES = { len: FORK.len, commit: FORK.commit, corridor: FORK.corridor };

export const PATTERNS = {
  country:  { name: 'COUNTRY ROAD', lanes: [[1, 1, 1]], seg: [700, 1600], len: [900, 2400], bends: 1, centre: null, junction: { gap: [420, 950], cross: 0.5, signal: 0.35, side: [1, 1, 2] } },
  highway:  { name: 'HIGHWAY', lanes: [[2, 2, 3], [3, 3, 1], [3, 2, 1], [2, 3, 1]], seg: [500, 1100], len: [1600, 3600], bends: 0.55, centre: 'double', junction: null },
  arterial: { name: 'ARTERIAL', lanes: [[2, 2, 3], [2, 1, 1], [1, 2, 1], [3, 3, 1]], seg: [400, 900], len: [800, 1700], bends: 0.35, centre: 'double', junction: { gap: [260, 520], cross: 0.85, signal: 0.9, side: [1, 2] } },
  town:     { name: 'TOWN', lanes: [[1, 1, 2], [2, 2, 1]], seg: [300, 700], len: [500, 1100], bends: 0.15, centre: null, junction: { gap: [170, 320], cross: 0.7, signal: 0.75, side: [1] } },
  dual:     { name: 'DUAL ROAD', lanes: [[2, 2, 1]], seg: [700, 1500], len: [1500, 3200], bends: 0.6, centre: 'double', junction: null },
  fork:     { name: 'COUNTRY ROAD', lanes: [[1, 1, 1]], seg: [FORK_LEN, FORK_LEN], len: [FORK_LEN, FORK_LEN], bends: 0, centre: null, junction: null, fork: true },
  open:     { name: 'COUNTRY ROAD', lanes: [[1, 1, 1]], seg: [500, 500], len: [500, 500], bends: 1, centre: null, junction: null },
  xroad:    { name: 'COUNTRY ROAD', lanes: [[1, 1, 1]], seg: [500, 500], len: [500, 500], bends: 1, centre: null, junction: { gap: [380, 500], cross: 1, signal: 0.5, side: [1, 1, 2] } },
  xroad4:   { name: 'DUAL ROAD', lanes: [[2, 2, 1]], seg: [500, 500], len: [500, 500], bends: 0.6, centre: 'double', junction: { gap: [380, 500], cross: 1, signal: 0.5, side: [1, 1, 2] } },
};

export const ROAD_PATTERNS = /* @__PURE__ */ (() => Object.fromEntries(
  Object.entries(PATTERNS).map(([id, p]) => [
    id,
    { lanes: p.lanes, seg: p.seg, len: p.len, bends: p.bends, junction: p.junction, ...(p.fork ? { fork: true } : {}) },
  ]),
))();

export const DEFAULT_WEIGHTS = { country: 3, highway: 1, arterial: 1, town: 1 };
export const DEFAULT_FIRST_LEN = [500, 1100];

export const TRIP_HOLE_FIRST = {
  free: 1200,
  'free-1': 1200,
  'free-2': 400,
  'free-g': 2500,
  'free-1b': 4000,
  'free-2b': 400,
  'free-1c': 4000,
  'free-2c': 400,
};
export const holeFirstOf = trip => (trip !== null && trip !== undefined ? TRIP_HOLE_FIRST[trip] : undefined) ?? HOLE_FIRST;

export const TRIP_ROADS = {
  'free-1':  { first: ['dual'], weights: { dual: 1 }, holeChance: 1, firstLen: DEFAULT_FIRST_LEN },
  'free-2':  { first: ['country', 'fork'], weights: { country: 3, arterial: 1, town: 1, fork: 2 }, holeChance: 1.5, firstLen: DEFAULT_FIRST_LEN },
  'free-3':  { first: ['country', 'fork'], weights: { country: 3, highway: 1, arterial: 1.5, town: 1.5, fork: 1.5 }, holeChance: 2, firstLen: DEFAULT_FIRST_LEN },
  'free-g':  { first: ['xroad4'], weights: { dual: 1 }, holeChance: 1, firstLen: [500, 500] },
  'free-1b': { first: ['xroad4'], weights: { dual: 1 }, holeChance: 1, firstLen: [500, 500] },
  'free-2b': { first: ['open', 'xroad', 'fork', 'xroad', 'xroad', 'xroad'], weights: { open: 2, highway: 1 }, holeChance: 1.5, firstLen: [450, 450] },
  'free-3b': { first: ['open', 'xroad', 'highway', 'xroad', 'fork', 'xroad', 'xroad', 'fork', 'xroad', 'xroad'], weights: { open: 2, highway: 1 }, holeChance: 2, firstLen: [450, 450] },
  'free-1c': { first: ['xroad4', 'xroad4'], weights: { dual: 1 }, holeChance: 1, firstLen: [500, 500] },
  'free-2c': { first: ['open', 'xroad', 'fork', 'xroad', 'xroad'], weights: { open: 2, highway: 1 }, holeChance: 1.5, firstLen: [450, 450] },
};
export const tripRoadOf = trip => (trip !== null && trip !== undefined ? TRIP_ROADS[trip] : undefined) ?? { first: ['country'], weights: DEFAULT_WEIGHTS, holeChance: 1, firstLen: DEFAULT_FIRST_LEN };

export const HOLES = {
  pothole:  { name: 'POTHOLE',   ells: [{ ds: 0, dl: 0, a: 0.6, b: 0.5 }], dmg: 2.5, slow: 0.04, jolt: 0.5, kick: 0.03, crawl: 7 },
  deep:     { name: 'DEEP HOLE', ells: [{ ds: 0, dl: 0, a: 0.85, b: 0.8 }], dmg: 7, slow: 0.12, jolt: 0.9, kick: 0.07, crawl: 5 },
  cluster:  { name: 'HOLES',     ells: [{ ds: -3, dl: -0.9, a: 0.5, b: 0.45 }, { ds: 0, dl: 0.8, a: 0.6, b: 0.5 }, { ds: 3, dl: -0.3, a: 0.5, b: 0.45 }], dmg: 1.8, slow: 0.03, jolt: 0.45, kick: 0.03, crawl: 7 },
  trench:   { name: 'TRENCH',    ells: [{ ds: 0, dl: 0, a: 0.45, b: 2.3 }], dmg: 6, slow: 0.15, jolt: 1, kick: 0.02, crawl: 4, lane: true },
  sinkhole: { name: 'SINKHOLE',  ells: [{ ds: 0, dl: 0, a: 2, b: 2 }], dmg: 14, slow: 0.35, jolt: 1, kick: 0.1, crawl: 3, lane: true, cones: true },
};

export const HOLE_TYPES = /* @__PURE__ */ (() => Object.fromEntries(
  Object.entries(HOLES).map(([id, h]) => [id, { ells: h.ells, dmg: h.dmg, slow: h.slow, lane: !!h.lane, cones: !!h.cones }]),
))();

export const CONE_HOLE_IDS = ['sinkhole'];

/** Shared deterministic hole roll for chunk `ci` on road layout `net`. */
export function rollChunkHole(ci, net, holeChance = HOLE_CHANCE, holeFirst = HOLE_FIRST, maxS = Infinity) {
  if (ci < 0) return null;
  const q = k => rnd(ci * 97.13 + k * 3.71), s = ci * CHUNK_LEN + 4 + q(1) * 24;
  if (!(s < maxS && q(2) < holeChance && s >= net.Sm + holeFirst && net.plain(s, 70))) return null;
  const type = CONE_HOLE_IDS[Math.floor(q(3) * CONE_HOLE_IDS.length)], T = HOLES[type], r = q(4), j = q(5) - 0.5;
  const dir = T.lane ? (r < 0.7 ? 1 : -1) : r < 0.6 ? 1 : -1, lane = laneLat(dir, Math.floor(q(6) * net.lanes(s, dir)));
  const lat = T.lane ? lane : r < 0.85 ? lane + j * 1.6 : j * 1.2;
  return { id: 'h' + ci, ci, type, s, lat };
}

export const AXLES = [2.2, -0.4, -11.5];
export const WHEEL = 1;
export const REAR_AXLE_SHARE = 0.6;
export const CRAWL_SPEED = 3;
export const MIN_HURT = 0.3;

export function holeDamage(type, v, axle) {
  if (v < CRAWL_SPEED) return 0;
  const sc = clamp(v / HOLE_REF_SPEED, 0, 1.2) ** 2 * (axle ? REAR_AXLE_SHARE : 1);
  const dmg = type.dmg * sc;
  return dmg >= MIN_HURT ? dmg : 0;
}

export const ROAD_PLAN_MAX_SPAN = 10000;
export const ROAD_PLAN_WINDOW = 6000;
export const ROAD_PLAN_MAX_S = 1000000;
