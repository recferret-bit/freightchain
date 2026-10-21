import * as THREE from 'three';
import { edgeOf } from '../../shared/road.js';
import { tollsBetween } from '../../shared/toll.js';
import { net } from '../net/network.js';
import { pike } from '../phone/pike-state.js';
import { canvasTex } from './scene.js';

/* A PIKE booth beside the driver's lanes, and one arm across them. The arm is visual.
   The truck is held in physics; AI cars stop in the traffic sim. Neither uses a building collider. */

const ORANGE = 0xff5a1f;
const mat = {
  booth: new THREE.MeshBasicMaterial({ color: 0x2a241c }),
  roof: new THREE.MeshBasicMaterial({ color: 0x6b3a28 }),
  arm: new THREE.MeshBasicMaterial({ color: ORANGE, toneMapped: false }),
  post: new THREE.MeshBasicMaterial({ color: 0x1a1814 }),
};
let signMat;
const sign = () => signMat ??= new THREE.MeshBasicMaterial({
  map: canvasTex(256, 96, (g, w, h) => {
    g.fillStyle = '#ff5a1f'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#1a120c'; g.font = '700 64px ui-monospace, monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('PIKE', w / 2, h / 2 + 2);
  }, false),
  toneMapped: false,
});

const arms = [];

function box(parent, material, sx, sy, sz, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
  m.scale.set(sx, sy, sz); m.position.set(x, y, z); parent.add(m); return m;
}

export function buildToll(grp, s0, at) {
  for (const gate of tollsBetween(s0, s0 + 32)) {
    const lat = edgeOf(net.lanes(gate, 1)) + 2.2;
    const root = new THREE.Group();
    box(root, mat.booth, 2.2, 3.1, 2.4, 0, 1.55, 0);
    box(root, mat.roof, 2.8, 0.22, 3, 0, 3.2, 0);
    box(root, sign(), 0.12, 0.7, 1.8, -1.2, 3.7, 0);
    const pivot = new THREE.Group(); pivot.position.set(-1.1, 1.15, 0); root.add(pivot);
    const len = lat - 0.35;
    const arm = box(pivot, mat.arm, len, 0.18, 0.28, -len / 2, 0, 0);
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
