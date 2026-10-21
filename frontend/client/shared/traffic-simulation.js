import { clamp, approach, mulberry32 } from './prng.js';
import { laneLat, edgeOf } from './road.js';
import { nextToll, TOLL_WAIT } from './toll.js';
import { VEHICLES, TRUCK_FRONT, CAB_BACK, HITCH, TRAILER_BACK, HORIZON, PRESETS, BEHIND_OK, CROSS_OK, CALM_OK, bumpDmg as sharedBumpDmg } from './traffic.js';

/** One instance per ride. Rendering and sound are browser adapters; all spawning, AI and collision responses live here. */
export function createTrafficSimulation({ config: CFG, state: st, roadAt, net, holes: HOLES, holesNear, trip, buildVehicle = () => null, removeVehicle = () => {}, place = () => {}, hurt = () => {}, audio = { play() {}, honk() {} }, onContact = () => {} }) {
const cars = [];   // live vehicles (debug handle: window.__game.traffic)
const MAIN = { main: true, at: m => net.mainAt(m), coords: (x, z, hint) => net.mainCoords(x, z, hint) };
const T = { rng: mulberry32(0), seed: 0, spawnT: 0, cross: new Map(), ids: 0 };   // ids: a stable number per vehicle for the recording (no rng draw)
const TK = { pts: [], x: 0, z: 0, vx: 0, vz: 0, th: 0, m: 0 };   // the truck this step: world corners, eye, velocity, heading, main-road coordinate

const bumpDmg = (def, closing) => sharedBumpDmg(def, closing, CFG.CRASH_CLOSING);   // hull % lost in a bump: ∝ mass · closing speed²
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
/* the truck's box in a road's coordinates: { s0..s1, l0..l1, s, lat, len, w, dir: 1, v (its speed along the road), vd (its sideways speed, + = right, minus a .6 m/s
   dead band), es/el (eye), ali (cos of heading vs road), parts: [cab, trailer] boxes { s0, s1, l0, l1, s, len } }. The parts are what the AI and contact test against:
   the box round BOTH of them, at an angle (a jack-knifed or turning truck), reached far into lanes neither of them is in – an oncoming car once stopped for it and was
   "hit" for minutes while the cab was in its own lane. */
function partBox(road, i0) {
  let s0 = Infinity, s1 = -Infinity, l0 = Infinity, l1 = -Infinity;
  for (let i = i0; i < i0 + 4; i++) { const c = road.coords(TK.pts[i][0], TK.pts[i][1], TK.m); s0 = Math.min(s0, c.s); s1 = Math.max(s1, c.s); l0 = Math.min(l0, c.lat); l1 = Math.max(l1, c.lat); }
  return { s0, s1, l0, l1, s: (s0 + s1) / 2, len: s1 - s0 };
}
function truckBox(road) {
  const cab = partBox(road, 0), trl = partBox(road, 4), s0 = Math.min(cab.s0, trl.s0), s1 = Math.max(cab.s1, trl.s1), l0 = Math.min(cab.l0, trl.l0), l1 = Math.max(cab.l1, trl.l1);
  const e = road.coords(TK.x, TK.z, TK.m), p = road.at(e.s), side = TK.vx * Math.cos(p.t) + TK.vz * Math.sin(p.t);
  return { s0, s1, l0, l1, s: (s0 + s1) / 2, lat: (l0 + l1) / 2, len: s1 - s0, w: l1 - l0, dir: 1, v: TK.vx * Math.sin(p.t) - TK.vz * Math.cos(p.t), vd: Math.sign(side) * Math.max(0, Math.abs(side) - .6),
    es: e.s, el: e.lat, ali: Math.cos(TK.th - p.t), parts: [cab, trl] };
}
/* a part's side extent where the truck will be after `t` s of its sideways drift (capped at TRAFFIC_DRIFT) */
const reach = (tb, q, t) => { const d = tb.vd * clamp(t, 0, CFG.TRAFFIC_DRIFT); return [q.l0 + Math.min(0, d), q.l1 + Math.max(0, d)]; };

/* ───────────────────────── spawning ───────────────────────── */
/* zone: 'ahead' (truck's direction, in front), 'behind' (truck's direction, approaching from the rear), 'oncoming' (opposite direction) – on the main road, relative to the truck.
   dist = metres from the truck (default random), lat = override lane offset. Returns the vehicle or null (spot taken). Debug handle: window.__game.spawn */
function spawn(type, preset, zone = 'ahead', dist, lat) {
  const dir = zone === 'oncoming' ? -1 : 1, early = st.s < net.Sm;   // still on the depot road: traffic from behind must come from further away to pass the exit
  dist ??= zone === 'ahead' ? 300 + T.rng() * 300 : zone === 'behind' ? -(early ? 300 + T.rng() * 250 : 120 + T.rng() * 120) : 450 + T.rng() * 250;
  const a = spawnAt(type, preset, MAIN, dir, TK.m + dist, lat);
  if (a && zone === 'behind') a.v = a.vDes = Math.max(a.vDes, st.v + 2 + T.rng() * 4);
  return a;
}
function spawnAt(type, preset, road, dir, s, lat) {
  const def = VEHICLES[type], P = PRESETS[preset]; if (!def || !P) return null;
  if (road.main && s < net.Sm - 1400) return null;   // the main road behind the depot exit is 1500 m long
  if (road.main && net.straight && s < net.Sm + 30) return null;   // a straight start (trips.js): there is no main road behind the depot – it is the depot road
  const n = road.main ? net.lanes(s, dir) : road.j.sl, lane = lat != null ? 0 : P.speed < 1 || def.mass > 1.5 ? n - 1 - Math.floor(T.rng() * T.rng() * n) : Math.floor(T.rng() * n);   // slow / heavy keep right
  const home = lat ?? laneLat(dir, lane);
  for (const o of cars) if (o.road === road && Math.abs(o.lat - home) < 2.5 && Math.abs(o.s - s) < 40 + (o.def.len + def.len) / 2) return null;
  let vDes = Math.min(34, (def.v[0] + T.rng() * (def.v[1] - def.v[0])) * P.speed); if (!road.main) vDes = Math.min(vDes, 15 + T.rng() * 3);
  const pick = T.rng() * 100 | 0, mesh = buildVehicle(def, pick), a = { id: ++T.ids, pick, def, P, preset, road, dir, s, lat: home, lane, target: home, lv: 0, v: vDes, vDes, brake: false, mesh, lcT: 0, ph: T.rng() * 6.28, t: 0, cool: 0, touch: 99, worst: 0, vs: 0, vl: 0, counted: false, over: false, dV: Infinity, state: 'drive', stT: 0, blockT: 0, hornT: 0, wait: false, tollAt: null, tollGate: null, tollT: 0 };
  cars.push(a); place(a); return a;
}
function pickType(ok) {
  if (trip.calm) { const f = ok; ok = k => CALM_OK.includes(k) && (!f || f(k)); }
  const types = trip.calm ? Object.entries(VEHICLES).filter(([, d]) => Object.keys(d.presets).some(ok)) : Object.entries(VEHICLES);   // a calm trip: only types that HAVE a calm behaviour (no draw wasted on a siren-only one)
  if (!types.length) return null;
  for (let i = 0; i < 4; i++) {   // some types have no preset that fits: retry with another type
    const type = pick(Object.fromEntries(types.map(([k, d]) => [k, d.rare]))), preset = pick(VEHICLES[type].presets, ok); if (preset) return [type, preset];
  }
  return null;
}
function spawnRandom(zone, dist) {
  if (trip.calm && zone === 'behind') zone = 'ahead';   // a calm trip: no calm behaviour comes up from behind to pass – a car ahead instead (density stays what trips.js asks)
  for (let i = 0; i < 3; i++) { const tp = pickType(zone === 'behind' ? k => BEHIND_OK.includes(k) : undefined); if (!tp) continue; const a = spawn(tp[0], tp[1], zone, dist); if (a) return a; }
  return null;
}
function spawnCross(j, c) {
  const line = net.lineOf(j), dir = T.rng() < .5 ? 1 : -1, tp = pickType(k => CROSS_OK.includes(k)); if (!tp) return null;
  return spawnAt(tp[0], tp[1], line, dir, c ?? -dir * (j.len - 25));
}
function resetTraffic(seed) {
  for (const a of cars) removeVehicle(a.mesh); cars.length = 0; T.cross.clear(); T.ids = 0;
  if (!CFG.TRAFFIC) return;   // (no Math.random() draw when off, so the headless trace stays comparable)
  T.seed = seed ?? ((net.seed ^ 0x9e3779b9) >>> 0); T.rng = mulberry32(T.seed); T.spawnT = CFG.TRAFFIC_GAP / trip.traffic;
  truckPose();
  // the main road is already busy when the ride starts: both directions, on both sides of the depot exit
  const Sm = net.Sm, r = T.rng;
  for (const [dir, s] of [[1, Sm + 120 + r() * 80], [1, Sm + 420 + r() * 150], [-1, Sm + 260 + r() * 120], [-1, Sm + 650 + r() * 150], [1, Sm - 200 - r() * 120], [1, Sm - 520 - r() * 150], [-1, Sm - 140 - r() * 100]].slice(0, Math.round(7 * Math.min(1, trip.traffic))).filter(([dir, s]) => !net.straight || (dir > 0 && s > Sm))) {   // a quieter trip starts with fewer of them; a straight start only with cars driving away ahead
    for (let i = 0; i < 3; i++) { const tp = pickType(); if (tp && spawnAt(tp[0], tp[1], MAIN, dir, s)) break; }
  }
}

/* ───────────────────────── AI ───────────────────────── */
/* nearest obstacle ahead in a's travel direction that overlaps its lane: { gap (bumper to bumper), vl (its speed along a's direction) }. The truck counts with its cab and trailer apart, each where its sideways drift will have taken it by the time `a` gets there, and with TRAFFIC_CLEAR of side gap:
   a car that would pass closer follows it instead (and moves over in `evade` if it can). `sd` = the direction looked in (a.dir = ahead, -a.dir = behind the car);
   `who` = the other vehicle's record, or 'truck'; `raw` = the gap without the .3 floor (negative = overlapping) */
function leadOf(a, tb, sd = a.dir) {
  let best = null;
  const see = (bs, lo, hi, bl, vl, m, who) => {
    const rel = (bs - a.s) * sd; if (rel <= 0 || lo > a.lat + a.def.w / 2 + m || hi < a.lat - a.def.w / 2 - m) return;
    const raw = rel - (a.def.len + bl) / 2; if (!best || raw < best.raw) best = { gap: Math.max(raw, .3), raw, vl, who };
  };
  for (const b of cars) if (b !== a && b.road === a.road) see(b.s, b.lat - b.def.w / 2, b.lat + b.def.w / 2, b.def.len, sd * b.dir * b.v, .15, b);
  if (tb) for (const q of tb.parts) { const [lo, hi] = reach(tb, q, ((q.s - a.s) * sd) / Math.max(1, sd * (a.dir * a.v - tb.v))); see(q.s, lo, hi, q.len, sd * tb.v, CFG.TRAFFIC_CLEAR, 'truck'); }
  return best;
}
/* would lane offset `lat` stay free of every other vehicle for the next HORIZON seconds (of the truck: TRAFFIC_LOOK s), extrapolating constant speeds?
   Solved for the whole span (a 1 s sampling let a 40 m/s closing pair jump over the ±20 m it needs). */
function laneFree(a, lat, tb) {
  for (const b of cars) if (b !== a && b.road === a.road && !clearOf(a, lat, b.s, b.lat - b.def.w / 2, b.lat + b.def.w / 2, b.def.len, b.dir * a.dir * b.v, HORIZON, .6)) return false;
  return !tb || truckFree(a, lat, tb, CFG.TRAFFIC_LOOK);
}
function clearOf(a, lat, bs, lo, hi, bl, bv, H, m) {
  if (lo > lat + a.def.w / 2 + m || hi < lat - a.def.w / 2 - m) return true;
  const r0 = (bs - a.s) * a.dir, r1 = r0 + (bv - a.v) * H, need = (a.def.len + bl) / 2 + 9;
  return r0 * r1 > 0 && Math.min(Math.abs(r0), Math.abs(r1)) >= need;   // never closer than `need` while the gap closes linearly from r0 to r1
}
const truckFree = (a, lat, tb, H) => tb.parts.every(q => { const [lo, hi] = reach(tb, q, H); return clearOf(a, lat, q.s, lo, hi, q.len, a.dir * tb.v, H, CFG.TRAFFIC_CLEAR + .1); });
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
/* PIKE arm, driver's direction only. The car at the line waits TOLL_WAIT s (its payment), then this gate is behind it.
   No RNG: the same cars stop for the same time in a replay. Cars behind follow it, so the lane pays one at a time. */
function tollLead(a, dt) {
  if (!a.road.main || a.dir < 0) return null;
  const gate = nextToll(a.s);
  if (a.tollAt === gate) return null;
  if (a.tollGate !== gate) { a.tollGate = gate; a.tollT = 0; }
  const gap = gate - 2 - a.s - a.def.len / 2;
  if (gap < -6) { a.tollAt = gate; return null; }
  if (gap < 8 && a.v < 1.2) { a.tollT += dt; if (a.tollT >= TOLL_WAIT) { a.tollAt = gate; a.tollT = 0; return null; } }
  return { gap: Math.max(gap, .35), vl: 0 };
}
/* Road holes (world/holes.js): the AI reads the hole ahead (≈ where the warning sign stands) and, in this order, (1) shifts sideways inside its lane, (2) moves to another
   free lane (the oncoming one only on a 1+1 road), (3) crawls through at the hole's `crawl` speed. Stateless every step: the lateral override (a.dLat) and speed cap (a.dV)
   are recomputed from the hole list, so the car returns to its lane by itself once it is past; a.target / a.over are never touched. */
const HOLE_MARGIN = .35;
const asphalt = (a, side) => { const e = edgeOf(net.lanes(a.s, side)) + .2; return side > 0 ? [.25 + a.def.w / 2, e - a.def.w / 2] : [-e + a.def.w / 2, -.25 - a.def.w / 2]; };   // a direction's tarmac, for the car's centre
function dodge(a, tb) {
  a.dLat = null; a.dV = Infinity; a.hz = false; a.pit = null;
  if (!CFG.HOLES || !a.road.main) return;
  const look = CFG.HOLE_WARN + 10 + a.v * 2, w = a.def.w / 2 + HOLE_MARGIN, hs = [];
  for (const h of holesNear(a.dir > 0 ? a.s - 15 : a.s - look, a.dir > 0 ? a.s + look : a.s + 15)) {
    const rel = (h.s - a.s) * a.dir; if (rel < -(a.def.len / 2 + h.ext + .5) || rel > look) continue;   // still "ahead" until the car's tail is clear of it
    hs.push({ h, rel });
  }
  if (!hs.length) return;
  a.hz = true;
  const blocked = a.pit = lat => hs.some(({ h }) => lat + w > h.l0 && lat - w < h.l1);   // (kept for evade: it must not swerve into a pit either)
  if (!blocked(a.target)) return;
  const free = (base, ok) => {
    const [lo, hi] = asphalt(a, Math.sign(base)); if (hi < lo) return null;
    for (let k = 0; k <= 40; k++) for (const sg of k ? [1, -1] : [1]) { const c = base + sg * k * .15; if (c >= lo && c <= hi && !blocked(c) && ok(c)) return c; }
    return null;
  };
  const here = free(a.target, c => (Math.abs(c - a.target) < 2 && (!tb || truckFree(a, c, tb, 4))) || laneFree(a, c, tb)); if (here !== null) { a.dLat = here; return; }   // a shift inside its lane must not squeeze the truck either
  if (net.lanes(a.s, a.dir) === 1) { const other = free(-a.target, c => laneFree(a, c, tb)); if (other !== null) { a.dLat = other; return; } }
  for (const { h, rel } of hs) if (a.target + w > h.l0 && a.target - w < h.l1) {   // can't avoid it: brake down to crawling speed at the pit
    const gap = rel - a.def.len / 2 - h.ext; a.dV = Math.min(a.dV, HOLES[h.type].crawl + Math.sqrt(2 * 2.5 * Math.max(0, gap)));
  }
}
/* The truck where it should not be – over the centre line, turning out of the depot, swerving round a hole – or a pass that would come closer than TRAFFIC_CLEAR:
   a car it is coming at (oncoming, within TRAFFIC_LOOK / 2 s) or that is alongside it moves over, away from it, as far as its own tarmac allows (what is still in
   the way, the IDM brakes for). Same-direction cars BEHIND the truck don't: they follow or overtake it by the lane rules. Stateless like dodge (a.dLat, this step). */
function evade(a, tb) {
  if (!tb || !a.road.main) return;
  const half = a.def.w / 2, m = CFG.TRAFFIC_CLEAR, cur = a.dLat ?? a.target, closing = a.v - a.dir * tb.v;
  let lo = Infinity, hi = -Infinity;
  for (const q of tb.parts) {
    const rel = (q.s - a.s) * a.dir, gap = Math.abs(rel) - (a.def.len + q.len) / 2, along = gap < 2;
    if (!along && !(a.dir < 0 && rel > 0 && closing > .5 && gap < closing * CFG.TRAFFIC_LOOK / 2)) continue;
    const [l0, l1] = reach(tb, q, along ? 0 : gap / closing);
    if (l0 < cur + half + m && l1 > cur - half - m) { lo = Math.min(lo, l0); hi = Math.max(hi, l1); }
  }
  if (lo > hi) return;
  const [A0, A1] = asphalt(a, Math.sign(cur) || -1), away = cur > (lo + hi) / 2;
  let c = clamp(away ? hi + m + half : lo - m - half, A0, A1);
  while (a.pit?.(c) && (away ? c - cur : cur - c) >= .1) c += away ? -.15 : .15;   // not into a hole: only as far as the tarmac beside it allows
  if ((away ? c - cur : cur - c) < .1 || (Math.abs(c - a.target) >= 2 && !laneFree(a, c, null))) return;   // no room on its side of the road, or another lane that is taken
  a.dLat = c; a.hz = true;   // (hz: no weaving while it squeezes by)
}
/* The vehicle's state machine (a.state). `drive` is think() below; the others only ever come from a crash or a blocked road, and each is simple:
     crashed  touched by the truck: no throttle, wheels dragging (CRASH_FRICTION) – the truck shoves it by momentum (contact()); after CAR_STUN s, once it stands, settle()
     back     the way ahead is blocked and there is room behind: reverses (≤ CAR_REVERSE_MAX, never into what is behind) until CAR_BACK_GAP m are free, then hold
     hold     backed off: stands until the road ahead is clear (nothing within 40 m, or it is driving away), then drive – hysteresis, so it does not creep back to the truck
     honk     blocked and no room behind: hazards + horn, looks again twice a second – ahead free → drive, room behind → back
     yield    in a queue whose head backs into it: backs with it while it does (a chain, so the head has room to get out), then drive
   A car that follows one of them (a.wait) neither changes lane nor overtakes: it waits behind it. A stopped car of ANY kind that has had the truck in front of it for
   CAR_BLOCK_T s goes through the same settle(): drive on if ahead is free, else back off, else honk. No random draws here (the PRNG stream stays the spawns'). */
function settle(a, fg, rg) {
  a.stT = 0; a.blockT = 0;
  a.state = fg >= CFG.CAR_FREE_GAP ? 'drive' : rg > 2.5 ? 'back' : 'honk';
}
const rearGap = (a, tb) => { const r = leadOf(a, tb, -a.dir); return r ? r.raw : Infinity; };
function limp(a, dt, tb) {
  const f = leadOf(a, tb), r = leadOf(a, tb, -a.dir), fg = f ? f.raw : Infinity, rg = r ? r.raw : Infinity;
  a.stT += dt; a.target = laneLat(a.dir, a.lane);
  let tv = 0, rate = CFG.CRASH_FRICTION, steer = false;   // target speed along its heading (negative = reverse), how fast it gets there, whether it straightens into its lane
  if (a.state === 'crashed') { if (a.stT > CFG.CAR_STUN && Math.abs(a.v) < .4) settle(a, fg, rg); }
  else if (a.state === 'honk') {
    if ((a.hornT -= dt) <= 0) { a.hornT = 2.5; audio.honk(clamp(1 - Math.abs(a.s - TK.m) / 90, 0, 1)); }
    if (a.stT > .5 && (fg >= CFG.CAR_FREE_GAP || rg > 2.5)) settle(a, fg, rg);
  } else if (a.state === 'back') {
    if (fg >= CFG.CAR_BACK_GAP || rg < 1.2) { a.stT = 0; a.state = fg >= CFG.CAR_BACK_GAP ? 'hold' : 'honk'; }
    else { tv = -Math.min(CFG.CAR_REVERSE_MAX, Math.sqrt(6 * Math.max(0, rg - 1))); rate = 2; steer = true; }
  } else if (a.state === 'hold') {
    if (fg > 40 || f.vl > 1.5) { a.state = 'drive'; a.stT = 0; a.blockT = 0; }
    else if (fg < CFG.CAR_FREE_GAP) settle(a, fg, rg);   // the truck came after it: back off again
    else steer = true;
  } else if (a.state === 'yield') {
    if (f && f.who !== 'truck' && f.vl < -.1 && f.raw < 6 && rg > 1.2) { tv = -Math.min(CFG.CAR_REVERSE_MAX, -f.vl + .5, Math.sqrt(6 * Math.max(0, rg - 1))); rate = 3; steer = true; }
    else { a.state = 'drive'; a.stT = 0; }
  }
  a.brake = true; a.v = approach(a.v, tv, rate, dt);
  a.lv = approach(a.lv, steer ? clamp((a.target - a.lat) * .8, -1, 1) : 0, 3, dt); a.lat += a.lv * dt;
  let ds = a.v * dt;   // never through another vehicle (vehicle-vehicle contact is not simulated: a shoved car is a wall for the one behind it; the truck's contact() does its own pushing)
  if (ds > 0 && f && f.who !== 'truck' && ds > f.raw - .3) { ds = Math.max(0, f.raw - .3); a.v = Math.min(a.v, f.vl); }
  else if (ds < 0 && r && r.who !== 'truck' && -ds > r.raw - .3) { ds = -Math.max(0, r.raw - .3); a.v = Math.max(a.v, 0); }
  a.s += a.dir * ds;
}
function think(a, dt, tb) {
  if (a.state !== 'drive') return limp(a, dt, tb);
  a.target = a.over ? laneLat(-a.dir, 0) : laneLat(a.dir, a.lane);
  let giveWay = false;   // the truck is (coming) in the lane it overtakes in: pull back in now – or, still alongside the one it passes, drop back behind it first
  if (a.over && tb && !truckFree(a, a.target, tb, CFG.TRAFFIC_LOOK / 2)) { if (laneFree(a, laneLat(a.dir, a.lane), null)) a.target = laneLat(a.dir, a.lane), a.over = false; else giveWay = true; }
  dodge(a, tb); evade(a, tb);
  if (giveWay) a.dV = Math.min(a.dV, a.v * .8);   // ≈ −3.6 m/s² from the IDM's free term (the IDM brakes for the truck itself as well)
  const P = a.P, n = laneCount(a, a.s), nAhead = laneCount(a, a.s + a.dir * 150);
  let lead = leadOf(a, tb); const sl = signalLead(a); if (sl && (!lead || sl.gap < lead.gap)) lead = sl;
  const toll = tollLead(a, dt); if (toll && (!lead || toll.gap < lead.gap)) lead = toll;
  const who = lead?.who, other = who && who !== 'truck' ? who : null;
  a.wait = !!((toll && toll.gap < 70) || (other && lead.gap < 60 && (other.state !== 'drive' || other.wait)));   // at the arm, or behind a car that is: stay in lane
  if (other && (other.state === 'back' || other.state === 'yield') && lead.vl < -.2 && lead.gap < 4 && rearGap(a, tb) > 2.5) { a.state = 'yield'; a.stT = 0; return limp(a, dt, tb); }
  if (who === 'truck' && a.v < .3 && lead.vl < .3 && lead.gap < CFG.CAR_FREE_GAP) {   // stopped with the truck in front of it: after a while back off or honk (any car, crashed or not)
    if ((a.blockT += dt) > CFG.CAR_BLOCK_T) { settle(a, lead.raw, rearGap(a, tb)); if (a.state !== 'drive') return limp(a, dt, tb); }
  } else a.blockT = 0;
  if (a.lane >= nAhead) {   // this lane ends ahead: merge left, or wait at the end of it
    if (laneFree(a, laneLat(a.dir, nAhead - 1), tb)) a.lane = nAhead - 1;
    else if (a.lane >= laneCount(a, a.s + a.dir * 40)) a.dV = Math.min(a.dV, 3);
  }
  if (P.over && (!a.wait || a.over) && (a.lcT -= dt) <= 0) {   // lane choice, re-evaluated twice a second
    a.lcT = .5;
    const slow = lead && lead.gap < 50 && lead.vl < a.vDes - 3;
    if (n >= 2) {   // multi-lane: pass on the left, keep right afterwards
      a.over = false;
      if (slow && a.lane > 0 && laneFree(a, laneLat(a.dir, a.lane - 1), tb)) a.lane--;
      else if (!slow && a.lane < Math.min(n, nAhead) - 1 && T.rng() < .2 && laneFree(a, laneLat(a.dir, a.lane + 1), tb)) a.lane++;
    } else if (a.road.main) {   // 1+1: overtake in the oncoming lane – never towards a junction
      const back = laneLat(a.dir, a.lane), jNear = net.nextJunction(a.s, a.dir, 250, q => q.kind !== 'start');
      const passT = slow ? (lead.gap + 2 * a.def.len + 15) / Math.max(2, (a.v + a.vDes) / 2 - lead.vl) + 3 : 0;   // s to get past the slow one and back in
      if (!a.over && slow && !jNear && net.lanes(a.s, -a.dir) === 1 && laneFree(a, laneLat(-a.dir, 0), tb) && (!tb || truckFree(a, laneLat(-a.dir, 0), tb, passT + CFG.TRAFFIC_LOOK / 2))) a.over = true;   // …and the truck not in that lane until then (+ the margin it pulls back in at)
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
/* contact pushes a car out of the truck in one step (a.s / a.lat jump by the overlap) – the mesh eases over it instead: a.vs / a.vl = the pushed distance still to show (m), fading at VIS_EASE /s */
/* ───────────────────────── contact with the truck ───────────────────────── */
/* Truck running along the main road (aligned): direct hit = the truck's nose engaged >= CRASH_OVERLAP of the narrower vehicle's width, closing >= CRASH_CLOSING -> ride over;
   slower nose contact or a hit from behind = bump (hull damage, speed loss); anything else (alongside / corner clip) = scratch.
   Anything at an angle (turning out of the depot, side-road traffic in a crossroads): closing speed >= CRASH_CLOSING = ride over, else a bump. Returns a failure reason or null. */
/* damage and the scrape sound once per contact; the overlap itself is cleared every frame. Skipping the
   whole test for a.cool (0.8 s) let a car keep its speed and drive through the truck after the first bump. */
function freshHit(a) { if (a.cool > 0) return false; a.cool = .8; return true; }
/* one contact EPISODE per vehicle: touches less than TRAFFIC_RUB_GAP s apart are one crash – st.crashV counts it once, a re-hit costs only what it adds over the
   episode's worst (a fire truck pinned against the truck once drained the whole hull, a bump every 0.8 s for minutes). A direct hit still ends the ride. */
function touch(a) { if (a.touch > CFG.TRAFFIC_RUB_GAP) { a.worst = 0; a.counted = false; } a.touch = 0; }
function count(a) { if (!a.counted) { st.crashV++; a.counted = true; } }
function harm(a, dmg, iv, label, counts = true) { if (counts) count(a); const pay = dmg - a.worst; if (pay > .05) { a.worst = dmg; onContact({ car: a, damage: pay, closing: iv, kind: label === 'SCRATCH' ? 'scrape' : 'bump' }); hurt(pay, iv, label); } }
/* The momentum of a touch, along the unit normal n (world, from the vehicle to the truck): both get the impulse of a collision with restitution `e`, shared by mass
   (CFG.CRASH_TRUCK_MASS vs the vehicle's def.mass) – the rig shoves a sedan along and barely slows, a freighter stops it. The truck only ever LOSES speed here (the verdict
   reads speed gained without gas, and st.rev only changes at a standstill): it never gains from a rear-ender nor turns round. Returns the closing speed (0 = parting). */
function exchange(a, nx, nz, e) {
  const p = a.road.at(a.s), fx = Math.sin(p.t), fz = -Math.cos(p.t), lx = Math.cos(p.t), lz = Math.sin(p.t), vs = a.dir * a.v;
  const closing = ((fx * vs + lx * a.lv) - TK.vx) * nx + ((fz * vs + lz * a.lv) - TK.vz) * nz; if (closing <= 0) return 0;
  const mt = CFG.CRASH_TRUCK_MASS, mc = a.def.mass, j = (1 + e) * closing / (1 / mt + 1 / mc);
  a.v += a.dir * (-nx * fx - nz * fz) * j / mc; a.lv += (-nx * lx - nz * lz) * j / mc;
  const vel = st.vel + (nx * Math.sin(TK.th) - nz * Math.cos(TK.th)) * j / mt;   // the truck, along its heading
  st.vel = st.vel >= 0 ? clamp(vel, 0, st.vel) : clamp(vel, st.vel, 0); st.v = Math.abs(st.vel);
  return closing;
}
const wreck = a => { if (a.state === 'drive' || a.state === 'yield' || a.state === 'hold') { a.state = 'crashed'; a.stT = 0; a.blockT = 0; } };   // (back / honk / crashed stay: a re-hit must not restart the stun)
const share = a => CFG.CRASH_TRUCK_MASS / (CFG.CRASH_TRUCK_MASS + a.def.mass);   // how much of a overlap the VEHICLE gives way (the lighter one moves more)
function contact(a, tb) {
  const { def } = a; let penS = 0, penL = 0, q = null;
  for (const p of tb.parts) {   // the cab or the trailer it overlaps most
    const ps = Math.min(p.s1, a.s + def.len / 2) - Math.max(p.s0, a.s - def.len / 2), pl = Math.min(p.l1, a.lat + def.w / 2) - Math.max(p.l0, a.lat - def.w / 2);
    if (ps > 0 && pl > 0 && ps * pl > penS * penL) { penS = ps; penL = pl; q = p; }
  }
  if (!q) return null;
  touch(a);
  if (a.road.main && tb.ali > .94) return alignedContact(a, tb, penS, penL);
  const p = a.road.at(a.s), rvx = Math.sin(p.t) * a.dir * a.v - TK.vx, rvz = -Math.cos(p.t) * a.dir * a.v - TK.vz;   // relative velocity (world)
  const w = a.road.at(q.s), ql = (q.l0 + q.l1) / 2, dx = w.x + Math.cos(w.t) * ql - (p.x + Math.cos(p.t) * a.lat), dz = w.z + Math.sin(w.t) * ql - (p.z + Math.sin(p.t) * a.lat), dl = Math.hypot(dx, dz) || 1;
  const closing = Math.max(0, (rvx * dx + rvz * dz) / dl), hit = freshHit(a);
  if (hit && closing >= CFG.CRASH_CLOSING) {
    const why = a.v > st.v ? `A ${def.name} crashed into your truck${a.road.main ? '' : ' at the crossroads'}.` : `You drove into a ${def.name}${a.road.main ? ' on the main road' : ' at the crossroads'}.`;
    count(a); onContact({ car: a, damage: st.hull, closing, kind: 'crash' }); hurt(st.hull, closing, 'COLLISION', true); st.v = 0; a.v = 0; return why;
  }
  if (hit) harm(a, bumpDmg(def, closing), closing, 'BUMP');
  exchange(a, dx / dl, dz / dl, hit ? CFG.CRASH_BOUNCE : 0); if (hit) wreck(a);
  a.s -= a.dir * penS;
  return null;
}
function alignedContact(a, tb, penS, penL) {
  const { def } = a, rel = a.s - tb.es, vs = a.dir * a.v, closing = rel > 0 ? tb.v - vs : vs - tb.v, frac = penL / Math.min(2.5, def.w), sgn = Math.sign(a.lat - tb.el) || 1;
  if (frac >= CFG.CRASH_OVERLAP && rel > TRUCK_FRONT / 2) {   // nose to nose / nose to tail
    const hit = freshHit(a), push = Math.sign(rel) || 1;
    if (hit && closing >= CFG.CRASH_CLOSING) { count(a); onContact({ car: a, damage: st.hull, closing, kind: 'crash' }); hurt(st.hull, closing, 'COLLISION', true); st.v = 0; return a.dir < 0 ? `Head-on collision with a ${def.name}.` : `You ran into the back of a ${def.name}.`; }
    if (hit) harm(a, bumpDmg(def, Math.max(closing, 0)), Math.max(closing, 0), 'BUMP');
    const p = a.road.at(a.s); exchange(a, -push * Math.sin(p.t), push * Math.cos(p.t), hit ? CFG.CRASH_BOUNCE : 0); if (hit) wreck(a);   // n: from the vehicle to the truck, along the road
    const k = share(a); st.s -= push * penS * (1 - k); a.s += push * penS * k;   // full overlap, both ways (a 1.5 m cap left the car inside the cab), split by weight
    return null;
  }
  const hit = freshHit(a);
  if (frac >= CFG.CRASH_OVERLAP && rel < -TRAILER_BACK + 1) {   // something ran into the trailer's tail
    if (hit) harm(a, bumpDmg(def, Math.max(closing, 0)), Math.max(closing, 0), 'BUMP');
    const p = a.road.at(a.s); exchange(a, Math.sin(p.t), -Math.cos(p.t), hit ? CFG.CRASH_BOUNCE : 0); if (hit) wreck(a);
    a.s -= a.dir * penS; return null;
  }
  const rv = Math.abs(vs - tb.v);   // sideswipe: scrape, push apart, a little speed lost (not counted as a crash)
  if (hit) { audio.play('scrape', .7); harm(a, CFG.SCRATCH_DMG * clamp(rv / 10, .4, 2) * Math.sqrt(def.mass), rv * .3, 'SCRATCH', false); st.psi -= sgn * .03; st.v *= .98; }
  const k = share(a); st.d -= sgn * penL * (1 - k); a.lat += sgn * penL * k; if ((a.lat - tb.el) * a.lv < 0) a.lv = 0;
  return null;
}

/* per physics step: spawn / move / despawn vehicles, then test contact. Returns a failure reason when the truck had a direct hit. */
function updateTraffic(dt) {
  if (!CFG.TRAFFIC) return null;
  truckPose();
  const boxes = new Map(), boxFor = road => {
    if (!boxes.has(road)) boxes.set(road, road.main || Math.abs(road.j.s - TK.m) < 70 || Math.abs(road.j.s - st.s) < 70 ? truckBox(road) : null);
    return boxes.get(road);
  };
  if ((T.spawnT -= dt) <= 0) {
    T.spawnT = CFG.TRAFFIC_GAP / trip.traffic * (.6 + T.rng() * .8);
    const nMain = cars.reduce((k, a) => k + (a.road.main ? 1 : 0), 0);
    if (nMain < Math.round(CFG.TRAFFIC_MAX * trip.traffic)) {
      const r = T.rng();
      if (net.straight && st.s < net.Sm + 30) spawnRandom('ahead');   // a straight start: nothing may come down the depot road towards the truck
      else if (st.s < net.Sm) spawnRandom(r < .15 ? 'ahead' : r < .55 ? 'behind' : 'oncoming');   // waiting at the depot exit: keep the main road busy past it
      else spawnRandom(r < .4 ? 'ahead' : r < .65 && st.v > 8 ? 'behind' : 'oncoming');
    }
  }
  const crossMax = Math.round(CFG.CROSS_MAX * trip.cross);
  for (const j of net.near(TK.m - 300, TK.m + 900)) {   // cross traffic at signalled crossroads in range
    if (j.kind !== 'cross' || !j.signal || !crossMax) continue;
    let t = T.cross.get(j.id);
    if (t === undefined) { t = T.rng() * CFG.CROSS_GAP; for (let i = 0; i < 2; i++) spawnCross(j, (T.rng() - .5) * 2 * (j.len - 60)); }   // first sight: already some on it
    if ((t -= dt) <= 0) { t = CFG.CROSS_GAP * (.6 + T.rng() * .8); if (cars.filter(a => a.road.j === j).length < crossMax) spawnCross(j); }
    T.cross.set(j.id, t);
  }
  let fatal = null;
  for (let i = cars.length - 1; i >= 0; i--) {
    const a = cars[i], tb = boxFor(a.road); a.t += dt; a.touch += dt; a.cool = Math.max(0, a.cool - dt); think(a, dt, tb); place(a, dt);
    const gone = a.road.main ? a.s < TK.m - 300 || a.s > TK.m + 900 || a.s < (net.straight ? 40 : net.Sm - 1450) : Math.abs(a.s) > a.road.j.len - 5 || Math.abs(a.road.j.s - TK.m) > 1100;
    if (gone) { removeVehicle(a.mesh); cars.splice(i, 1); continue; }
    if (!fatal && tb && Math.abs(a.s - tb.s) < 25 + a.def.len + tb.len / 2) {
      const s0 = a.s, l0 = a.lat; fatal = contact(a, tb);
      a.vs = clamp(a.vs + (s0 - a.s) * a.dir, -3, 3); a.vl = clamp(a.vl + l0 - a.lat, -3, 3);   // (the shown position stays where it was; the push fades in)
    }
  }
  return fatal;
}

/* the traffic around the truck for a spectator's replay (live streams – telemetry.js records it at TRAFFIC_HZ, watch.js redraws it): the nearest
   vehicles within `range` m as flat rows of 7 – [id, type, colour pick, x, z, yaw, flags (1 brake · 2 siren)] in WORLD coordinates. Display only:
   the verdict never reads it. */
/** a fork's road was switched (net/orchestrator.js): the main-road cars inside it stood on the road that is now the OTHER one – take them off (the spawn zones refill) */
function clearStretch(s0, s1) {
  for (let i = cars.length - 1; i >= 0; i--) { const a = cars[i]; if (a.road.main && a.s >= s0 && a.s <= s1) { removeVehicle(a.mesh); cars.splice(i, 1); } }
}

return { cars, MAIN, spawn, resetTraffic, updateTraffic, clearStretch, get spawned() { return T.ids; } };
}
