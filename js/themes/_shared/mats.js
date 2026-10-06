import * as THREE from 'three';

/* Every material a theme creates goes through here, so that (a) the mirror pass can flip face-culling on them
   (world/render.js reads `mats`) and (b) they are disposed when another route is selected.
   Create materials INSIDE the theme's create*() functions – never at module level – or they are lost on the next theme switch. */
export const mats = [];
export const trackMat = m => (mats.push(m), m);
export const basic = (color, opts = {}) => trackMat(new THREE.MeshBasicMaterial({ color, ...opts }));
export function disposeMats() { for (const m of mats) m.dispose?.(); mats.length = 0; }
