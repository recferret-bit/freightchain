import * as THREE from 'three';
import { canvasTex } from './scene.js';

/* Additive glow sprites for lamps (traffic head/tail/brake/siren lights, trailer tail lights). Opacity follows the night fade (world/daynight.js sets it),
   so by day they are invisible. DoubleSide: sprites must not be culled by the mirror pass's flipped projection. */
export const glowMats = [], cache = new Map();
let tex;
const glowTex = () => tex ??= canvasTex(64, 64, (g, w, h) => { const r = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2); r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(.25, 'rgba(255,255,255,.45)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, w, h); }, false);
export function glow(color, size, gain, x, y, z) {
  const key = color + ':' + gain; let m = cache.get(key);
  if (!m) { m = new THREE.SpriteMaterial({ map: glowTex(), color, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false, toneMapped: false, side: THREE.DoubleSide, opacity: 0 }); m.userData.gain = gain; cache.set(key, m); glowMats.push(m); }
  const s = new THREE.Sprite(m); s.scale.set(size, size, 1); s.position.set(x, y, z); return s;
}

/* headlight pool texture: row j is distance (top = far); the beam widens and fades with distance. Shared by the truck's pool (daynight.js) and every vehicle's own pools. */
export const beamTex = canvasTex(64, 256, (g, w, h) => {
  for (let j = 0; j < h; j++) {
    const t = 1 - j / (h - 1), near = Math.min(1, t / .1), a = Math.pow(1 - t, 1.5) * near * .6, sig = .07 + .2 * t;
    const gr = g.createLinearGradient(0, 0, w, 0);
    for (let i = 0; i <= 16; i++) { const x = i / 16; gr.addColorStop(x, `rgba(255,236,176,${(a * Math.exp(-.5 * ((x - .5) / sig) ** 2)).toFixed(3)})`); }
    g.fillStyle = gr; g.fillRect(0, j, w, 1);
  }
}, false);
const plane = new THREE.PlaneGeometry(1, 1), beamMats = new Map();
/* a flat additive light pool on the ground in a vehicle's local frame (forward = -z): `back` = behind the vehicle (tail wash), w × l metres, starting `z0` from the origin */
export function beam(color, gain, w, l, z0, back = false) {
  const key = color + ':' + gain; let m = beamMats.get(key);
  if (!m) { m = new THREE.MeshBasicMaterial({ map: beamTex, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false, side: THREE.DoubleSide, opacity: 0 }); m.userData.gain = gain; beamMats.set(key, m); glowMats.push(m); }
  const o = new THREE.Mesh(plane, m); o.rotation.order = 'YXZ'; o.rotation.x = -Math.PI / 2; o.rotation.y = back ? Math.PI : 0; o.scale.set(w, l, 1);
  o.position.set(0, .08, back ? z0 + l / 2 : -z0 - l / 2); o.renderOrder = 2; o.frustumCulled = false; return o;
}
