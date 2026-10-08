import * as THREE from 'three';
import { CFG } from '../config.js';
import { rnd } from '../util.js';
import { GEO, MAT } from './props.js';
import { canvasTex } from './scene.js';
import { mesh, group } from './pool.js';
import { net, laneLat } from '../net/network.js';

/* Road holes + their advance warning signs. A hole is NOT a prop/collider: the truck drives over it (sim/damage.js `hitHoles`), the AI steers around it (sim/traffic.js `dodge`).
   Placement is a pure function of the chunk index (`holeAt`), so traffic can look at holes in chunks that aren't built yet. Same footprints feed meshes, truck wheels and AI.
   Footprint: ells = ellipses { ds (along road, + = forward), dl (across, + = right), a (half length), b (half width) } relative to the hole's centre (s, lat).
   dmg = hull % per wheel-axle entry at 28 m/s (× (v/28)², rear axles ×.6), slow = speed fraction lost, jolt = cab shake, kick = steering pull, crawl = m/s the AI drops to when it can't get around. */
/* Only types with `cones` are placed on the road (the small ones stay in the table, e.g. for debugging). */
const CH = CFG.CHUNK_LEN;   // = chunks.js CH (not imported: chunks.js imports this module)
export const HOLES = {
  pothole: { name: 'POTHOLE',  ells: [{ ds: 0, dl: 0, a: .6, b: .5 }], dmg: 2.5, slow: .04, jolt: .5, kick: .03, crawl: 7 },   // fits between the wheel tracks if you straddle it
  deep:    { name: 'DEEP HOLE', ells: [{ ds: 0, dl: 0, a: .85, b: .8 }], dmg: 7, slow: .12, jolt: .9, kick: .07, crawl: 5 },
  cluster: { name: 'HOLES',    ells: [{ ds: -3, dl: -.9, a: .5, b: .45 }, { ds: 0, dl: .8, a: .6, b: .5 }, { ds: 3, dl: -.3, a: .5, b: .45 }], dmg: 1.8, slow: .03, jolt: .45, kick: .03, crawl: 7 },   // each pit hits separately
  trench:  { name: 'TRENCH',   ells: [{ ds: 0, dl: 0, a: .45, b: 2.3 }], dmg: 6, slow: .15, jolt: 1, kick: .02, crawl: 4, lane: true },   // lane-wide: change lanes or slow down
  sinkhole: { name: 'SINKHOLE', ells: [{ ds: 0, dl: 0, a: 2, b: 2 }], dmg: 14, slow: .35, jolt: 1, kick: .1, crawl: 3, lane: true, cones: true },
};
const IDS = Object.keys(HOLES).filter(k => HOLES[k].cones), SIGN_LAT = 7.6;   // beyond the delineator posts (6.6) and guardrails (6.9)

const cache = new Map(), placed = new Map();   // placed: holes put on the road by a spectator's donation (live streams) – they replace the chunk's own roll
const shape = (id, ci, type, s, lat) => { const T = HOLES[type]; return { id, ci, type, s, lat, ells: T.ells, l0: lat + Math.min(...T.ells.map(e => e.dl - e.b)), l1: lat + Math.max(...T.ells.map(e => e.dl + e.b)), ext: Math.max(...T.ells.map(e => Math.abs(e.ds) + e.a)) }; };
export function holeAt(ci) {   // → { id, ci, type, s, lat, ells, l0, l1, ext } | null; l0..l1 = lateral extent, ext = half length along the road
  if (placed.has(ci)) return placed.get(ci);
  if (cache.has(ci)) return cache.get(ci);
  let h = null; const q = k => rnd(ci * 97.13 + k * 3.71), s = ci * CH + 4 + q(1) * 24;   // (rnd on ci*13+k clusters badly: sin hash)
  if (CFG.HOLES && ci >= 0 && q(2) < CFG.HOLE_CHANCE && s >= net.Sm + CFG.HOLE_FIRST && net.plain(s, 70)) {   // never on the depot road, at a junction or in a lane taper
    const type = IDS[Math.floor(q(3) * IDS.length)], T = HOLES[type], r = q(4), j = q(5) - .5, dir = T.lane ? (r < .7 ? 1 : -1) : r < .6 ? 1 : -1, lane = laneLat(dir, Math.floor(q(6) * net.lanes(s, dir)));
    const lat = T.lane ? lane : r < .85 ? lane + j * 1.6 : j * 1.2;   // lane-wide: own side 70 %; small: own side 60 %, oncoming 25 %, centre line 15 %
    h = shape('h' + ci, ci, type, s, lat);
  }
  cache.set(ci, h); return h;
}
export function holesNear(s0, s1) {
  const out = [];
  for (let ci = Math.floor((s0 - 8) / CH); ci <= Math.floor((s1 + 8) / CH); ci++) { const h = holeAt(ci); if (h) out.push(h); }
  return out;
}
export const clearHoleCache = () => { cache.clear(); placed.clear(); };   // new road layout (net/orchestrator.js), or CFG.HOLES / HOLE_CHANCE / HOLE_FIRST changed at runtime (debug)
/* A spectator's obstacle (ui/live-feed.js on the driver's side, watch.js in a replay): `type` from HOLES at road position s / lateral lat, exactly where the
   driver's game put it – the stamp the server keeps – so every replay has it in the same place. Returns its chunk index (the caller rebuilds that chunk if built). */
export function placeHole(type, s, lat, id) {
  if (!HOLES[type]) return null;
  const ci = Math.floor(s / CH); placed.set(ci, shape(id ?? 'live' + ci, ci, type, s, lat)); return ci;
}
/** the first chunk at or after s where a placed obstacle fits: past the depot turn, not at a junction or a lane taper (same rule as the natural holes) */
export function obstacleSpot(s) {
  for (let ci = Math.ceil(s / CH); ci < Math.ceil(s / CH) + 40; ci++) { const at = ci * CH + CH / 2; if (at >= net.Sm + CFG.HOLE_FIRST && net.plain(at, 70) && !placed.has(ci)) return at; }
  return null;
}

/* ───────────────────────── meshes ───────────────────────── */
/* Route-independent materials, DoubleSide (so the mirror pass leaves them alone). Drawn just above the road ribbon (y .03) with a polygon offset against z-fighting. */
const dec = (color, up = 0) => new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 - up, polygonOffsetUnits: -2 - up });
const M = { rim: dec(0x68625a), crumb: dec(0x4a4540, 1), pit: dec(0x0f0d0c, 2), deep: dec(0x000000, 3), cone: new THREE.MeshBasicMaterial({ color: 0xff6a1a }), band: new THREE.MeshBasicMaterial({ color: 0xf2f2ea }), gravel: new THREE.MeshBasicMaterial({ color: 0x6b6258 }) };
export const holeMats = [M.cone, M.band, M.gravel];   // single-sided: the mirror pass must flip them (render.js)
const DISC = new THREE.CircleGeometry(1, 20);
const disc = (g, mat, x, z, a, b, y) => { const m = mesh(DISC, mat); m.rotation.x = -Math.PI / 2; m.scale.set(b, a, 1); m.position.set(x, y, z); g.add(m); };   // lies flat: local x = across the road, local z = backwards
const slab = (g, mat, x, z, w, l, y) => { const m = mesh(GEO.box, mat); m.scale.set(w, .01, l); m.position.set(x, y, z); g.add(m); };
function makeHole(h) {
  const g = group(), T = HOLES[h.type], k = h.ci * 7;
  if (h.type === 'trench') {
    slab(g, M.rim, 0, 0, 4.7, 1.25, .04); slab(g, M.crumb, 0, 0, 4.55, .95, .043); slab(g, M.pit, 0, 0, 4.3, .55, .047); slab(g, M.deep, 0, 0, 4.1, .22, .05);
    for (let i = 0; i < 5; i++) { const q = .12 + rnd(k + i) * .1, m = mesh(GEO.box, M.gravel); m.scale.set(q, q * .6, q); m.position.set((rnd(k + i + .3) - .5) * 4.4, .04, (rnd(k + i + .6) < .5 ? -1 : 1) * (.7 + rnd(k + i + .9) * .3)); m.rotation.y = rnd(k + i) * 3; g.add(m); }
    return g;
  }
  for (const e of T.ells) {
    const z = -e.ds, big = e.a > 1.5;
    disc(g, M.rim, e.dl, z, e.a * 1.4, e.b * 1.4, .04); disc(g, M.crumb, e.dl, z, e.a * 1.15, e.b * 1.15, .043); disc(g, M.pit, e.dl, z, e.a, e.b, .047);
    disc(g, M.deep, e.dl + e.b * .12, z + e.a * .12, e.a * (big || h.type === 'deep' ? .7 : .55), e.b * (big || h.type === 'deep' ? .7 : .55), .05);   // the dark depth, a bit off-centre so it reads as a pit
    if (big) for (let i = 0; i < 9; i++) { const an = i / 9 * 6.28 + rnd(k + i), q = .15 + rnd(k + i + .4) * .2, m = mesh(GEO.box, M.gravel); m.scale.set(q, q * .6, q); m.position.set(Math.cos(an) * e.b * 1.5, .05, Math.sin(an) * e.a * 1.5); m.rotation.y = an; g.add(m); }
  }
  if (T.cones) for (const [x, z] of [[-2.7, -2.7], [2.7, -2.7], [-2.7, 2.7], [2.7, 2.7]]) {   // traffic cones at the corners
    const c = mesh(GEO.cone, M.cone); c.scale.set(.2, .7, .2); c.position.set(x, .35, z); g.add(c);
    const b = mesh(GEO.cone, M.band); b.scale.set(.145, .22, .145); b.position.set(x, .42, z); g.add(b);
  }
  return g;
}

/* warning sign: yellow diamond with a road profile showing the kind of hole + a plate with its name and the distance */
const signMats = {};
function signMat(type) {
  return signMats[type] ??= new THREE.MeshBasicMaterial({
    side: THREE.DoubleSide, transparent: true, alphaTest: .4,
    map: canvasTex(256, 352, (g, w) => {
      const c = 128; g.lineJoin = 'round'; g.lineCap = 'round';
      g.beginPath(); g.moveTo(c, 6); g.lineTo(250, 128); g.lineTo(c, 250); g.lineTo(6, 128); g.closePath(); g.fillStyle = '#ffd21f'; g.fill(); g.lineWidth = 9; g.strokeStyle = '#111'; g.stroke();
      const dips = { pothole: [[0, 24, 20]], deep: [[0, 30, 50]], cluster: [[-34, 16, 16], [0, 16, 24], [34, 16, 16]], trench: [[0, 26, 50, 1]], sinkhole: [[0, 78, 56]] }[type];
      g.beginPath(); g.moveTo(52, 128); for (const [dx, dw, dd, sq] of dips) { const x = c + dx; g.lineTo(x - dw / 2, 128); if (sq) { g.lineTo(x - dw / 2, 128 + dd); g.lineTo(x + dw / 2, 128 + dd); g.lineTo(x + dw / 2, 128); } else g.quadraticCurveTo(x, 128 + dd * 2, x + dw / 2, 128); } g.lineTo(204, 128);
      g.lineWidth = 11; g.strokeStyle = '#111'; g.stroke();
      g.fillStyle = '#111'; g.beginPath(); g.moveTo(c - 18, 108); g.lineTo(c + 18, 108); g.lineTo(c + 10, 92); g.lineTo(c - 10, 92); g.closePath(); g.fill();   // a vehicle seen from the side, about to drop in
      g.fillStyle = '#ffd21f'; g.fillRect(8, 262, w - 16, 82); g.lineWidth = 6; g.strokeRect(8, 262, w - 16, 82);
      g.fillStyle = '#111'; g.textAlign = 'center'; g.font = 'bold 34px sans-serif'; g.fillText(HOLES[type].name, c, 298); g.font = 'bold 30px sans-serif'; g.fillText(CFG.HOLE_WARN + ' m', c, 332);
    }, false),
  });
}
const SIGN_GEO = new THREE.PlaneGeometry(1.5, 2.06);
function makeSign(h) {
  const g = group();
  const pole = mesh(GEO.box, MAT.steel); pole.scale.set(.09, 2.5, .09); pole.position.set(0, 1.25, 0); g.add(pole);
  const p = mesh(SIGN_GEO, signMat(h.type)); p.position.set(0, 2.4, .06); p.rotation.y = -.18; g.add(p);   // front faces back along the road (towards the approaching truck), turned slightly in
  g.userData = { kind: 'sign', size: 1, debris: MAT.steel }; return g;
}

/* called per chunk: the hole itself if it lies in this chunk, and any warning sign (CFG.HOLE_WARN m before its hole) that falls in this chunk */
export function buildHoles(ci, s0, { place, raw, reg, destroyed }) {
  if (!CFG.HOLES) return;
  const h = holeAt(ci); if (h) raw(makeHole(h), h.s, h.lat);   // raw: holes sit in lane coordinates (place() would push |lat| ≥ 5 outward like roadside clutter)
  for (let k = 0, n = Math.ceil(CFG.HOLE_WARN / CH) + 1; k <= n; k++) {
    const hh = holeAt(ci + k); if (!hh) continue;
    const ss = hh.s - CFG.HOLE_WARN, id = hh.id + ':sign';
    if (ss < Math.max(s0, 5) || ss >= s0 + CH || destroyed.has(id)) continue;
    const sg = makeSign(hh); place(sg, ss, SIGN_LAT); reg(sg, id, ss, SIGN_LAT);
  }
}
