import * as THREE from 'three';
import { GEO, mk } from '../../../world/props.js';

/* Small building blocks shared by the landmark implementations. Local frame of every landmark: origin = footprint centre on the ground, y up,
   the FRONT (door / forecourt side) faces -x, the road's length runs along z. (The factory mirrors the whole model for left-hand sites.) */
const PYR = new THREE.ConeGeometry(.7071, 1, 4).rotateY(Math.PI / 4);   // square pyramid, base 1×1, height 1 (shared like GEO – never disposed)
const WHEEL = new THREE.CylinderGeometry(1, 1, 1, 48);   // GEO.cyl is a 7-gon; a cruiser wheel is round even up close. Shared, never disposed.
export const box = (m, w, h, d, x, y, z) => mk(GEO.box, m, w, h, d, x, y + h / 2, z);   // base sits ON y (mk() centres on y)
export const hip = (m, w, h, d, x, y, z) => mk(PYR, m, w, h, d, x, y + h / 2, z);       // pyramid / hipped roof
export const cyl = (m, r, h, x, y, z) => mk(GEO.cyl, m, r, h, r, x, y + h / 2, z);
export const pole = (m, h, x, z, t = .15) => box(m, t, h, t, x, 0, z);
export function car(g, m, x, z, yaw, lights = true) {   // police-style cruiser (white body, blue flank, light bar)
  const c = new THREE.Group();
  c.add(box(m.white, 1.9, .8, 4.4, 0, .35, 0)); c.add(box(m.glass, 1.6, .6, 2.2, 0, 1.15, -.1)); c.add(box(m.blue, 1.95, .3, 3.2, 0, .55, 0));
  if (lights) { c.add(box(m.red, .35, .18, .5, -.45, 1.75, -.1)); c.add(box(m.blue, .35, .18, .5, .45, 1.75, -.1)); }
  for (const sx of [-.95, .95]) for (const sz of [-1.4, 1.4]) cruiserWheel(c, m, sx, sz);
  c.position.set(x, 0, z); c.rotation.y = yaw; g.add(c);
}
/* Tyre plus a rim disk and a hub. rotation.z = π/2 lays the cylinder on the axle (local +y → car −x),
   so the outer cap of the +x wheel is the −y end and the disk is shifted outward by sign(sx). */
function cruiserWheel(c, m, sx, sz) {
  const r = .38, tw = .24, side = Math.sign(sx);
  const part = (mat, rad, th, proud) => { const a = mk(WHEEL, mat, rad, th, rad, sx + side * proud, r, sz); a.rotation.z = Math.PI / 2; c.add(a); };
  part(m.dark, r, tw, 0);
  part(m.metal, r * .64, .06, tw / 2 + .01);   // 2 cm into the sidewall; a shared face flickers
  part(m.white, r * .26, .04, tw / 2 + .05);
}
