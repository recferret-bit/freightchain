import * as THREE from 'three';
import { GEO, mk } from '../../../world/props.js';

/* Small building blocks shared by the landmark implementations. Local frame of every landmark: origin = footprint centre on the ground, y up,
   the FRONT (door / forecourt side) faces -x, the road's length runs along z. (The factory mirrors the whole model for left-hand sites.) */
const PYR = new THREE.ConeGeometry(.7071, 1, 4).rotateY(Math.PI / 4);   // square pyramid, base 1×1, height 1 (shared like GEO – never disposed)
export const box = (m, w, h, d, x, y, z) => mk(GEO.box, m, w, h, d, x, y + h / 2, z);   // base sits ON y (mk() centres on y)
export const hip = (m, w, h, d, x, y, z) => mk(PYR, m, w, h, d, x, y + h / 2, z);       // pyramid / hipped roof
export const cyl = (m, r, h, x, y, z) => mk(GEO.cyl, m, r, h, r, x, y + h / 2, z);
export const cone = (m, r, h, x, y, z) => mk(GEO.cone, m, r, h, r, x, y + h / 2, z);
export const pole = (m, h, x, z, t = .15) => box(m, t, h, t, x, 0, z);
export function palm(g, m, x, z, h = 5) {   // resort palm: slanted trunk + fan of leaf cones
  const t = box(m.trunk, .3, h, .3, x, 0, z); t.rotation.z = .12; g.add(t);
  for (let i = 0; i < 5; i++) { const a = i * 1.257, l = cone(m.leaf, .45, 2.2, x + Math.cos(a) * .9, h - .3, z + Math.sin(a) * .9); l.rotation.z = Math.cos(a) * 1.2; l.rotation.x = -Math.sin(a) * 1.2; g.add(l); }
}
export function car(g, m, x, z, yaw, lights = true) {   // police-style cruiser (white body, blue flank, light bar)
  const c = new THREE.Group();
  c.add(box(m.white, 1.9, .8, 4.4, 0, .35, 0)); c.add(box(m.glass, 1.6, .6, 2.2, 0, 1.15, -.1)); c.add(box(m.blue, 1.95, .3, 3.2, 0, .55, 0));
  if (lights) { c.add(box(m.red, .35, .18, .5, -.45, 1.75, -.1)); c.add(box(m.blue, .35, .18, .5, .45, 1.75, -.1)); }
  for (const sx of [-.95, .95]) for (const sz of [-1.4, 1.4]) { const w = mk(GEO.cyl, m.dark, .38, .25, .38, sx, .38, sz); w.rotation.z = Math.PI / 2; c.add(w); }
  c.position.set(x, 0, z); c.rotation.y = yaw; g.add(c);
}
