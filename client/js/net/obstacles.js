import { CFG } from '../config.js';
import { rnd } from '../util.js';
import { net, laneLat } from './network.js';
import { trip } from '../trips.js';

/* Road holes as DATA (no three.js – world/holes.js draws them, sim/damage.js drives over them, sim/traffic.js steers round them).
   WHERE the natural holes are is the server's call: a pure function of the ride's seed, which the server rebuilds on its own
   (server/src/domain/road/road-plan.ts) and hands out as the ride's OBSTACLE PLAN (GET /api/watch/:id/road, js/road-plan.js). An online ride and a replay
   use that plan; the local roll below is the same function, used offline and as a fallback for a stretch whose plan has not arrived yet (it never
   differs – `plan.mismatches` counts it if it ever did, and server/test/unit/domain/road/road-drift.spec.ts runs this file next to the server's port).
   The server judges the recording against ITS plan (verdict/world-checks.ts): a game that leaves a hole out still drove over the server's hole.
   Footprint: ells = ellipses { ds (along road, + = forward), dl (across, + = right), a (half length), b (half width) } relative to the hole's centre (s, lat).
   dmg = hull % per wheel-axle entry at 28 m/s (× (v/28)², rear axles ×.6), slow = speed fraction lost, jolt = cab shake, kick = steering pull, crawl = m/s the AI drops to when it can't get around.
   Only types with `cones` are rolled onto the road; the others are what spectators can pay for. Keep in step with server/src/domain/road/road-rules.ts. */
const CH = CFG.CHUNK_LEN;
export const HOLES = {
  pothole: { name: 'POTHOLE',  ells: [{ ds: 0, dl: 0, a: .6, b: .5 }], dmg: 2.5, slow: .04, jolt: .5, kick: .03, crawl: 7 },   // fits between the wheel tracks if you straddle it
  deep:    { name: 'DEEP HOLE', ells: [{ ds: 0, dl: 0, a: .85, b: .8 }], dmg: 7, slow: .12, jolt: .9, kick: .07, crawl: 5 },
  cluster: { name: 'HOLES',    ells: [{ ds: -3, dl: -.9, a: .5, b: .45 }, { ds: 0, dl: .8, a: .6, b: .5 }, { ds: 3, dl: -.3, a: .5, b: .45 }], dmg: 1.8, slow: .03, jolt: .45, kick: .03, crawl: 7 },   // each pit hits separately
  trench:  { name: 'TRENCH',   ells: [{ ds: 0, dl: 0, a: .45, b: 2.3 }], dmg: 6, slow: .15, jolt: 1, kick: .02, crawl: 4, lane: true },   // lane-wide: change lanes or slow down
  sinkhole: { name: 'SINKHOLE', ells: [{ ds: 0, dl: 0, a: 2, b: 2 }], dmg: 14, slow: .35, jolt: 1, kick: .1, crawl: 3, lane: true, cones: true },
};
const IDS = Object.keys(HOLES).filter(k => HOLES[k].cones);

/* the server's plan for the ride being driven / watched: chunk index → hole | null, per seed; `windows` = the [from, to) stretches it covers */
export const plan = { seed: null, holes: new Map(), windows: [], fallback: new Set(), mismatches: [] };   // fallback: chunks the local roll had to answer for (no plan there yet)
const cache = new Map(), placed = new Map();   // cache: the local roll · placed: holes a spectator paid for (live streams), next to the chunk's own hole

const shape = (id, ci, type, s, lat) => { const T = HOLES[type]; return { id, ci, type, s, lat, ells: T.ells, l0: lat + Math.min(...T.ells.map(e => e.dl - e.b)), l1: lat + Math.max(...T.ells.map(e => e.dl + e.b)), ext: Math.max(...T.ells.map(e => Math.abs(e.ds) + e.a)) }; };

/** the game's own roll for chunk ci – pure: the seed's layout (net) + a hash of the chunk index. The server's road-plan.ts is the same function. */
export function rollHole(ci) {
  if (cache.has(ci)) return cache.get(ci);
  let h = null; const q = k => rnd(ci * 97.13 + k * 3.71), s = ci * CH + 4 + q(1) * 24;   // (rnd on ci*13+k clusters badly: sin hash)
  if (CFG.HOLES && ci >= 0 && q(2) < CFG.HOLE_CHANCE * (trip.road?.holeChance ?? 1) && s >= net.Sm + (trip.holesFrom ?? CFG.HOLE_FIRST) && net.plain(s, 70)) {   // never on the depot road (nor, on the free run, within its reach – trips.js holesFrom), at a junction or in a lane taper
    const type = IDS[Math.floor(q(3) * IDS.length)], T = HOLES[type], r = q(4), j = q(5) - .5, dir = T.lane ? (r < .7 ? 1 : -1) : r < .6 ? 1 : -1, lane = laneLat(dir, Math.floor(q(6) * net.lanes(s, dir)));
    const lat = T.lane ? lane : r < .85 ? lane + j * 1.6 : j * 1.2;   // lane-wide: own side 70 %; small: own side 60 %, oncoming 25 %, centre line 15 %
    h = shape('h' + ci, ci, type, s, lat);
  }
  cache.set(ci, h); return h;
}
/** the natural hole of chunk ci: the server's plan where it has arrived, else the local roll */
export function naturalHole(ci) {
  if (plan.seed !== null && plan.seed === net.seed) { const h = plan.holes.get(ci); if (h !== undefined) return h; plan.fallback.add(ci); }
  return rollHole(ci);
}
/** chunk ci's holes: its natural one and/or one a spectator paid for */
export function holesIn(ci) {
  const h = naturalHole(ci), p = placed.get(ci);
  return h && p ? [h, p] : h ? [h] : p ? [p] : [];
}
/** the first hole of chunk ci (traffic / debugging) */
export const holeAt = ci => holesIn(ci)[0] ?? null;
export function holesNear(s0, s1) {
  const out = [];
  for (let ci = Math.floor((s0 - 8) / CH); ci <= Math.floor((s1 + 8) / CH); ci++) out.push(...holesIn(ci));
  return out;
}
export const clearHoleCache = () => { cache.clear(); placed.clear(); };   // new road layout (net/orchestrator.js), or CFG.HOLES / HOLE_CHANCE / HOLE_FIRST changed at runtime (debug); the plan stays – it is per seed

/** The server's plan for one stretch (js/road-plan.js fetched it): installs it for its seed and returns the chunk indices whose hole changed, so the
    caller can rebuild what is already built. A plan for another seed than the road's is refused (null). A hole the server has and the local roll has
    not – or the other way round – is counted in plan.mismatches (it should never happen: the two are the same function). */
export function installPlan(dto) {
  if (!dto || !Number.isFinite(dto.seed) || dto.seed >>> 0 !== net.seed) return null;
  if (plan.seed !== net.seed) { plan.seed = net.seed; plan.holes.clear(); plan.windows = []; plan.fallback.clear(); plan.mismatches = []; }
  const byCi = new Map(dto.holes.filter(h => HOLES[h.type]).map(h => [h.ci, shape(h.id, h.ci, h.type, h.s, h.lat)])), changed = [];
  for (let ci = Math.floor(dto.from / CH); ci * CH < dto.to; ci++) {
    const mine = rollHole(ci), theirs = byCi.get(ci) ?? null, before = plan.holes.has(ci) ? plan.holes.get(ci) : mine;
    if (!same(mine, theirs)) { plan.mismatches.push(ci); console.warn(`road plan: chunk ${ci} – the server has ${theirs ? theirs.type + ' at ' + theirs.s.toFixed(1) : 'no hole'}, the local roll ${mine ? mine.type + ' at ' + mine.s.toFixed(1) : 'none'}; using the server's`); }
    if (!same(before, theirs)) changed.push(ci);
    plan.holes.set(ci, theirs);
  }
  plan.windows.push([dto.from, dto.to]);
  return changed;
}
const same = (a, b) => (!a && !b) || (!!a && !!b && a.type === b.type && Math.abs(a.s - b.s) < 1e-6 && Math.abs(a.lat - b.lat) < 1e-6);
/** how far ahead of s the plan is loaded without a gap (s itself when it is not) */
export function planCovers(s) {
  if (plan.seed !== net.seed) return s;
  let to = s;
  for (let moved = true; moved;) { moved = false; for (const [a, b] of plan.windows) if (a <= to && b > to) { to = b; moved = true; } }
  return to;
}

/* A spectator's obstacle (ui/live-feed.js on the driver's side, watch.js in a replay): `type` from HOLES at road position s / lateral lat, exactly where the
   driver's game put it – the stamp the server keeps – so every replay has it in the same place. It sits NEXT TO the chunk's own hole (never replaces one:
   the natural holes are the server's plan). Returns its chunk index (the caller rebuilds that chunk if built). */
export function placeHole(type, s, lat, id) {
  if (!HOLES[type]) return null;
  const ci = Math.floor(s / CH); placed.set(ci, shape(id ?? 'live' + ci, ci, type, s, lat)); return ci;
}
/* holes a replay marks red: the server measured that the truck drove through them without the damage the game takes (watch.js) – world/holes.js draws a
   red ring round them. Returns the hole's chunk index the first time (null when already flagged, or not a hole id). */
export const flagged = new Set();
export function flagHole(id) {
  const ci = /^h(\d+)$/.exec(id)?.[1];
  if (ci === undefined || flagged.has(id)) return null;
  flagged.add(id); return +ci;
}

/** the first chunk at or after s where a placed obstacle fits: past the depot turn, not at a junction or a lane taper (same rule as the natural holes), not
    on a chunk that has a hole of its own */
export function obstacleSpot(s) {
  for (let ci = Math.ceil(s / CH); ci < Math.ceil(s / CH) + 40; ci++) { const at = ci * CH + CH / 2; if (at >= net.Sm + CFG.HOLE_FIRST && net.plain(at, 70) && !placed.has(ci) && !naturalHole(ci)) return at; }
  return null;
}
