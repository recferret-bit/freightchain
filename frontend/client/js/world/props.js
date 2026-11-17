import * as THREE from 'three';
import { mesh } from './pool.js';

/* Shared prop geometry, the few route-independent materials, and the destructible-prop table (KINDS).
   The prop SHAPES are entities (client/shared/entity/seed/prop/, built by world/entity-build.js); each route picks them and supplies the materials in themes/<route>/props.js. */

/* Pure BufferGeometry builders for sculpted kitbash primitives (unit [-0.5..0.5]^3 bounds, planar UVs + face groups, zero external addons). */
function meshBuilder(name) {
  const pos = [], nor = [], uvs = [], groups = [];
  let gStart = 0;
  const tri = (a, b, c, hint, na, nb, nc, ua = [0, 0], ub = [1, 0], uc = [1, 1]) => {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    if (nx * hint[0] + ny * hint[1] + nz * hint[2] < 0) { [b, c] = [c, b]; [nb, nc] = [nc, nb]; [ub, uc] = [uc, ub]; nx = -nx; ny = -ny; nz = -nz; }
    const l = Math.hypot(nx, ny, nz) || 1, fn = [nx / l, ny / l, nz / l];
    for (const [p, vn, uv] of [[a, na ?? fn, ua], [b, nb ?? fn, ub], [c, nc ?? fn, uc]]) { pos.push(p[0], p[1], p[2]); nor.push(vn[0], vn[1], vn[2]); uvs.push(uv[0], uv[1]); }
  };
  return {
    tri,
    quad(a, b, c, d, hint, na, nb, nc, nd, ua = [0, 0], ub = [1, 0], uc = [1, 1], ud = [0, 1]) { tri(a, b, c, hint, na, nb, nc, ua, ub, uc); tri(a, c, d, hint, na, nc, nd, ua, uc, ud); },
    endGroup(matIdx) { const count = pos.length / 3 - gStart; if (count > 0) groups.push([gStart, count, matIdx]); gStart = pos.length / 3; },
    done() {
      const g = new THREE.BufferGeometry(); g.name = name;
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
      g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nor), 3));
      g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvs), 2));
      for (const [s, c, m] of groups) g.addGroup(s, c, m);
      return g;
    },
  };
}
function makeRBox(r = 0.085) {   // 1-seg chamfered box (108 tris, 6 face groups in BoxGeometry +x -x +y -y +z -z order)
  const B = meshBuilder('rbox'), h = 0.5 - r, S = [-0.5, -h, h, 0.5];
  const pt = (x, y, z) => {
    const cx = Math.max(-h, Math.min(h, x)), cy = Math.max(-h, Math.min(h, y)), cz = Math.max(-h, Math.min(h, z));
    let dx = x - cx, dy = y - cy, dz = z - cz; const l = Math.hypot(dx, dy, dz) || 1; dx /= l; dy /= l; dz /= l;
    return [[cx + dx * r, cy + dy * r, cz + dz * r], [dx, dy, dz]];
  };
  const faces = [
    [[1, 0, 0], (u, v) => [0.5, v, -u]], [[-1, 0, 0], (u, v) => [-0.5, v, u]],
    [[0, 1, 0], (u, v) => [u, 0.5, -v]], [[0, -1, 0], (u, v) => [u, -0.5, v]],
    [[0, 0, 1], (u, v) => [u, v, 0.5]], [[0, 0, -1], (u, v) => [-u, v, -0.5]],
  ];
  faces.forEach(([hint, map], fi) => {
    for (let i = 0; i < S.length - 1; i++) for (let j = 0; j < S.length - 1; j++) {
      const u0 = S[i], u1 = S[i + 1], v0 = S[j], v1 = S[j + 1];
      const [a, na] = pt(...map(u0, v0)), [b, nb] = pt(...map(u1, v0)), [c, nc] = pt(...map(u1, v1)), [d, nd] = pt(...map(u0, v1));
      B.quad(a, b, c, d, hint, na, nb, nc, nd, [u0 + 0.5, v0 + 0.5], [u1 + 0.5, v0 + 0.5], [u1 + 0.5, v1 + 0.5], [u0 + 0.5, v1 + 0.5]);
    }
    B.endGroup(fi);
  });
  return B.done();
}
function makeWedge() {   // sloped ramp from front-bottom (y=-.5, z=-.5) up to rear-top (y=+.5, z=+.5)
  const B = meshBuilder('wedge');
  const FL = [-.5, -.5, -.5], FR = [.5, -.5, -.5], BL = [-.5, -.5, .5], BR = [.5, -.5, .5], TL = [-.5, .5, .5], TR = [.5, .5, .5];
  B.quad(FL, FR, TR, TL, [0, 1, -1]); B.quad(BL, BR, TR, TL, [0, 0, 1]); B.quad(FL, FR, BR, BL, [0, -1, 0]);
  B.tri(FL, BL, TL, [-1, 0, 0], null, null, null, [0, 0], [1, 0], [1, 1]); B.tri(FR, TR, BR, [1, 0, 0], null, null, null, [1, 0], [0, 1], [0, 0]);
  B.endGroup(0); return B.done();
}
function makeGable() {   // symmetric pitched roof, ridge along z at (x=0, y=+.5), eaves at (x=±.5, y=-.5)
  const B = meshBuilder('gable');
  const FL = [-.5, -.5, -.5], FR = [.5, -.5, -.5], FT = [0, .5, -.5], BL = [-.5, -.5, .5], BR = [.5, -.5, .5], BT = [0, .5, .5];
  B.quad(FL, BL, BT, FT, [-1, .5, 0]); B.quad(FR, FT, BT, BR, [1, .5, 0], null, null, null, null, [0, 0], [0, 1], [1, 1], [1, 0]); B.quad(FL, FR, BR, BL, [0, -1, 0]);
  B.tri(FL, FT, FR, [0, 0, -1], null, null, null, [1, 0], [.5, 1], [0, 0]); B.tri(BL, BR, BT, [0, 0, 1], null, null, null, [0, 0], [1, 0], [.5, 1]);
  B.endGroup(0); return B.done();
}
function makeOct() {   // regular octagonal prism aligned to ±x and ±z, exact [-0.5..0.5]^3 bounds
  const B = meshBuilder('oct'), k = 0.5 * Math.tan(Math.PI / 8);
  const ring = [[.5, -k], [.5, k], [k, .5], [-k, .5], [-.5, k], [-.5, -k], [-k, -.5], [k, -.5]];
  for (let i = 0; i < 8; i++) {
    const [x0, z0] = ring[i], [x1, z1] = ring[(i + 1) % 8];
    B.quad([x0, -.5, z0], [x1, -.5, z1], [x1, .5, z1], [x0, .5, z0], [x0 + x1, 0, z0 + z1], null, null, null, null, [i / 8, 0], [(i + 1) / 8, 0], [(i + 1) / 8, 1], [i / 8, 1]);
  }
  for (let i = 1; i < 7; i++) {
    const [x0, z0] = ring[i], [x1, z1] = ring[i + 1];
    B.tri([ring[0][0], .5, ring[0][1]], [x0, .5, z0], [x1, .5, z1], [0, 1, 0], null, null, null, [ring[0][0] + .5, ring[0][1] + .5], [x0 + .5, z0 + .5], [x1 + .5, z1 + .5]);
    B.tri([ring[0][0], -.5, ring[0][1]], [x1, -.5, z1], [x0, -.5, z0], [0, -1, 0], null, null, null, [ring[0][0] + .5, ring[0][1] + .5], [x1 + .5, z1 + .5], [x0 + .5, z0 + .5]);
  }
  B.endGroup(0); return B.done();
}

export const GEO = { cyl: new THREE.CylinderGeometry(1, 1, 1, 7), cyl16: new THREE.CylinderGeometry(1, 1, 1, 16), box: new THREE.BoxGeometry(1, 1, 1),
  rbox: makeRBox(), wedge: makeWedge(), gable: makeGable(), oct: makeOct(),
  rock: new THREE.DodecahedronGeometry(1, 0), cone: new THREE.ConeGeometry(1, 1, 6),
  wheel20: new THREE.CylinderGeometry(1, 1, 1, 20),   // vehicle wheels: round where GEO.cyl is a 7-gon; axis = y, laid on x by rot.z = π/2
  wheel48: new THREE.CylinderGeometry(1, 1, 1, 48),   // a cruiser wheel and a round sign board, round even up close
  pyr: new THREE.ConeGeometry(.7071, 1, 4).rotateY(Math.PI / 4),   // square pyramid, base 1×1, height 1 (hipped roof)
  barrel: new THREE.CylinderGeometry(1, 1, 1, 16, 1, false, Math.PI / 2, Math.PI) };   // the -z half of a cylinder; rot.x = π/2 stands it up as an arch
/* the entity geometries (client/shared/entity/plan.js GEOS) are exactly these keys; all shared, never disposed */
/* boxHalf = half-extent of this geometry in its own space, one value per vertex. The form shade (world/nightlight.js) turns that into a 2 cm edge. Not set on cylinders. */
export function markBox(geo) {
  const p = geo?.attributes?.position;
  if (!p) return geo;
  const n = p.count, a = new Float32Array(n * 3);
  let hx = 0, hy = 0, hz = 0;
  for (let i = 0; i < n; i++) { hx = Math.max(hx, Math.abs(p.getX(i))); hy = Math.max(hy, Math.abs(p.getY(i))); hz = Math.max(hz, Math.abs(p.getZ(i))); }
  for (let i = 0; i < n; i++) { a[i * 3] = hx; a[i * 3 + 1] = hy; a[i * 3 + 2] = hz; }
  geo.setAttribute('boxHalf', new THREE.BufferAttribute(a, 3)); return geo;
}
markBox(GEO.box);
export const MAT = {   // route-independent (included in the mirror-flip list by world/render.js)
  red: new THREE.MeshBasicMaterial({ color: 0xd22a22 }), steel: new THREE.MeshBasicMaterial({ color: 0x8a8f96 }), dust: new THREE.MeshBasicMaterial({ color: 0xcdb48a }),
};
export function mk(geo, mat, sx, sy, sz, x, y, z) { const m = mesh(geo, mat); m.scale.set(sx, sy, sz); m.position.set(x, y, z); return m; }
/* destructible props: hp = "speed² budget" (a hit at v m/s removes v² hp), dmg = hull % lost in a full-speed (28 m/s) hit, slow = fraction of speed lost when it breaks.
   r = collision radius; long thin things (guardrail) set rf (along the road) and rl (across it) instead. The argument is the prop's `size` (cactus/tree height, rock radius…). */
export const KINDS = {
  cactus: () => ({ hp: 60, r: .55, dmg: 5, slow: .06 }),
  bush: z => ({ hp: 20, r: .5 * z, dmg: 2, slow: .03 }),
  rock: z => ({ hp: 100 * z * z, r: 1.2 * z, dmg: 8 * z * z + 6, slow: .15 + .1 * z }),
  post: () => ({ hp: 30, r: .15, dmg: 3, slow: .03 }),
  pole: () => ({ hp: 200, r: .3, dmg: 18, slow: .25 }),
  lamp: () => ({ hp: 200, r: .3, dmg: 18, slow: .25 }),   // street lamp mast (themes/_shared/furniture.js); its light goes out when it breaks
  gantry: () => ({ hp: 500, r: .4, dmg: 35, slow: .4 }),
  tree: z => ({ hp: 80 + 25 * z, r: .3 + .03 * z, dmg: 8 + 1.5 * z, slow: .12 }),
  termite: z => ({ hp: 120, r: .25 * z + .4, dmg: 8 + 2 * z, slow: .1 }),
  drift: z => ({ hp: 10, r: .6 * z, dmg: 1, slow: .02 }),
  guard: () => ({ hp: 160, r: .3, rf: 2.1, rl: .3, dmg: 9, slow: .12 }),
  sign: () => ({ hp: 40, r: .25, dmg: 3, slow: .03 }),   // road-hole warning sign post
  building: () => ({ hp: 3000, r: 3, dmg: 40, slow: .5 }),   // roadside landmark; footprint (rf/rl) comes from the implementation – any contact is fatal (sim/damage.js collide)
};
export const destroyed = new Set();   // ids of smashed props, so a rebuilt chunk doesn't resurrect them
