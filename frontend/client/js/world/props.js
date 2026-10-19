import * as THREE from 'three';
import { mesh } from './pool.js';

/* Shared prop geometry, the few route-independent materials, and the destructible-prop table (KINDS).
   The prop SHAPES are entities (client/shared/entity/seed/prop/, built by world/entity-build.js); each route picks them and supplies the materials in themes/<route>/props.js. */

export const GEO = { cyl: new THREE.CylinderGeometry(1, 1, 1, 7), box: new THREE.BoxGeometry(1, 1, 1), rock: new THREE.DodecahedronGeometry(1, 0), cone: new THREE.ConeGeometry(1, 1, 6),
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
