import * as THREE from 'three';
import { basic } from './mats.js';

/* A ring of distant peaks around the camera (the group is moved with the camera so it never gets closer).
   peak(i, count) → { r (base radius), h (height), dist (ring radius), color, segs?, top? (0..1 → flat-topped mesa), cap? (snow colour), capFrac? (cap size 0..1), jitter? } */
export function createRing({ count, peak }) {
  const group = new THREE.Group(), cache = new Map();
  const mat = c => { let m = cache.get(c); if (!m) { m = basic(c); cache.set(c, m); } return m; };
  for (let i = 0; i < count; i++) {
    const p = peak(i, count), a = (i / count) * Math.PI * 2 + (p.jitter ?? Math.sin(i * 7.3) * 0.1), segs = p.segs ?? 5;
    const geo = p.top ? new THREE.CylinderGeometry(p.r * p.top, p.r, p.h, segs) : new THREE.ConeGeometry(p.r, p.h, segs);
    const m = new THREE.Mesh(geo, mat(p.color)); m.position.set(Math.sin(a) * p.dist, p.h / 2 - 2, -Math.cos(a) * p.dist); m.rotation.y = i; group.add(m);
    if (p.cap) {   // snow cap: a slightly fatter cone sharing the apex (avoids z-fighting with the base cone)
      const c = p.capFrac ?? .35, cm = new THREE.Mesh(new THREE.ConeGeometry(p.r * c * 1.05, p.h * c * 1.03, segs), mat(p.cap));
      cm.position.set(m.position.x, p.h - p.h * c / 2 - 1.2, m.position.z); cm.rotation.y = i; group.add(cm);
    }
  }
  return group;
}
/* several rings (far → near is up to the theme) in one group */
export function createRings(rings) { const g = new THREE.Group(); for (const r of rings) g.add(createRing(r)); return g; }
