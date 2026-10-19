import * as THREE from 'three';
import { scene } from './scene.js';
import { releaseTree } from './pool.js';
import { buildInto } from './entity-build.js';

/* Traffic vehicles: the data table (size, mass, speed range, AI presets) is VEHICLES in client/shared/traffic.js; each type's mesh is an
   entity of the same id. Model frame: origin = centre of the footprint on the ground, forward = -z. Every material is a MeshBasicMaterial
   from the caches below, exported in `vehicleMats` (render.js flips them for the mirror pass). */

export const vehicleMats = [], matCache = new Map();
const mat = hex => { let m = matCache.get(hex); if (!m) { m = new THREE.MeshBasicMaterial({ color: hex }); matCache.set(hex, m); vehicleMats.push(m); } return m; };
/* lamps are self-lit: toneMapped:false keeps them bright at night (separate from the body-colour cache, e.g. RED is also the fire truck's paint) */
const lampCache = new Map();
const lampMat = hex => { let m = lampCache.get(hex); if (!m) { m = new THREE.MeshBasicMaterial({ color: hex, toneMapped: false }); lampCache.set(hex, m); vehicleMats.push(m); } return m; };
const AMBER = 0xff9a10;
const GLASS = 0x1d2a36, TYRE = 0x151515, RIM = 0xc4c8ce, TAIL = 0x8a1410, BRAKE = 0xff3020, HEAD = 0xfff2c0, RED = 0xe02020, BLUE = 0x2a5cff, WHITE = 0xf0f0ea;
import { CAR_COLORS, VEHICLES } from '../../shared/traffic.js';
export { VEHICLES };

/* the meshes are entities (client/shared/entity/seed/vehicle/<type>.js + the veh-* parts): every colour they name comes from these caches */
const ctx = { slot: () => null, color: (hex, lamp) => (lamp ? lampMat(hex) : mat(hex)) };
// create every material up front so FLIP_MATS (snapshotted by render.js at load) is complete
for (const c of [HEAD, TAIL, BRAKE, RED, BLUE, AMBER]) lampMat(c);
for (const c of [GLASS, TYRE, RIM, 0x6a7078, 0x8a5a14, RED, WHITE, 0x15191f, 0x4a5a6a, 0xd8d4c8, 0xc8c8c0, 0xe8c020, 0xd89a20, 0x20406a, 0xe3e1d9, 0x1d3a5c, ...CAR_COLORS]) mat(c);

export const activeVehicles = new Set();
/* builds a vehicle group in the scene; `pick` selects the sedan colour */
export function buildVehicle(def, pick = 0) {
  const g = new THREE.Group(); g.userData.pick = pick; g.userData.hi = pick % 3 === 0;
  buildInto(g, def.type, { len: def.len, w: def.w, h: def.h, pick, hi: g.userData.hi }, ctx); scene.add(g); activeVehicles.add(g); return g;
}
export function removeVehicle(g) { activeVehicles.delete(g); scene.remove(g); releaseTree(g); }   // its mk() parts go back to the pool (world/pool.js)
export function setBehindVehiclesVisible(visible, px, pz, th, psi = 0) {
  if (visible) { for (const g of activeVehicles) g.visible = true; return; }
  if (Math.abs(psi) >= 0.8) return;
  const fx = Math.sin(th), fz = -Math.cos(th);
  for (const g of activeVehicles) if ((g.position.x - px) * fx + (g.position.z - pz) * fz < -25) g.visible = false;
}
