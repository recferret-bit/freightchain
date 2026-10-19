import * as THREE from 'three';

/* Every material a theme creates goes through here, so that (a) the mirror pass can flip face-culling on them
   (world/render.js reads `mats`) and (b) they are disposed when another route is selected.
   Create materials INSIDE the theme's create*() functions – never at module level – or they are lost on the next theme switch. */
export const mats = [];
export const trackMat = m => (mats.push(m), m);
export const basic = (color, opts = {}) => trackMat(new THREE.MeshBasicMaterial({ color, ...opts }));
/* a fixed colour an entity names ({ color: 0x… }) – one tracked material per colour (lamp = self-lit) until the route changes */
const byColor = new Map();
export const colorMat = (color, lamp = false) => { const k = color + (lamp ? 'L' : ''); let m = byColor.get(k); if (!m) byColor.set(k, m = basic(color, lamp ? { toneMapped: false } : {})); return m; };
export function disposeMats() { for (const m of mats) { m.map?.dispose?.(); m.dispose?.(); } mats.length = 0; byColor.clear(); }
