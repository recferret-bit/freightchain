import * as THREE from 'three';
import { scene } from './scene.js';
import { GEO, markBox, mk } from './props.js';
import { glow, beam } from './glow.js';

/* The trailer behind the cab – only visible in the mirrors. */

export const trailer = new THREE.Group();
export const trailerMats = [];
const sideCanvas = document.createElement('canvas'); sideCanvas.width = 1024; sideCanvas.height = 256;
const sideTex = new THREE.CanvasTexture(sideCanvas); sideTex.colorSpace = THREE.SRGBColorSpace; sideTex.anisotropy = 8;
/* paints the trailer's side panel in a route's livery: { body, stripe, accent, text, sub } */
export function setLivery({ body, stripe, accent, text, sub }) {
  const g = sideCanvas.getContext('2d'), w = 1024, h = 256;
  g.fillStyle = body; g.fillRect(0, 0, w, h);
  for (let x = 40; x < w; x += 64) { g.fillStyle = 'rgba(0,0,0,.07)'; g.fillRect(x, 0, 3, h * .7); }
  g.fillStyle = stripe; g.fillRect(0, h * .74, w, h * .1); g.fillStyle = accent; g.fillRect(0, h * .85, w, h * .04);
  g.fillStyle = stripe; g.font = `bold ${text.length > 16 ? 70 : 96}px sans-serif`; g.textAlign = 'center'; g.fillText(text, w / 2, h * .5);
  g.fillStyle = '#6b6b66'; g.font = 'bold 32px monospace'; g.fillText(sub, w / 2, h * .66);
  sideTex.needsUpdate = true;
}
{
  const revM = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), sideM = new THREE.MeshBasicMaterial({ map: sideTex }), plain = new THREE.MeshBasicMaterial({ color: 0xe3e1d9 }), rear = new THREE.MeshBasicMaterial({ color: 0xcfcdc4 }),
    dark = new THREE.MeshBasicMaterial({ color: 0x1a1a1a }), tail = new THREE.MeshBasicMaterial({ color: 0xd22a22, toneMapped: false });
  trailerMats.push(sideM, plain, rear, dark, tail, revM);
  // local frame: origin at the kingpin, -z = towards the cab, +z = towards the rear
  { const body = new THREE.Mesh(markBox(new THREE.BoxGeometry(2.4, 3.5, 13)), [sideM, sideM, plain, dark, rear, rear]); body.position.set(0, 2.65, 7); trailer.add(body); }
  trailer.add(mk(GEO.box, dark, 2.2, .5, 10, 0, .75, 8.2));
  for (const z of [9.6, 10.9]) for (const x of [-1.05, 1.05]) { const w = mk(GEO.cyl, dark, .5, .3, .5, x, .5, z); w.rotation.z = Math.PI / 2; trailer.add(w); }
  for (const x of [-1, 1]) { trailer.add(mk(GEO.box, tail, .3, .2, .1, x, 1.2, 13.52)); trailer.add(glow(0xff2010, 1.4, .9, x, 1.2, 13.65)); }
  const rev = new THREE.Group(); rev.visible = false; trailer.userData.rev = rev;   // reverse lights (white), shown while gear R is selected (render.js)
  for (const x of [-.6, .6]) { rev.add(mk(GEO.box, revM, .25, .18, .08, x, 1.2, 13.52), glow(0xffffff, 1.6, .9, x, 1.2, 13.65)); }
  rev.add(beam(0xffffff, .55, 7, 16, 13.8, true)); trailer.add(rev);
}
scene.add(trailer);
