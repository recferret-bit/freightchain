import { CFG } from '../config.js';
import { clamp, mulberry32, rnd } from '../util.js';
import { roadAt, setRoadProfile, invalidateRoad } from '../road.js';
import { PATTERNS, DEFAULT_WEIGHTS, FORK } from './patterns.js';
import { trip } from '../trips.js';

/* The ROAD NETWORK: an endless road generated lazily, ahead of the truck, from a seeded PRNG – so the whole layout is a pure function of the ride seed
   (and the route's bend style). Pure data + queries, no three.js: world/ builds meshes from it, sim/ drives on it, net/orchestrator.js runs it.

   The player's road is still ONE centre-line ("the spine", s along it, d across it, + = right). Everything else is a feature of the spine:
   - the START: s 0..sA = the depot's access road, sA..Sm = a 90° right turn onto the MAIN road, which is the spine from Sm on.
     Traffic always drives on the main road; for m < Sm it is a straight extension behind the turn (`mainAt`), so cars pass the depot exit both ways.
   - SEGMENTS: lane layout (1-3 lanes per direction), bend scale and centre-line style of each stretch; a lane change is a TAPER m transition.
   - JUNCTIONS: crossroads / T-junctions at fixed s, with or without traffic lights. Side roads are straight lines across the spine (the player can't turn
     into them); the spine is kept straight around every junction (`calm`).
   - FORKS (trips that ask for them – patterns.js FORK): the road splits into two roads that meet again; the spine is the one the truck is on (`choice`),
     the other is its mirror image about the chord (`altAt`), drawn beside it. Same length, same lanes, same holes: in (s, d) they are one road, so a
     switch (`setChoice`, at the commit point – net/orchestrator.js) only re-integrates the spine's geometry inside the fork.
   Lanes: lane i of a direction is centred at dir·(LANE0 + i·LW) – the inner lane stays at ±2.4 as on the old two-lane road, extra lanes are added outward. */
const LANE0 = 2.4;
export const LW = 4.2, TAPER = 120, SHOULDER = 1.2, SIDE_LEN = 450;
export const edgeOf = n => 4.5 + (n - 1) * LW;            // edge-line distance from the centre for n lanes (fractional during a taper)
export const laneLat = (dir, i) => dir * (LANE0 + i * LW);
const ACCESS = { nR: 1, nL: 1, centre: 'none', edge: false, pat: 'access' };   // depot road: plain two-lane width, unmarked

const smooth = x => x * x * (3 - 2 * x);
const forkG = u => { u = clamp(u, 0, 1); const a = Math.sin(Math.PI * u); return Math.sin(2 * Math.PI * u) * a * a; };   // a fork's heading profile (patterns.js FORK)

class RoadNetwork {
  constructor() { this.style = { curv: () => 0, weights: DEFAULT_WEIGHTS }; this.reset(1); }
  /* the selected route: its curvature profile is the "bend style", its `roads.weights` pick the patterns */
  setStyle(theme) { this.style = { curv: theme.curv ?? (() => 0), weights: { ...DEFAULT_WEIGHTS, ...theme.roads?.weights } }; }
  /* a new layout (new ride, or the same seed again after a route switch); installs the curvature into road.js */
  reset(seed) {
    this.seed = seed >>> 0; this.rng = mulberry32(this.seed); this.clock = 0;
    const L = Math.round(Math.PI / 2 * CFG.START_TURN_R);
    this.straight = trip.start === 'straight';   // the trip's start (trips.js): no turn – the same sA / Sm / start junction in road coordinates (the server's), only not drawn or driven as one
    this.sA = Math.round(CFG.START_ACCESS); this.Sm = this.sA + L; this.kTurn = this.straight ? 0 : Math.PI / 2 / L; this.R = L / (Math.PI / 2);
    this.segs = []; this.js = []; this.forks = []; this.genEnd = this.Sm; this.patEnd = this.Sm; this.pat = null; this.nextJ = Infinity; this.jn = 0;
    const first = trip.road?.first ?? ['country'];
    this.weights = trip.road?.weights ?? this.style.weights; this.queue = first.slice(1);   // the trip's layout (trips.js road), else the route's pattern weights
    this.pickPattern(first[0], 500 + this.rng() * 600);   // the depot exit: a plain two-lane road (the easy free run: straight onto four lanes)
    this.ensure(this.Sm + 1);
    const s0 = this.segs[0], halfR = edgeOf(s0.nR) + .3, halfL = edgeOf(s0.nL) + .3;
    this.start = { id: 'j0', kind: 'start', s: this.Sm, signal: false, halfR, halfL, pad: { a0: -(this.R + 7.5), a1: 4, l0: -(halfL + SHOULDER), l1: this.R + 2 } };
    this.js.unshift(this.start);
    setRoadProfile(s => this.curv(s));
    const p = roadAt(this.Sm); this.P = p; this.f = [Math.sin(p.t), -Math.cos(p.t)]; this.r = [Math.cos(p.t), Math.sin(p.t)];
    return this;
  }

  /* ───────────── generation (sequential, so the layout only depends on the seed) ───────────── */
  ensure(s) { while (this.genEnd < s) this.generate(); }
  pickPattern(id, len) {
    if (!id && this.queue?.length) id = this.queue.shift();   // the trip's opening patterns (no draw for the pick – road-layout.ts the same)
    if (!id) {
      const w = this.weights, ks = Object.keys(PATTERNS).filter(k => (w[k] ?? 0) > 0 && (k !== this.pat?.id || Object.keys(PATTERNS).filter(q => (w[q] ?? 0) > 0).length < 2));
      let x = this.rng() * ks.reduce((a, k) => a + w[k], 0); id = ks[ks.length - 1];
      for (const k of ks) if ((x -= w[k]) < 0) { id = k; break; }
    }
    const P = PATTERNS[id]; this.pat = { id, ...P };
    this.patEnd = this.genEnd + (len ?? P.len[0] + this.rng() * (P.len[1] - P.len[0]));
  }
  generate() {
    if (this.genEnd >= this.patEnd - 1) this.pickPattern();
    const P = this.pat, r = this.rng, s0 = this.genEnd;
    let x = r() * P.lanes.reduce((a, l) => a + l[2], 0), lanes = P.lanes[0];
    for (const l of P.lanes) if ((x -= l[2]) < 0) { lanes = l; break; }
    let len = P.seg[0] + r() * (P.seg[1] - P.seg[0]); if (this.patEnd - (s0 + len) < P.seg[0] * .6) len = this.patEnd - s0;
    const prev = this.segs[this.segs.length - 1], seg = { s0, s1: s0 + len, nR: lanes[0], nL: lanes[1], bends: P.bends, centre: P.centre, pat: P.id };
    seg.prev = prev ?? { ...seg, nR: 1, nL: 1 }; this.segs.push(seg); this.genEnd = seg.s1;   // prev of the first stretch: the depot's two-lane road, so it widens out of it (a 1+1 country road: nothing changes)
    if (P.fork) this.forks.push(seg.fork = { i: this.forks.length, f0: s0, f1: seg.s1, side: rnd(this.seed % 9973 + s0 * .37) < .5 ? -1 : 1, choice: 0 });   // side: where the DEFAULT road bulges (+1 right) – a hash, no draw from the stream (geometry only, the server never needs it)
    const J = P.junction;
    if (!J) { this.nextJ = Infinity; return; }
    const lo = s0 + TAPER + 100, hi = seg.s1 - 120;
    if (!isFinite(this.nextJ)) this.nextJ = s0 + r() * J.gap[0];
    while (this.nextJ < hi) {
      if (this.nextJ < lo) { this.nextJ = lo; continue; }
      this.addJunction(Math.round(this.nextJ), J, seg); this.nextJ += J.gap[0] + r() * (J.gap[1] - J.gap[0]);
    }
  }
  addJunction(s, J, seg) {
    const r = this.rng, kind = r() < J.cross ? 'cross' : 'tee', side = r() < .5 ? -1 : 1, signal = r() < J.signal, sl = J.side[Math.floor(r() * J.side.length)];
    const sideHalf = edgeOf(sl) + .3, mouth = sideHalf + 1.5, halfR = edgeOf(seg.nR) + .3, halfL = edgeOf(seg.nL) + .3, rr = ([a, b]) => a + r() * (b - a);
    const cyc = { g: rr(CFG.SIGNAL_GREEN), c: rr(CFG.SIGNAL_CROSS), a: CFG.SIGNAL_AMBER, r: CFG.SIGNAL_CLEAR };
    cyc.T = cyc.g + cyc.c + 2 * (cyc.a + cyc.r);
    this.js.push({ id: 'j' + (++this.jn), s, kind, side: kind === 'tee' ? side : 0, arms: kind === 'cross' ? [-1, 1] : [side], signal, sl, sideHalf, mouth, halfR, halfL, nR: seg.nR, nL: seg.nL, len: SIDE_LEN,
      cyc, off: r() * cyc.T, pad: { a0: -mouth, a1: mouth, l0: -(halfL + SHOULDER), l1: halfR + SHOULDER } });
  }

  /* ───────────── queries ───────────── */
  segAt(m) {
    this.ensure(m + 1); const a = this.segs; let lo = 0, hi = a.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (a[mid].s0 <= m) lo = mid; else hi = mid - 1; }
    return a[lo];
  }
  /* junctions with lo <= s <= hi (sorted by s) */
  near(lo, hi) {
    this.ensure(hi + 1); const a = this.js, out = []; let i = 0, j = a.length;
    while (i < j) { const mid = (i + j) >> 1; if (a[mid].s < lo) i = mid + 1; else j = mid; }
    for (; i < a.length && a[i].s <= hi; i++) out.push(a[i]);
    return out;
  }
  /* first junction strictly ahead of s in direction dir within `max` m (with `pred`) */
  nextJunction(s, dir = 1, max = 800, pred = () => true) {
    const js = this.near(s - (dir < 0 ? max : 0), s + (dir > 0 ? max : 0));
    if (dir < 0) js.reverse();
    return js.find(j => (j.s - s) * dir > 0 && pred(j)) ?? null;
  }
  /* 0 near a junction .. 1 in the open: the spine is straight around junctions so side roads can cross it at a right angle */
  calm(s) {
    let k = 1;
    for (const j of this.near(s - 330, s + 220)) if (j.kind !== 'start' || (s >= this.Sm && !this.straight)) k = Math.min(k, smooth(clamp((Math.abs(s - j.s) - ((j.mouth ?? 110) + 50)) / 110, 0, 1)));   // start: straight for 160 m (mainCoords relies on it)
    for (const f of this.forksNear(s - 110, s + 110)) k = Math.min(k, smooth(clamp(Math.max(f.f0 - s, s - f.f1, 0) / 110, 0, 1)));   // a fork's chord is straight, and so is the road 110 m either side of it
    return k;
  }
  curv(s) {
    if (s < this.sA) return 0;
    if (s < this.Sm) return this.kTurn;
    this.ensure(s + 600);
    const seg = this.segAt(s), t = clamp((s - seg.s0) / TAPER, 0, 1), bends = seg.prev.bends + (seg.bends - seg.prev.bends) * t;
    const k = this.style.curv(s) * bends * this.calm(s) * trip.bends + this.forkCurv(s);
    return this.straight ? k * smooth(clamp((s - this.Sm) / CFG.START_FADE, 0, 1)) : k;   // a straight start: the depot road is straight, the bends come in over START_FADE m once it is the main road   // trip.bends: the ride tier's bend scale (trips.js) – geometry only, the server's port has no curvature
  }
  /* cross-section at spine position s: { nR, nL (lanes per direction, fractional in a taper), centre (style | null = route's own | 'none'), edge (edge lines?), pat } */
  xs(s) { return s < this.Sm ? ACCESS : this.mainXs(s); }
  mainXs(m) {
    const seg = this.segAt(Math.max(m, this.Sm)), t = clamp((m - seg.s0) / TAPER, 0, 1), p = seg.prev;
    return { nR: p.nR + (seg.nR - p.nR) * t, nL: p.nL + (seg.nL - p.nL) * t, centre: seg.nR > 1 || seg.nL > 1 ? 'double' : seg.centre, edge: true, pat: seg.pat };
  }
  /* whole lanes a vehicle driving in `dir` has at main-road position m */
  lanes(m, dir) { const x = this.mainXs(m); return Math.max(1, Math.floor((dir > 0 ? x.nR : x.nL) + 1e-6)); }
  edges(s) { const x = this.xs(s); return [-edgeOf(x.nL), edgeOf(x.nR)]; }   // edge lines (left, right)
  /* roadside things (posts, props, buildings, signs) were laid out for the 12 m wide two-lane road: push them outward with the road edge */
  roadside(s, lat) {
    if (Math.abs(lat) < 5) return lat;
    const x = this.xs(s), out = edgeOf(lat > 0 ? x.nR : x.nL) + .3 + SHOULDER;
    return lat + Math.sign(lat) * (out - 6);
  }

  /* ───────────── main road: the spine from Sm on, a straight line behind the turn ───────────── */
  mainAt(m) { if (m >= this.Sm) return roadAt(m); const k = m - this.Sm, P = this.P; return { x: P.x + this.f[0] * k, z: P.z + this.f[1] * k, t: P.t }; }
  /* world point -> main-road coordinates { s, lat } (hint = a nearby main-road s) */
  mainCoords(x, z, hint = this.Sm) {
    const P = this.P; let m = this.Sm + (x - P.x) * this.f[0] + (z - P.z) * this.f[1];
    if (this.straight || m > this.Sm + 150 || hint > this.Sm + 150) {   // on the curving part (or anywhere after a straight start – it bends right after Sm): a few Newton steps along the spine
      if (hint > this.Sm + 150) m = hint;
      for (let i = 0; i < 3; i++) { const p = roadAt(m); m += (x - p.x) * Math.sin(p.t) - (z - p.z) * Math.cos(p.t); }
    }
    const p = this.mainAt(m); return { s: m, lat: (x - p.x) * Math.cos(p.t) + (z - p.z) * Math.sin(p.t) };
  }
  /* straight line of a junction's side road: c along it (+ = towards the spine's right), lat across it */
  lineOf(j) {
    if (!j.line) {
      const p = roadAt(j.s), t = p.t + Math.PI / 2, sn = Math.sin(t), cs = Math.cos(t);
      j.line = { j, t, x0: p.x, z0: p.z, at: c => ({ x: p.x + sn * c, z: p.z - cs * c, t }), coords: (x, z) => ({ s: (x - p.x) * sn - (z - p.z) * cs, lat: (x - p.x) * cs + (z - p.z) * sn }) };
    }
    return j.line;
  }
  /* spine (s, d) -> world */
  world(s, d) { const p = roadAt(s); return { x: p.x + Math.cos(p.t) * d, z: p.z + Math.sin(p.t) * d }; }

  /* ───────────── signals ───────────── */
  /* 'G' | 'A' | 'R' for approach 'main' (along the spine) or 'cross' (side road); unsignalled: main 'G', side 'S' (stop sign) */
  signal(j, app) {
    if (!j.signal) return app === 'main' ? 'G' : 'S';
    const c = j.cyc; let t = (this.clock + j.off) % c.T;
    if (t < c.g) return app === 'main' ? 'G' : 'R'; t -= c.g;
    if (t < c.a) return app === 'main' ? 'A' : 'R'; t -= c.a + c.r;
    if (t < 0) return 'R';
    if (t < c.c) return app === 'main' ? 'R' : 'G'; t -= c.c;
    return t < c.a && app === 'cross' ? 'A' : 'R';
  }
  stopLine(j, dir) { return j.s - dir * (j.mouth + 2); }   // spine s of the main-road stop line for traffic driving in `dir`

  /* ───────────── areas ───────────── */
  inPad(j, a, l) { const p = j.pad; return a >= p.a0 && a <= p.a1 && l >= p.l0 && l <= p.l1; }
  /* is the spine point (s, d) on a drivable surface (lanes + .5 m, the depot yard, a junction apron, a side road, the main road at the start)? */
  onRoad(s, d) {
    if (s > -80 && s < 30 && Math.abs(d) < 34) return true;   // depot yard
    const [l, r] = this.edges(s); if (d >= l - .5 && d <= r + .5) return true;
    if (this.apron(s)) { const f = this.forkAt(s), a = -this.bulge(f) * this.sep(s); if (d >= Math.min(l, l + a) - .5 && d <= Math.max(r, r + a) + .5) return true; }   // a fork's split / merge: both roads' tarmac (the server allows FORK.corridor m either way there)
    for (const j of this.near(s - 90, s + 90)) {
      if (j.kind === 'start') {
        if (this.straight) continue;   // no turn, no apron: the depot road is just the road
        const w = this.world(s, d), c = this.mainCoords(w.x, w.z), a = c.s - this.Sm;
        if (this.inPad(j, a, c.lat) || (a <= 0 && a > -2000 && c.lat >= -j.halfL - .2 && c.lat <= j.halfR + .2)) return true;
      } else if (this.inPad(j, s - j.s, d) || (Math.abs(s - j.s) < j.sideHalf + .5 && j.arms.includes(Math.sign(d)) && Math.abs(d) < j.len)) return true;
    }
    return false;
  }
  /* roadside clutter (props, posts, landmarks…) must not stand here: the yard, the start junction's main road + apron, side roads, junction corners */
  keepOut(s, lat, alt = false) {
    if (s > -90 && s < 32 && Math.abs(lat) < 38) return true;
    if (this.forks.length && this.onOtherRoad(s, lat, alt)) return true;   // in a fork: nothing on the other road (alt = (s, lat) is on the other road's own side)
    if (!this.straight && s > this.sA - 80 && s < this.Sm + 60) {
      const w = this.world(s, lat), c = this.mainCoords(w.x, w.z), a = c.s - this.Sm, j = this.start;
      if (a < 30 && a > -900 && c.lat > -j.halfL - 4 && c.lat < j.halfR + 4) return true;
      const p = j.pad; if (a > p.a0 - 3 && a < p.a1 + 3 && c.lat > p.l0 - 3 && c.lat < p.l1 + 3) return true;
    }
    for (const j of this.near(s - 40, s + 40)) {
      if (j.kind === 'start') continue;
      if (Math.abs(s - j.s) < j.sideHalf + SHOULDER + 3 && j.arms.includes(Math.sign(lat))) return true;
      if (Math.abs(s - j.s) < j.mouth + 4 && lat > -j.halfL - 5 && lat < j.halfR + 5) return true;
    }
    return false;
  }
  /* no landmark buildings near the start or a junction */
  busy(s0, s1) { return s0 < this.Sm + 60 || this.near(s0 - 40, s1 + 40).some(j => j.kind !== 'start'); }
  /* plain road for road holes: past the start, away from junctions and lane tapers */
  plain(s, margin = 60) {
    if (s < this.Sm + margin || this.near(s - margin, s + margin).length) return false;
    const seg = this.segAt(s); return s - seg.s0 > TAPER + 10 && seg.s1 - s > 10;
  }
  /* ───────────── forks ───────────── */
  /** forks overlapping [lo, hi] (generated up to hi) */
  forksNear(lo, hi) { this.ensure(hi + 1); return this.forks.filter(f => f.f1 >= lo && f.f0 <= hi); }
  /** the fork whose split .. merge holds s, or null */
  forkAt(s) { if (!this.forks.length || s < this.Sm) return null; const g = this.segAt(s); return g.fork ?? null; }
  /** +1 / −1: the side the road the truck is on bulges to (the other road bulges the other way) */
  bulge(f) { return f.choice ? -f.side : f.side; }
  /* the curvature the fork adds at s: the difference of its heading profile over the 1 m step road.js integrates (so the heading closes exactly) */
  forkCurv(s) {
    const f = this.forkAt(s + 1) ?? this.forkAt(s); if (!f) return 0;
    const L = f.f1 - f.f0; return this.bulge(f) * FORK.bulge * (forkG((s + 1 - f.f0) / L) - forkG((s - f.f0) / L));
  }
  /* the mirror about the fork's chord (the straight line from the split along its heading): it maps one of the two roads onto the other */
  mirror(f, x, z) {
    const O = roadAt(f.f0), fx = Math.sin(O.t), fz = -Math.cos(O.t), rx = Math.cos(O.t), rz = Math.sin(O.t), vx = x - O.x, vz = z - O.z;
    const a = vx * fx + vz * fz, b = vx * rx + vz * rz; return { x: O.x + a * fx - b * rx, z: O.z + a * fz - b * rz, t0: O.t };
  }
  /** the OTHER road of the fork at s: its centre point and heading (+ its own right side, like roadAt) – the spine where there is no fork */
  altAt(s) {
    const f = this.forkAt(s), p = roadAt(s); if (!f) return p;
    const m = this.mirror(f, p.x, p.z); return { x: m.x, z: m.z, t: 2 * m.t0 - p.t };
  }
  altWorld(s, d) { const p = this.altAt(s); return { x: p.x + Math.cos(p.t) * d, z: p.z + Math.sin(p.t) * d }; }
  /** metres between the two roads' centre lines at s (0 outside a fork) */
  sep(s) { const f = this.forkAt(s); if (!f) return 0; const O = roadAt(f.f0), p = roadAt(s); return 2 * Math.abs((p.x - O.x) * Math.cos(O.t) + (p.z - O.z) * Math.sin(O.t)); }
  /** in the split / merge stretch of a fork, where the two roads' tarmac is still one apron */
  apron(s) { const f = this.forkAt(s); return !!f && Math.min(s - f.f0, f.f1 - s) < FORK.commit; }
  /** world point → (s, lat) on the spine near s (a few Newton steps) */
  spineCoords(x, z, hint) {
    let m = hint; for (let i = 0; i < 4; i++) { const p = roadAt(m); m += (x - p.x) * Math.sin(p.t) - (z - p.z) * Math.cos(p.t); }
    const p = roadAt(m); return { s: m, lat: (x - p.x) * Math.cos(p.t) + (z - p.z) * Math.sin(p.t) };
  }
  /* does the road point (s, lat) – on the spine, or on the other road (alt) – stand on the OTHER road of its fork (its tarmac + `margin`)? */
  onOtherRoad(s, lat, alt = false, margin = SHOULDER + 3) {
    const f = this.forkAt(s); if (!f) return false;
    const w = alt ? this.altWorld(s, lat) : this.world(s, lat), q = alt ? w : this.mirror(f, w.x, w.z), c = this.spineCoords(q.x, q.z, s);   // the other road = the spine's mirror image
    if (c.s < f.f0 || c.s > f.f1) return false;
    const [l, r] = this.edges(c.s); return c.lat > l - .3 - margin && c.lat < r + .3 + margin;
  }
  /** switch the road the truck is on at fork f (0 = the default one): the spine inside it is integrated again – everything after the merge stays where it was */
  setChoice(f, choice) {
    if (f.choice === choice) return false;
    f.choice = choice; invalidateRoad(f.f0); return true;
  }
  /** the road the truck crossed into: when it passes a fork's commit point going forward, the one it is nearer to – { f, choice } or null */
  commitAt(s0, s1, d) {
    if (s1 <= s0) return null;
    const f = this.forkAt(s1); if (!f) return null;
    const c = f.f0 + FORK.commit; if (!(s0 < c && s1 >= c)) return null;
    const toAlt = d * -this.bulge(f) > this.sep(s1) / 2;   // the other road lies on the side opposite the bulge
    return { f, choice: toAlt ? 1 - f.choice : f.choice };
  }

  /* "COUNTRY ROAD 1+1" for the HUD */
  describe(s) { if (s < this.Sm) return 'DEPOT ROAD'; const x = this.mainXs(s); return (PATTERNS[x.pat]?.name ?? x.pat) + ' ' + Math.round(x.nR) + '+' + Math.round(x.nL); }
}
export const net = new RoadNetwork();
