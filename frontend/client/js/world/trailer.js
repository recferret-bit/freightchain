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
  g.fillStyle = 'rgba(255,255,255,.14)'; g.fillRect(0, 0, w, 10);   // roof rail highlight
  for (let x = 32; x < w; x += 48) {
    g.fillStyle = 'rgba(0,0,0,.075)'; g.fillRect(x, 8, 3, h * .72);
    g.fillStyle = 'rgba(255,255,255,.09)'; g.fillRect(x + 3, 8, 2, h * .72);
  }
  g.fillStyle = stripe; g.fillRect(0, h * .73, w, h * .10); g.fillStyle = accent; g.fillRect(0, h * .84, w, h * .045);
  // DOT red/white alternating conspicuity tape along bottom rub-rail
  g.fillStyle = '#26282c'; g.fillRect(0, h * .91, w, h * .09);
  for (let x = 8; x < w - 8; x += 48) {
    g.fillStyle = '#d22a22'; g.fillRect(x, h * .925, 24, h * .045);
    g.fillStyle = '#f2f2ea'; g.fillRect(x + 24, h * .925, 18, h * .045);
  }
  g.textAlign = 'center'; g.font = `bold ${text.length > 16 ? 70 : 94}px sans-serif`;
  g.fillStyle = 'rgba(0,0,0,.16)'; g.fillText(text, w / 2 + 3, h * .49 + 3);
  g.fillStyle = stripe; g.fillText(text, w / 2, h * .49);
  g.fillStyle = '#5c5c56'; g.font = 'bold 31px monospace'; g.fillText(sub, w / 2, h * .65);
  sideTex.needsUpdate = true;
}
{
  const revM = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), sideM = new THREE.MeshBasicMaterial({ map: sideTex }), plain = new THREE.MeshBasicMaterial({ color: 0xe3e1d9 }), rear = new THREE.MeshBasicMaterial({ color: 0xcfcdc4 }),
    dark = new THREE.MeshBasicMaterial({ color: 0x1a1a1a }), rimM = new THREE.MeshBasicMaterial({ color: 0xc4c8ce }), tail = new THREE.MeshBasicMaterial({ color: 0xd22a22, toneMapped: false }), amb = new THREE.MeshBasicMaterial({ color: 0xff9a10, toneMapped: false });
  trailerMats.push(sideM, plain, rear, dark, rimM, tail, revM, amb);
  // local frame: origin at the kingpin, -z = towards the cab, +z = towards the rear
  { const body = new THREE.Mesh(markBox(new THREE.BoxGeometry(2.4, 3.5, 13)), [sideM, sideM, plain, dark, rear, rear]); body.position.set(0, 2.65, 7); trailer.add(body); }
  trailer.add(mk(GEO.rbox, plain, 1.9, 1.85, .48, 0, 2.85, .32));   // nose refrigeration / aero pod
  trailer.add(mk(GEO.rbox, dark, 1.5, .42, .12, 0, 2.85, .07));      // reefer intake grille
  trailer.add(mk(GEO.box, dark, 2.15, .46, 10.4, 0, .76, 8.0));      // chassis sub-frame
  for (const x of [-.9, .9]) { trailer.add(mk(GEO.box, dark, .14, .82, .14, x, .68, 3.1)); trailer.add(mk(GEO.box, dark, .32, .06, .32, x, .28, 3.1)); }   // landing gear retracted shoes
  for (const z of [9.6, 10.9]) {
    const ax = mk(GEO.cyl16, dark, .09, 2.1, .09, 0, .5, z); ax.rotation.z = Math.PI / 2; trailer.add(ax);
    for (const x of [-1.06, 1.06]) {
      const s = Math.sign(x);
      const w = mk(GEO.wheel20, dark, .5, .36, .5, x, .5, z); w.rotation.z = Math.PI / 2; trailer.add(w);
      const rm = mk(GEO.wheel20, rimM, .31, .38, .31, x + s * .01, .5, z); rm.rotation.z = Math.PI / 2; trailer.add(rm);
      const hb = mk(GEO.wheel20, dark, .13, .40, .13, x + s * .02, .5, z); hb.rotation.z = Math.PI / 2; trailer.add(hb);
    }
  }
  for (const x of [-1.04, 1.04]) trailer.add(mk(GEO.box, dark, .42, .56, .04, x, .46, 11.68));   // rear mudflaps
  trailer.add(mk(GEO.rbox, dark, 2.26, .16, .14, 0, .58, 13.48));   // Mansfield rear underride bar
  for (const x of [-.75, .75]) trailer.add(mk(GEO.box, dark, .12, .42, .12, x, .78, 13.44));
  for (const x of [-.38, .38, -.92, .92]) trailer.add(mk(GEO.box, rimM, .05, 3.25, .06, x, 2.65, 13.51));   // rear barn-door lock rods
  trailer.add(mk(GEO.box, dark, .03, 3.44, .03, 0, 2.65, 13.505));   // centre door seal
  for (const x of [-1.08, 0, 1.08]) trailer.add(mk(GEO.box, tail, .16, .08, .06, x, 4.3, 13.52));   // upper DOT clearance lamps
  for (const x of [-1.21, 1.21]) trailer.add(mk(GEO.box, amb, .04, .1, .22, x, 1.02, 1.1));   // front corner amber markers
  for (const x of [-1, 1]) { trailer.add(mk(GEO.box, tail, .32, .2, .1, x, 1.05, 13.52)); trailer.add(glow(0xff2010, 1.4, .9, x, 1.05, 13.65)); }
  const rev = new THREE.Group(); rev.visible = false; trailer.userData.rev = rev;   // reverse lights (white), shown while gear R is selected (render.js)
  for (const x of [-.6, .6]) { rev.add(mk(GEO.box, revM, .25, .18, .08, x, 1.05, 13.52), glow(0xffffff, 1.6, .9, x, 1.05, 13.65)); }
  rev.add(beam(0xffffff, .55, 7, 16, 13.8, true)); trailer.add(rev);
}
scene.add(trailer);
