import { CFG } from '../config.js';
import { clamp, approach, mulberry32 } from '../util.js';
import { st } from '../state.js';
import { roadAt } from '../road.js';
import { net, laneLat, edgeOf } from '../net/network.js';
import { VEHICLES, buildVehicle, removeVehicle } from '../world/vehicles.js';
import { hurt } from './damage.js';
import { audio } from './audio.js';
import { HOLES, holesNear } from '../world/holes.js';

/* Moving traffic: vehicle types live in world/vehicles.js, behaviour in the PRESETS below. Each vehicle is a plain record in the coordinates of ITS road
   (s along it, lat + = right) driven by an IDM-style car-follower plus lane rules. Roads (net/network.js):
   - MAIN: the main road = the spine from net.Sm on, a straight line behind the depot turn (so cars stream past the depot exit). 1-3 lanes per direction:
     lane i of direction dir is at laneLat(dir, i) (inner lane ±2.4). Overtaking: a free lane to the left on multi-lane roads, the oncoming lane on 1+1 roads.
   - the side road of a signalled crossroads (net.lineOf(j)): cross traffic, `CFG.CROSS_MAX` per junction, crossing the spine on its green.
   Signals: a red / amber (if it can still stop) light ahead = a stationary obstacle at the stop line; green waits while the box is still occupied.
   The truck is an obstacle for every road: the axis-aligned box of its cab + trailer corners in that road's coordinates (so a truck turning across the main
   road or standing in a crossroads box blocks the lanes it covers). Not deterministic/replayable: floats + variable dt (the PRNG itself is seeded per ride). */

const TRUCK_FRONT = 3.3, CAB_BACK = 1.6, HITCH = 1.2, TRAILER_BACK = 14.7, HORIZON = 10;   // metres from the driver's eye; s lookahead for lane changes
/* behaviour presets: speed = × the type's cruise speed, T = desired time headway (s), over = may change lanes to pass slower traffic, weave = lateral wobble amplitude (m), siren = flashing lights */
const PRESETS = {
  cruise:    { speed: 1,    T: 1.6 },
  slow:      { speed: .6,   T: 1.8 },
  tailgate:  { speed: 1.15, T: .3 },
  overtake:  { speed: 1.1,  T: 1.2, over: true },
  weave:     { speed: .95,  T: 1.5, weave: 1.7 },
  emergency: { speed: 1.05, T: .8,  over: true, siren: true },
};
const BEHIND_OK = ['tailgate', 'overtake', 'emergency'], CROSS_OK = ['cruise', 'slow', 'tailgate'];   // presets for vehicles spawning behind the truck / on side roads
export const cars = [];   // live vehicles (debug handle: window.__game.traffic)
export const MAIN = { main: true, at: m => net.mainAt(m), coords: (x, z, hint) => net.mainCoords(x, z, hint) };
const T = { rng: Math.random, seed: 0, spawnT: 0, cross: new Map(), ids: 0 };   // ids: a stable number per vehicle for the recording (no rng draw)
const TK = { pts: [], x: 0, z: 0, vx: 0, vz: 0, th: 0, m: 0 };   // the truck this step: world corners, eye, velocity, heading, main-road coordinate

const bumpDmg = (def, closing) => Math.min(25, 4 * def.mass * (closing / CFG.CRASH_CLOSING) ** 2 + .5);   // hull % lost in a bump: ∝ mass · closing speed²
function pick(weights, filter = () => true) {
  const ks = Object.keys(weights).filter(filter), sum = ks.reduce((a, k) => a + weights[k], 0); if (!ks.length) return null;
  let r = T.rng() * sum; for (const k of ks) if ((r -= weights[k]) <= 0) return k; return ks[ks.length - 1];
}
const laneCount = (a, s) => a.road.main ? net.lanes(s, a.dir) : a.road.j.sl;

/* ───────────────────────── the truck as an obstacle ───────────────────────── */
function truckPose() {
  const p = roadAt(st.s), th = p.t + st.psi, ex = p.x + Math.cos(p.t) * st.d, ez = p.z + Math.sin(p.t) * st.d, fx = Math.sin(th), fz = -Math.cos(th), rx = Math.cos(th), rz = Math.sin(th);
  TK.pts.length = 0;
  for (const f of [TRUCK_FRONT, -CAB_BACK]) for (const r of [-1.25, 1.25]) TK.pts.push([ex + fx * f + rx * r, ez + fz * f + rz * r]);
  const hx = ex - fx * HITCH, hz = ez - fz * HITCH, ty = st.tyaw, L = TRAILER_BACK - HITCH;
  for (const f of [0, -L]) for (const r of [-1.3, 1.3]) TK.pts.push([hx + Math.sin(ty) * f + Math.cos(ty) * r, hz - Math.cos(ty) * f + Math.sin(ty) * r]);
  Object.assign(TK, { x: ex, z: ez, vx: fx * st.vel, vz: fz * st.vel, th, m: st.s >= net.Sm ? st.s : net.mainCoords(ex, ez).s });
}
/* the truck's box in a road's coordinates: { s0..s1, l0..l1, s, lat, len, w, dir: 1, v (its speed along the road), es/el (eye), ali (cos of heading vs road) } */
function truckBox(road) {
  let s0 = Infinity, s1 = -Infinity, l0 = Infinity, l1 = -Infinity;
  for (const [x, z] of TK.pts) { const c = road.coords(x, z, TK.m); s0 = Math.min(s0, c.s); s1 = Math.max(s1, c.s); l0 = Math.min(l0, c.lat); l1 = Math.max(l1, c.lat); }
  const e = road.coords(TK.x, TK.z, TK.m), p = road.at(e.s);
  return { s0, s1, l0, l1, s: (s0 + s1) / 2, lat: (l0 + l1) / 2, len: s1 - s0, w: l1 - l0, dir: 1, v: TK.vx * Math.sin(p.t) - TK.vz * Math.cos(p.t), es: e.s, el: e.lat, ali: Math.cos(TK.th - p.t) };
}

/* ───────────────────────── spawning ───────────────────────── */
/* zone: 'ahead' (truck's direction, in front), 'behind' (truck's direction, approaching from the rear), 'oncoming' (opposite direction) – on the main road, relative to the truck.
   dist = metres from the truck (default random), lat = override lane offset. Returns the vehicle or null (spot taken). Debug handle: window.__game.spawn */
export function spawn(type, preset, zone = 'ahead', dist, lat) {
  const dir = zone === 'oncoming' ? -1 : 1, early = st.s < net.Sm;   // still on the depot road: traffic from behind must come from further away to pass the exit
  dist ??= zone === 'ahead' ? 300 + T.rng() * 300 : zone === 'behind' ? -(early ? 300 + T.rng() * 250 : 120 + T.rng() * 120) : 450 + T.rng() * 250;
  const a = spawnAt(type, preset, MAIN, dir, TK.m + dist, lat);
  if (a && zone === 'behind') a.v = a.vDes = Math.max(a.vDes, st.v + 2 + T.rng() * 4);
  return a;
}
function spawnAt(type, preset, road, dir, s, lat) {
  const def = VEHICLES[type], P = PRESETS[preset]; if (!def || !P) return null;
  if (road.main && s < net.Sm - 1400) return null;   // the main road behind the depot exit is 1500 m long
  const n = road.main ? net.lanes(s, dir) : road.j.sl, lane = lat != null ? 0 : P.speed < 1 || def.mass > 1.5 ? n - 1 - Math.floor(T.rng() * T.rng() * n) : Math.floor(T.rng() * n);   // slow / heavy keep right
  const home = lat ?? laneLat(dir, lane);
  for (const o of cars) if (o.road === road && Math.abs(o.lat - home) < 2.5 && Math.abs(o.s - s) < 40 + (o.def.len + def.len) / 2) return null;
  let vDes = Math.min(34, (def.v[0] + T.rng() * (def.v[1] - def.v[0])) * P.speed); if (!road.main) vDes = Math.min(vDes, 15 + T.rng() * 3);
  const pick = T.rng() * 100 | 0, mesh = buildVehicle(def, pick), a = { id: ++T.ids, pick, def, P, preset, road, dir, s, lat: home, lane, target: home, lv: 0, v: vDes, vDes, brake: false, mesh, lcT: 0, ph: T.rng() * 6.28, t: 0, cool: 0, over: false, dV: Infinity };
  cars.push(a); place(a); return a;
}
function pickType(ok) {
  for (let i = 0; i < 4; i++) {   // some types have no preset that fits: retry with another type
    const type = pick(Object.fromEntries(Object.entries(VEHICLES).map(([k, d]) => [k, d.rare]))), preset = pick(VEHICLES[type].presets, ok); if (preset) return [type, preset];
  }
  return null;
}
function spawnRandom(zone, dist) {
  for (let i = 0; i < 3; i++) { const tp = pickType(zone === 'behind' ? k => BEHIND_OK.includes(k) : undefined); if (!tp) continue; const a = spawn(tp[0], tp[1], zone, dist); if (a) return a; }
  return null;
}
function spawnCross(j, c) {
  const line = net.lineOf(j), dir = T.rng() < .5 ? 1 : -1, tp = pickType(k => CROSS_OK.includes(k)); if (!tp) return null;
  return spawnAt(tp[0], tp[1], line, dir, c ?? -dir * (j.len - 25));
}
export function resetTraffic(seed) {
  for (const a of cars) removeVehicle(a.mesh); cars.length = 0; T.cross.clear(); T.ids = 0;
  if (!CFG.TRAFFIC) return;   // (no Math.random() draw when off, so the headless trace stays comparable)
  T.seed = seed ?? Math.random() * 4294967296 >>> 0; T.rng = mulberry32(T.seed); T.spawnT = CFG.TRAFFIC_GAP;
  truckPose();
  // the main road is already busy when the ride starts: both directions, on both sides of the depot exit
  const Sm = net.Sm, r = T.rng;
  for (const [dir, s] of [[1, Sm + 120 + r() * 80], [1, Sm + 420 + r() * 150], [-1, Sm + 260 + r() * 120], [-1, Sm + 650 + r() * 150], [1, Sm - 200 - r() * 120], [1, Sm - 520 - r() * 150], [-1, Sm - 140 - r() * 100]]) {
    for (let i = 0; i < 3; i++) { const tp = pickType(); if (tp && spawnAt(tp[0], tp[1], MAIN, dir, s)) break; }
  }
}

/* ───────────────────────── AI ───────────────────────── */
/* nearest obstacle ahead in a's travel direction that overlaps its lane: { gap (bumper to bumper), vl (its speed along a's direction) } */
function leadOf(a, tb) {
  let best = null;
  const see = (bs, blat, bw, bl, vl) => {
    const rel = (bs - a.s) * a.dir; if (rel <= 0 || Math.abs(blat - a.lat) > (a.def.w + bw) / 2 + .15) return;
    const gap = rel - (a.def.len + bl) / 2; if (!best || gap < best.gap) best = { gap: Math.max(gap, .3), vl };
  };
  for (const b of cars) if (b !== a && b.road === a.road) see(b.s, b.lat, b.def.w, b.def.len, b.dir * a.dir * b.v);
  if (tb) see(tb.s, tb.lat, tb.w, tb.len, a.dir * tb.v);
  return best;
}
/* would lane offset `lat` stay free of every other vehicle (and the truck) for the next HORIZON seconds, extrapolating constant speeds? */
function laneFree(a, lat, tb) {
  const clear = (bs, blat, bw, bl, bv) => {
    if (Math.abs(blat - lat) > (a.def.w + bw) / 2 + .6) return true;
    const rel0 = (bs - a.s) * a.dir, dv = bv - a.v, need = (a.def.len + bl) / 2 + 9;
    for (let t = 0; t <= HORIZON; t++) if (Math.abs(rel0 + dv * t) < need) return false;
    return true;
  };
  for (const b of cars) if (b !== a && b.road === a.road && !clear(b.s, b.lat, b.def.w, b.def.len, b.dir * a.dir * b.v)) return false;
  return !tb || clear(tb.s, tb.lat, tb.w, tb.len, a.dir * tb.v);
}
/* traffic lights: a red (or an amber it can still stop for) = standing obstacle at the stop line; a green waits while the box is occupied by the other road */
const inBox = (b, j) => b.road.main ? Math.abs(b.s - j.s) < j.mouth + b.def.len / 2 : b.road.j === j && b.s > -j.halfL - b.def.len / 2 && b.s < j.halfR + b.def.len / 2;
function signalLead(a) {
  let j, gap, sg;
  if (a.road.main) {
    j = net.nextJunction(a.s - a.dir * 2, a.dir, 170, q => q.signal); if (!j) return null;
    gap = (net.stopLine(j, a.dir) - a.s) * a.dir - a.def.len / 2; sg = net.signal(j, 'main');
  } else {
    j = a.road.j; if (!j.signal) return null;
    gap = (-a.dir * ((a.dir > 0 ? j.halfL : j.halfR) + 2) - a.s) * a.dir - a.def.len / 2; sg = net.signal(j, 'cross');
  }
  if (gap < 1) return null;   // at / past the line: keep going (clears the box)
  if (sg === 'G' && !cars.some(b => b.road.main !== a.road.main && b.v > .5 && inBox(b, j))) return null;
  if (sg === 'A' && gap < a.v * a.v / (2 * 3.5)) return null;   // amber too close to stop comfortably: go
  return { gap: Math.max(gap, .3), vl: 0 };
}
/* Road holes (world/holes.js): the AI reads the hole ahead (≈ where the warning sign stands) and, in this order, (1) shifts sideways inside its lane, (2) moves to another
   free lane (the oncoming one only on a 1+1 road), (3) crawls through at the hole's `crawl` speed. Stateless every step: the lateral override (a.dLat) and speed cap (a.dV)
   are recomputed from the hole list, so the car returns to its lane by itself once it is past; a.target / a.over are never touched. */
const HOLE_MARGIN = .35;
function dodge(a, tb) {
  a.dLat = null; a.dV = Infinity; a.hz = false;
  if (!CFG.HOLES || !a.road.main) return;
  const look = CFG.HOLE_WARN + 10 + a.v * 2, w = a.def.w / 2 + HOLE_MARGIN, hs = [];
  for (const h of holesNear(a.dir > 0 ? a.s - 15 : a.s - look, a.dir > 0 ? a.s + look : a.s + 15)) {
    const rel = (h.s - a.s) * a.dir; if (rel < -(a.def.len / 2 + h.ext + .5) || rel > look) continue;   // still "ahead" until the car's tail is clear of it
    hs.push({ h, rel });
  }
  if (!hs.length) return;
  a.hz = true;
  const blocked = lat => hs.some(({ h }) => lat + w > h.l0 && lat - w < h.l1);
  if (!blocked(a.target)) return;
  const lanes = side => { const e = edgeOf(net.lanes(a.s, side)) + .2; return side > 0 ? [.25 + a.def.w / 2, e - a.def.w / 2] : [-e + a.def.w / 2, -.25 - a.def.w / 2]; };   // asphalt of a direction, for the car's centre
  const free = (base, ok) => {
    const [lo, hi] = lanes(Math.sign(base)); if (hi < lo) return null;
    for (let k = 0; k <= 40; k++) for (const sg of k ? [1, -1] : [1]) { const c = base + sg * k * .15; if (c >= lo && c <= hi && !blocked(c) && ok(c)) return c; }
    return null;
  };
  const here = free(a.target, c => Math.abs(c - a.target) < 2 || laneFree(a, c, tb)); if (here !== null) { a.dLat = here; return; }
  if (net.lanes(a.s, a.dir) === 1) { const other = free(-a.target, c => laneFree(a, c, tb)); if (other !== null) { a.dLat = other; return; } }
  for (const { h, rel } of hs) if (a.target + w > h.l0 && a.target - w < h.l1) {   // can't avoid it: brake down to crawling speed at the pit
    const gap = rel - a.def.len / 2 - h.ext; a.dV = Math.min(a.dV, HOLES[h.type].crawl + Math.sqrt(2 * 2.5 * Math.max(0, gap)));
  }
}
function think(a, dt, tb) {
  a.target = a.over ? laneLat(-a.dir, 0) : laneLat(a.dir, a.lane);
  dodge(a, tb);
  const P = a.P, n = laneCount(a, a.s), nAhead = laneCount(a, a.s + a.dir * 150);
  let lead = leadOf(a, tb); const sl = signalLead(a); if (sl && (!lead || sl.gap < lead.gap)) lead = sl;
  if (a.lane >= nAhead) {   // this lane ends ahead: merge left, or wait at the end of it
    if (laneFree(a, laneLat(a.dir, nAhead - 1), tb)) a.lane = nAhead - 1;
    else if (a.lane >= laneCount(a, a.s + a.dir * 40)) a.dV = Math.min(a.dV, 3);
  }
  if (P.over && (a.lcT -= dt) <= 0) {   // lane choice, re-evaluated twice a second
    a.lcT = .5;
    const slow = lead && lead.gap < 50 && lead.vl < a.vDes - 3;
    if (n >= 2) {   // multi-lane: pass on the left, keep right afterwards
      a.over = false;
      if (slow && a.lane > 0 && laneFree(a, laneLat(a.dir, a.lane - 1), tb)) a.lane--;
      else if (!slow && a.lane < Math.min(n, nAhead) - 1 && T.rng() < .2 && laneFree(a, laneLat(a.dir, a.lane + 1), tb)) a.lane++;
    } else if (a.road.main) {   // 1+1: overtake in the oncoming lane – never towards a junction
      const back = laneLat(a.dir, a.lane), jNear = net.nextJunction(a.s, a.dir, 250, q => q.kind !== 'start');
      if (!a.over && slow && !jNear && net.lanes(a.s, -a.dir) === 1 && laneFree(a, laneLat(-a.dir, 0), tb)) a.over = true;
      else if (a.over && (laneFree(a, back, tb) || (lead && lead.vl < -1 && lead.gap < 8 * a.v / 3.6 + 40) || jNear)) a.over = false;   // pass done – or an oncoming vehicle / a junction: bail out
    }
  }
  // longitudinal: Intelligent-Driver-Model acceleration
  const aMax = 2.5, b = 3.5, v = a.v;
  let acc = aMax * (1 - (v / Math.max(.1, Math.min(a.vDes, a.dV))) ** 4);
  if (lead) { const sStar = 2 + v * P.T + v * (v - lead.vl) / (2 * Math.sqrt(aMax * b)); acc -= aMax * (Math.max(sStar, 0) / lead.gap) ** 2; }
  acc = clamp(acc, -9, aMax); a.brake = acc < -1.2; a.v = Math.max(0, v + acc * dt);
  // lateral: glide to the target lane (+ optional wobble)
  const want = (a.dLat ?? a.target) + (P.weave && !a.hz ? Math.sin(a.t * .9 + a.ph) * P.weave : 0);   // no weaving while a hole is in sight
  a.lv = approach(a.lv, clamp((want - a.lat) * 1.2, -1.8, 1.8), 3, dt); a.lat += a.lv * dt;
  a.s += a.dir * a.v * dt;
}
function place(a) {
  const p = a.road.at(a.s), m = a.mesh;
  m.position.set(p.x + Math.cos(p.t) * a.lat, 0, p.z + Math.sin(p.t) * a.lat);
  m.rotation.y = -(p.t + (a.dir < 0 ? Math.PI : 0) + a.dir * Math.atan2(a.lv, Math.max(a.v, 3)));
  const u = m.userData; if (u.brake) u.brake.visible = a.brake;
  if (u.ind) {   // indicate where the car is going, including a hole dodge (dLat). Using the lane centre lights the return direction while it is still swerving out.
    const aim = a.dLat ?? a.target, dl = (aim - a.lat) * a.dir, sig = Math.abs(aim - a.lat) > .4 ? (dl > 0 ? 'r' : 'l') : '', on = Math.floor(a.t * 3) % 2 === 0;
    u.ind.r.visible = sig === 'r' && on; u.ind.l.visible = sig === 'l' && on;
  }
  if (u.flash) { const on = Math.floor(a.t * 6) % 2 === 0; u.flash[0].visible = on; u.flash[1].visible = !on; }
}

/* ───────────────────────── contact with the truck ───────────────────────── */
/* Truck running along the main road (aligned): direct hit = the truck's nose engaged >= CRASH_OVERLAP of the narrower vehicle's width, closing >= CRASH_CLOSING -> ride over;
   slower nose contact or a hit from behind = bump (hull damage, speed loss); anything else (alongside / corner clip) = scratch.
   Anything at an angle (turning out of the depot, side-road traffic in a crossroads): closing speed >= CRASH_CLOSING = ride over, else a bump. Returns a failure reason or null. */
/* damage and the scrape sound once per contact; the overlap itself is cleared every frame. Skipping the
   whole test for a.cool (0.8 s) let a car keep its speed and drive through the truck after the first bump. */
function freshHit(a) { if (a.cool > 0) return false; a.cool = .8; return true; }
function contact(a, tb) {
  const { def } = a, penS = Math.min(tb.s1, a.s + def.len / 2) - Math.max(tb.s0, a.s - def.len / 2), penL = Math.min(tb.l1, a.lat + def.w / 2) - Math.max(tb.l0, a.lat - def.w / 2);
  if (penS <= 0 || penL <= 0) return null;
  if (a.road.main && tb.ali > .94) return alignedContact(a, tb, penS, penL);
  const p = a.road.at(a.s), rvx = Math.sin(p.t) * a.dir * a.v - TK.vx, rvz = -Math.cos(p.t) * a.dir * a.v - TK.vz;   // relative velocity (world)
  const w = a.road.at(tb.s), dx = w.x + Math.cos(w.t) * tb.lat - (p.x + Math.cos(p.t) * a.lat), dz = w.z + Math.sin(w.t) * tb.lat - (p.z + Math.sin(p.t) * a.lat), dl = Math.hypot(dx, dz) || 1;
  const closing = Math.max(0, (rvx * dx + rvz * dz) / dl), hit = freshHit(a);
  if (hit && closing >= CFG.CRASH_CLOSING) {
    const why = a.v > st.v ? `A ${def.name} crashed into your truck${a.road.main ? '' : ' at the crossroads'}.` : `You drove into a ${def.name}${a.road.main ? ' on the main road' : ' at the crossroads'}.`;
    hurt(st.hull, closing, 'COLLISION'); st.v = 0; a.v = 0; return why;
  }
  if (hit) { hurt(bumpDmg(def, closing), closing, 'BUMP'); st.v *= .7; }
  a.v = Math.min(a.v, 1); a.s -= a.dir * penS;
  return null;
}
function alignedContact(a, tb, penS, penL) {
  const { def } = a, rel = a.s - tb.es, vs = a.dir * a.v, closing = rel > 0 ? tb.v - vs : vs - tb.v, frac = penL / Math.min(2.5, def.w), sgn = Math.sign(a.lat - tb.el) || 1;
  if (frac >= CFG.CRASH_OVERLAP && rel > TRUCK_FRONT / 2) {   // nose to nose / nose to tail
    const hit = freshHit(a), push = Math.sign(rel) || 1;
    if (hit && closing >= CFG.CRASH_CLOSING) { hurt(st.hull, closing, 'COLLISION'); st.v = 0; return a.dir < 0 ? `Head-on collision with a ${def.name}.` : `You ran into the back of a ${def.name}.`; }
    if (hit) hurt(bumpDmg(def, Math.max(closing, 0)), Math.max(closing, 0), 'BUMP');
    st.s -= push * penS * .5; a.s += push * penS * .5;   // full overlap, both ways — a 1.5 m cap left the car inside the cab
    if (a.dir > 0) st.v = Math.min(st.v, a.v); else { st.v = Math.min(st.v, 0); a.v = 0; }
    return null;
  }
  const hit = freshHit(a);
  if (frac >= CFG.CRASH_OVERLAP && rel < -TRAILER_BACK + 1) {   // something ran into the trailer's tail
    if (hit) hurt(bumpDmg(def, Math.max(closing, 0)), Math.max(closing, 0), 'BUMP');
    a.s -= a.dir * penS; a.v = Math.min(a.v, Math.max(0, st.v)); return null;
  }
  const rv = Math.abs(vs - tb.v);   // sideswipe: scrape, push apart, a little speed lost
  if (hit) { audio.play('scrape', .7); hurt(CFG.SCRATCH_DMG * clamp(rv / 10, .4, 2) * Math.sqrt(def.mass), rv * .3, 'SCRATCH'); st.psi -= sgn * .03; st.v *= .98; }
  st.d -= sgn * penL * .5; a.lat += sgn * penL * .5; if ((a.lat - tb.el) * a.lv < 0) a.lv = 0;
  return null;
}

/* per physics step: spawn / move / despawn vehicles, then test contact. Returns a failure reason when the truck had a direct hit. */
export function updateTraffic(dt) {
  if (!CFG.TRAFFIC) return null;
  truckPose();
  const boxes = new Map(), boxFor = road => {
    if (!boxes.has(road)) boxes.set(road, road.main || Math.abs(road.j.s - TK.m) < 70 || Math.abs(road.j.s - st.s) < 70 ? truckBox(road) : null);
    return boxes.get(road);
  };
  if ((T.spawnT -= dt) <= 0) {
    T.spawnT = CFG.TRAFFIC_GAP * (.6 + T.rng() * .8);
    const nMain = cars.reduce((k, a) => k + (a.road.main ? 1 : 0), 0);
    if (nMain < CFG.TRAFFIC_MAX) {
      const r = T.rng();
      if (st.s < net.Sm) spawnRandom(r < .15 ? 'ahead' : r < .55 ? 'behind' : 'oncoming');   // waiting at the depot exit: keep the main road busy past it
      else spawnRandom(r < .4 ? 'ahead' : r < .65 && st.v > 8 ? 'behind' : 'oncoming');
    }
  }
  for (const j of net.near(TK.m - 300, TK.m + 900)) {   // cross traffic at signalled crossroads in range
    if (j.kind !== 'cross' || !j.signal) continue;
    let t = T.cross.get(j.id);
    if (t === undefined) { t = T.rng() * CFG.CROSS_GAP; for (let i = 0; i < 2; i++) spawnCross(j, (T.rng() - .5) * 2 * (j.len - 60)); }   // first sight: already some on it
    if ((t -= dt) <= 0) { t = CFG.CROSS_GAP * (.6 + T.rng() * .8); if (cars.filter(a => a.road.j === j).length < CFG.CROSS_MAX) spawnCross(j); }
    T.cross.set(j.id, t);
  }
  let fatal = null;
  for (let i = cars.length - 1; i >= 0; i--) {
    const a = cars[i], tb = boxFor(a.road); a.t += dt; a.cool = Math.max(0, a.cool - dt); think(a, dt, tb); place(a);
    const gone = a.road.main ? a.s < TK.m - 300 || a.s > TK.m + 900 || a.s < net.Sm - 1450 : Math.abs(a.s) > a.road.j.len - 5 || Math.abs(a.road.j.s - TK.m) > 1100;
    if (gone) { removeVehicle(a.mesh); cars.splice(i, 1); continue; }
    if (!fatal && tb && Math.abs(a.s - tb.s) < 25 + a.def.len + tb.len / 2) fatal = contact(a, tb);
  }
  return fatal;
}

/* the traffic around the truck for a spectator's replay (live streams – telemetry.js records it at TRAFFIC_HZ, watch.js redraws it): the nearest
   vehicles within `range` m as flat rows of 7 – [id, type, colour pick, x, z, yaw, flags (1 brake · 2 siren)] in WORLD coordinates. Display only:
   the verdict never reads it. */
export const TRAFFIC_TYPES = Object.keys(VEHICLES);
export function trafficSnapshot(range = 400, max = 16) {
  const p = roadAt(st.s), tx = p.x + Math.cos(p.t) * st.d, tz = p.z + Math.sin(p.t) * st.d, near = [];
  for (const a of cars) { const m = a.mesh.position, d = Math.hypot(m.x - tx, m.z - tz); if (d <= range) near.push([d, a]); }
  near.sort((x, y) => x[0] - y[0]);
  const out = [], r = (v, k) => Math.round(v * k) / k;
  for (const [, a] of near.slice(0, max)) {
    const m = a.mesh, u = m.userData;
    out.push(a.id, TRAFFIC_TYPES.indexOf(a.def.type), a.pick, r(m.position.x, 10), r(m.position.z, 10), r(m.rotation.y, 1000), (a.brake ? 1 : 0) | (u.flash ? 2 : 0));
  }
  return out;
}
