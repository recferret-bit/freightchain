import { CFG } from '../config.js';
import { net } from './network.js';
import { trip } from '../trips.js';
import { HOLES, rollChunkHole, shapeHole as shape } from '../../shared/road.js';
export { HOLES };

/* Road holes as DATA (no three.js – world/holes.js draws them, sim/damage.js drives over them, sim/traffic.js steers round them).
   WHERE the natural holes are is the server's call: a pure function of the ride's seed, which the server rebuilds on its own
   (server/src/domain/road/road-plan.ts) and hands out as the ride's OBSTACLE PLAN (GET /api/watch/:id/road, js/road-plan.js). An online ride and a replay
   use that plan; the local roll below is the same shared function (shared/road.js rollChunkHole), used offline and as a fallback for a stretch whose plan
   has not arrived yet (it never differs – `plan.mismatches` counts it if it ever did, and server/test/unit/domain/road/road-drift.spec.ts runs this file).
   The server judges the recording against ITS plan (verdict/world-checks.ts): a game that leaves a hole out still drove over the server's hole.
   Footprint: ells = ellipses { ds (along road, + = forward), dl (across, + = right), a (half length), b (half width) } relative to the hole's centre (s, lat).
   dmg = hull % per wheel-axle entry at 28 m/s (× (v/28)², rear axles ×.6), slow = speed fraction lost, jolt = cab shake, kick = steering pull, crawl = m/s the AI drops to when it can't get around.
   Shared table in shared/road.js (e.g. sinkhole: { name: 'SINKHOLE', ells: [{ ds: 0, dl: 0, a: 2, b: 2 }], dmg: 14, slow: .35, jolt: 1, kick: .1, crawl: 3, lane: true, cones: true }). */
const CH = CFG.CHUNK_LEN;

/* the server's plan for the ride being driven / watched: chunk index → hole | null, per seed; `windows` = the [from, to) stretches it covers */
export const plan = { seed: null, holes: new Map(), windows: [], fallback: new Set(), mismatches: [] };   // fallback: chunks the local roll had to answer for (no plan there yet)
const cache = new Map(), placed = new Map();   // cache: the local roll · placed: holes a spectator paid for (live streams), next to the chunk's own hole


/** the game's own roll for chunk ci – shared/road.js rollChunkHole */
export function rollHole(ci) {
  if (cache.has(ci)) return cache.get(ci);
  const raw = CFG.HOLES ? rollChunkHole(ci, net, CFG.HOLE_CHANCE * (trip.road?.holeChance ?? 1), trip.holesFrom ?? CFG.HOLE_FIRST) : null;
  const h = raw ? shape(raw.id, raw.ci, raw.type, raw.s, raw.lat) : null;
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
