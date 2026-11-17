import * as THREE from 'three';
import { edgeOf } from '../../shared/road.js';
import { tollsBetween } from '../../shared/toll.js';
import { net } from '../net/network.js';
import { pike } from '../phone/pike-state.js';
import { GEO } from './props.js';
import { canvasTex } from './scene.js';

/* A PIKE booth beside the driver's lanes, and one arm across them. The arm is visual.
   The truck is held in physics; AI cars stop in the traffic sim. Neither uses a building collider. */

const ORANGE = 0xff5a1f;
const mat = {
  curb: new THREE.MeshBasicMaterial({ color: 0x6e6a62 }),
  booth: new THREE.MeshBasicMaterial({ color: 0x2f2922 }),
  trim: new THREE.MeshBasicMaterial({ color: 0xd8d2c6 }),
  glass: new THREE.MeshBasicMaterial({ color: 0x35536b }),
  roof: new THREE.MeshBasicMaterial({ color: 0x6b3a28 }),
  arm: new THREE.MeshBasicMaterial({ color: ORANGE, toneMapped: false }),
  stripe: new THREE.MeshBasicMaterial({ color: 0xf4f2ea, toneMapped: false }),
  post: new THREE.MeshBasicMaterial({ color: 0x1a1814 }),
};
export const tollMats = Object.values(mat);
let signMat;
const sign = () => signMat ??= new THREE.MeshBasicMaterial({
  map: canvasTex(256, 96, (g, w, h) => {
    g.fillStyle = '#ff5a1f'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#1a120c'; g.lineWidth = 6; g.strokeRect(6, 6, w - 12, h - 12);
    g.fillStyle = '#1a120c'; g.font = '700 60px ui-monospace, monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('PIKE', w / 2, h / 2 + 2);
  }, false),
  toneMapped: false,
});

const arms = [];

function part(parent, geo, material, sx, sy, sz, x, y, z) {
  const m = new THREE.Mesh(geo, material);
  m.scale.set(sx, sy, sz); m.position.set(x, y, z); parent.add(m); return m;
}

export function buildToll(grp, s0, at) {
  for (const gate of tollsBetween(s0, s0 + 32)) {
    const lat = edgeOf(net.lanes(gate, 1)) + 2.2;
    const root = new THREE.Group();
    part(root, GEO.rbox, mat.curb, 2.8, 0.22, 4.4, 0, 0.11, 0);          // raised concrete safety island
    part(root, GEO.cyl16, mat.arm, 0.14, 0.9, 0.14, -1.05, 0.55, 1.85);  // approach bollard (+z = approaching driver)
    part(root, GEO.rbox, mat.booth, 2.1, 2.9, 2.4, 0.18, 1.56, -0.2);    // chamfered operator booth
    part(root, GEO.box, mat.trim, 2.14, 0.18, 2.44, 0.18, 0.85, -0.2);   // waist trim band
    part(root, GEO.box, mat.trim, 2.15, 0.1, 2.45, 0.18, 1.3, -0.2);     // window sill ledge
    part(root, GEO.box, mat.glass, 2.16, 1.05, 1.72, 0.18, 1.86, -0.2);  // side booth windows
    part(root, GEO.box, mat.glass, 1.52, 1.05, 2.46, 0.18, 1.86, -0.2);  // front (+z) & rear (-z) booth windows
    part(root, GEO.rbox, mat.roof, 3.0, 0.28, 3.4, 0.05, 3.12, 0);       // overhanging canopy roof
    part(root, GEO.box, mat.arm, 3.04, 0.08, 3.44, 0.05, 3.28, 0);       // illuminated orange roof fascia
    part(root, GEO.rbox, mat.post, 0.44, 0.95, 0.48, -0.95, 0.68, 1.15); // gate drive housing pedestal (approach side)
    part(root, GEO.rbox, mat.post, 1.45, 0.18, 1.05, -0.1, 3.28, 0);     // rooftop sign mounting plinth
    const sm = sign();
    if (!tollMats.includes(sm)) tollMats.push(sm);
    part(root, GEO.rbox, [sm, sm, mat.post, mat.post, sm, sm], 1.95, 0.74, 1.45, -0.1, 3.69, 0); // 4-sided illuminated PIKE sign
    const pivot = new THREE.Group(); pivot.position.set(-0.95, 1.05, 1.15); root.add(pivot);
    const len = lat - 0.35;
    const arm = part(pivot, GEO.rbox, mat.arm, len, 0.15, 0.12, -len / 2, 0, 0);
    part(pivot, GEO.rbox, mat.post, 0.45, 0.24, 0.22, 0.22, 0, 0);       // counterweight block
    for (let x = 0.8; x < len - 0.4; x += 1.2) part(pivot, GEO.box, mat.stripe, 0.5, 0.16, 0.13, -x, 0, 0);
    arm.userData.gate = gate; arm.userData.lift = 0; arms.push(arm);
    const p = at(gate);
    root.position.set(p.x + Math.cos(p.t) * lat, 0, p.z + Math.sin(p.t) * lat);
    root.rotation.y = -p.t;
    grp.add(root);
  }
}

export function tollOpen(gate, cars) {
  if (pike.paid === gate && pike.phase === 'open') return true;
  for (const a of cars) if (a.road?.main && a.dir > 0 && a.tollAt === gate && a.s > gate - 6 && a.s < gate + 16) return true;
  return false;
}

export function updateTolls(dt, cars) {
  const k = 1 - Math.exp(-3 * dt);
  for (let i = arms.length - 1; i >= 0; i--) {
    const arm = arms[i];
    if (!arm.parent?.parent?.parent?.parent) { arms.splice(i, 1); continue; }
    const aim = tollOpen(arm.userData.gate, cars) ? 1 : 0;
    arm.userData.lift += (aim - arm.userData.lift) * k;
    arm.parent.rotation.z = -1.2 * arm.userData.lift;
  }
}
