import * as THREE from 'three';
import { CFG } from '../config.js';
import { rnd } from '../util.js';
import { GEO, MAT } from './props.js';
import { canvasTex } from './scene.js';
import { mesh, group } from './pool.js';

/* Road holes + their advance warning signs: the MESHES. Where the holes are (the server's obstacle plan, the local roll, the holes spectators paid for)
   is net/obstacles.js – pure data, so the server's port (server/src/domain/road) can be checked against it; this module re-exports it for its old callers.
   A hole is NOT a prop/collider: the truck drives over it (sim/damage.js `hitHoles`), the AI steers around it (sim/traffic.js `dodge`). */
import { HOLES, holesIn, flagged } from '../net/obstacles.js';
export { HOLES, holeAt, holesIn, holesNear, clearHoleCache, placeHole, obstacleSpot, naturalHole, rollHole, installPlan, planCovers, plan, flagHole, flagged } from '../net/obstacles.js';
const CH = CFG.CHUNK_LEN, SIGN_LAT = 7.6;   // CH = chunks.js CH (not imported: chunks.js imports this module) · SIGN_LAT: beyond the delineator posts (6.6) and guardrails (6.9)

/* ───────────────────────── meshes ───────────────────────── */
/* Route-independent materials, DoubleSide (so the mirror pass leaves them alone). Drawn just above the road ribbon (y .03) with a polygon offset against z-fighting. */
const dec = (color, up = 0, lit = false) => new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -5 - up, polygonOffsetUnits: -5 - up, toneMapped: !lit });   // lit: self-lit, the night does not darken it
const M = { flag: dec(0xff1f1f, -1, true), rim: dec(0x68625a), crumb: dec(0x4a4540, 1), pit: dec(0x0f0d0c, 2), deep: dec(0x000000, 3), cone: new THREE.MeshBasicMaterial({ color: 0xff6a1a }), band: new THREE.MeshBasicMaterial({ color: 0xf2f2ea }), gravel: new THREE.MeshBasicMaterial({ color: 0x6b6258 }) };
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
  if (flagged.has(h.id)) for (const e of T.ells) disc(g, M.flag, e.dl, -e.ds, e.a * 1.9 + .6, e.b * 1.9 + .6, .036);   // a replay's NO IMPACT mark: the truck drove through this one untouched
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
  for (const h of holesIn(ci)) raw(makeHole(h), h.s, h.lat);   // raw: holes sit in lane coordinates (place() would push |lat| ≥ 5 outward like roadside clutter)
  for (let k = 0, n = Math.ceil(CFG.HOLE_WARN / CH) + 1; k <= n; k++) for (const hh of holesIn(ci + k)) {
    const ss = hh.s - CFG.HOLE_WARN, id = hh.id + ':sign';
    if (ss < Math.max(s0, 5) || ss >= s0 + CH || destroyed.has(id)) continue;
    const sg = makeSign(hh); place(sg, ss, SIGN_LAT); reg(sg, id, ss, SIGN_LAT);
  }
}
