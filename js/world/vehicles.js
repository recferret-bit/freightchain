import * as THREE from 'three';
import { scene } from './scene.js';
import { GEO, mk } from './props.js';
import { glow, beam } from './glow.js';
import { releaseTree } from './pool.js';

/* Traffic vehicle types: data table (size, mass, speed range, allowed AI presets) + one mesh builder per body style.
   Model frame: origin = centre of the footprint on the ground, forward = -z. Everything is a MeshBasicMaterial, so every
   material is created at load and exported in `vehicleMats` (render.js puts them in FLIP_MATS for the mirror pass). */

export const vehicleMats = [], matCache = new Map();
const mat = hex => { let m = matCache.get(hex); if (!m) { m = new THREE.MeshBasicMaterial({ color: hex }); matCache.set(hex, m); vehicleMats.push(m); } return m; };
/* lamps are self-lit: toneMapped:false keeps them bright at night (separate from the body-colour cache, e.g. RED is also the fire engine's paint) */
const lampCache = new Map();
const lampMat = hex => { let m = lampCache.get(hex); if (!m) { m = new THREE.MeshBasicMaterial({ color: hex, toneMapped: false }); lampCache.set(hex, m); vehicleMats.push(m); } return m; };
const AMBER = 0xff9a10;
const GLASS = 0x1d2a36, TYRE = 0x151515, TAIL = 0x8a1410, BRAKE = 0xff3020, HEAD = 0xfff2c0, RED = 0xe02020, BLUE = 0x2a5cff, WHITE = 0xf0f0ea;
const CAR_COLORS = [0xb8bcc2, 0x2f4a7a, 0x9a2b2b, 0xe0d8c0, 0x3d5a3a, 0x1e1e22, 0xc9a227];

/* body styles: each adds its meshes to g and may register `flash` (siren) meshes, returning nothing */
function wheels(g, w, zs, r = .4) { for (const z of zs) for (const x of [-1, 1]) { const m = mk(GEO.cyl, mat(TYRE), r * 2, .3, r * 2, x * (w / 2 - .1), r, z); m.rotation.z = Math.PI / 2; g.add(m); } }
function lights(g, w, len, y, brakeY = y) {   // head lights (front, -z) and tail lights; brake lights are a separate group toggled by the AI
  for (const x of [-1, 1]) {
    g.add(mk(GEO.box, lampMat(HEAD), .3, .18, .08, x * (w / 2 - .3), y, -len / 2 - .02)); g.add(mk(GEO.box, lampMat(TAIL), .3, .18, .08, x * (w / 2 - .3), y, len / 2 + .02));
    g.add(glow(HEAD, 2.6, 1, x * (w / 2 - .3), y, -len / 2 - .1)); g.add(glow(BRAKE, 1.1, .7, x * (w / 2 - .3), y, len / 2 + .1));   // night glow
  }
  g.add(beam(HEAD, g.userData.hi ? .75 : .5, g.userData.hi ? 12 : 8, g.userData.hi ? 50 : 28, len / 2 + 1), beam(BRAKE, .3, 5, 7, len / 2 + .8, true));   // light pools on the road: head beams, dim red tail wash
  const ind = { l: new THREE.Group(), r: new THREE.Group() };   // amber turn indicators (model frame: right = +x), blinked by traffic.js on lane changes
  for (const [k, sx] of [['l', -1], ['r', 1]]) for (const z of [-len / 2 - .03, len / 2 + .03]) { ind[k].add(mk(GEO.box, lampMat(AMBER), .22, .14, .08, sx * (w / 2 - .12), y + .02, z)); ind[k].add(glow(AMBER, 1.3, 1, sx * (w / 2 - .12), y + .02, z + Math.sign(z) * .1)); }
  ind.l.visible = ind.r.visible = false; g.add(ind.l, ind.r); g.userData.ind = ind;
  const b = new THREE.Group(); b.add(beam(BRAKE, .55, 7, 12, len / 2 + .8, true)); for (const x of [-1, 1]) { b.add(mk(GEO.box, lampMat(BRAKE), .36, .22, .1, x * (w / 2 - .3), brakeY, len / 2 + .04)); b.add(glow(BRAKE, 2.2, 1, x * (w / 2 - .3), brakeY, len / 2 + .15)); } b.visible = false; g.add(b); g.userData.brake = b;
}
function siren(g, w, y, z) {   // light bar: red left, blue right, flashing alternately
  const a = new THREE.Group(), b = new THREE.Group();
  a.add(mk(GEO.box, lampMat(RED), w * .35, .16, .3, -w * .2, y, z), glow(RED, 3.2, 1, -w * .2, y + .1, z)); b.add(mk(GEO.box, lampMat(BLUE), w * .35, .16, .3, w * .2, y, z), glow(BLUE, 3.2, 1, w * .2, y + .1, z)); b.visible = false; g.add(a, b); g.userData.flash = [a, b];
}
function carBody(g, d, color) {
  const { len, w } = d; g.add(mk(GEO.box, mat(color), w, .7, len, 0, .65, 0));
  g.add(mk(GEO.box, mat(GLASS), w * .86, .6, len * .5, 0, 1.3, len * .06)); g.add(mk(GEO.box, mat(color), w * .88, .06, len * .46, 0, 1.63, len * .06));
  wheels(g, w, [-len * .32, len * .32]); lights(g, w, len, .75, .85);
}
function boxBody(g, d, color, cargo) {   // cab + cargo box (box truck, ambulance, fire engine)
  const { len, w } = d, cabL = Math.min(2.4, len * .3); g.add(mk(GEO.box, mat(color), w, 1.1, len, 0, .9, 0));
  g.add(mk(GEO.box, mat(color), w, 1.3, cabL, 0, 2.1, -len / 2 + cabL / 2)); g.add(mk(GEO.box, mat(GLASS), w * .9, .6, .06, 0, 2.3, -len / 2 - .02));
  g.add(mk(GEO.box, mat(cargo), w * .98, d.h - 1.7, len - cabL - .1, 0, 1.45 + (d.h - 1.7) / 2, cabL / 2 + .05));
  wheels(g, w, [-len / 2 + 1.4, len / 2 - 1.5], .5); lights(g, w, len, 1, 1.5);
}
const STYLES = {
  sedan: (g, d) => carBody(g, d, CAR_COLORS[g.userData.pick % CAR_COLORS.length]),
  police(g, d) { carBody(g, d, 0x15191f); g.add(mk(GEO.box, mat(WHITE), d.w * 1.01, .3, d.len * .55, 0, .75, 0)); siren(g, d.w, 1.75, d.len * .06); },
  truck: (g, d) => boxBody(g, d, 0x4a5a6a, 0xd8d4c8),
  medic(g, d) { boxBody(g, d, WHITE, WHITE); g.add(mk(GEO.box, mat(RED), d.w * 1.01, .25, d.len * .5, 0, 1.6, d.len * .12)); for (const s of [-1, 1]) { g.add(mk(GEO.box, mat(RED), .15, .9, .08, s * (d.w / 2 + .01), 2.5, d.len * .12)); g.add(mk(GEO.box, mat(RED), .15, .08, .9, s * (d.w / 2 + .01), 2.5, d.len * .12)); } siren(g, d.w, d.h + .1, -d.len * .22); },
  fire(g, d) { boxBody(g, d, RED, RED); g.add(mk(GEO.box, mat(0xc8c8c0), .5, .25, d.len * .6, 0, d.h + .1, d.len * .1)); g.add(mk(GEO.box, mat(0xe8c020), d.w * 1.01, .15, d.len * .6, 0, 1.6, d.len * .12)); siren(g, d.w, d.h + .15, -d.len * .3); },
  bus(g, d) {
    const { len, w, h } = d; g.add(mk(GEO.box, mat(0xd89a20), w, h - .6, len, 0, (h + .6) / 2, 0)); g.add(mk(GEO.box, mat(GLASS), w * 1.01, .8, len * .9, 0, 2.1, 0)); g.add(mk(GEO.box, mat(GLASS), w * .9, 1, .06, 0, 1.9, -len / 2 - .02));
    wheels(g, w, [-len / 2 + 1.6, len / 2 - 2.5], .5); lights(g, w, len, .9, 1.2);
  },
  freighter(g, d) {   // semi: cab + 13 m trailer with the game's livery colours
    const { len, w } = d, cabL = 2.8; g.add(mk(GEO.box, mat(0x20406a), w, 1.5, cabL, 0, 1.75, -len / 2 + cabL / 2)); g.add(mk(GEO.box, mat(GLASS), w * .9, .7, .06, 0, 2.2, -len / 2 - .02));
    g.add(mk(GEO.box, mat(0x151515), w * .9, .5, len - 1, 0, .8, .5)); g.add(mk(GEO.box, mat(0xe3e1d9), w, d.h - 1.6, len - cabL - .8, 0, 1.6 + (d.h - 1.6) / 2, cabL / 2 + .4));
    g.add(mk(GEO.box, mat(0x1d3a5c), w * 1.01, .35, len - cabL - .8, 0, 1.9, cabL / 2 + .4));
    wheels(g, w, [-len / 2 + 1.6, len / 2 - 1.2, len / 2 - 2.5], .5); lights(g, w, len, 1.1, 1.3);
  },
};
/* types: size (m), mass = hull-damage multiplier, v = cruise speed range m/s (truck governor is 28), presets = weighted AI behaviours, rare = spawn weight */
export const VEHICLES = {
  sedan:     { name: 'car', len: 4.6, w: 1.85, h: 1.7, mass: 1,   v: [16, 26], rare: 10, presets: { cruise: 5, slow: 2, tailgate: 2, overtake: 3, weave: 1 } },
  truck:     { name: 'truck', len: 7.5, w: 2.4,  h: 3.4, mass: 1.8, v: [13, 21], rare: 4,  presets: { cruise: 5, slow: 3, tailgate: 1 } },
  bus:       { name: 'bus', len: 12,  w: 2.55, h: 3.3, mass: 2.2, v: [14, 20], rare: 3,  presets: { cruise: 5, slow: 2 } },
  freighter: { name: 'freighter', len: 17,  w: 2.5,  h: 4.0, mass: 3,   v: [13, 20], rare: 4,  presets: { cruise: 6, slow: 3 } },
  police:    { name: 'police car', len: 4.8,  w: 1.9,  h: 1.8, mass: 1.1, v: [22, 30], rare: 2,  presets: { cruise: 2, emergency: 3, tailgate: 1 } },
  medic:     { name: 'ambulance', len: 6.2,  w: 2.2,  h: 3.0, mass: 1.5, v: [24, 32], rare: 1.2, presets: { emergency: 1 } },
  fire:      { name: 'fire engine', len: 9,    w: 2.5,  h: 3.3, mass: 2.5, v: [22, 30], rare: 1,  presets: { emergency: 1 } },
};
for (const [k, d] of Object.entries(VEHICLES)) { d.type = k; }
// create every material up front so FLIP_MATS (snapshotted by render.js at load) is complete
for (const c of [HEAD, TAIL, BRAKE, RED, BLUE, AMBER]) lampMat(c);
for (const c of [GLASS, TYRE, RED, WHITE, 0x15191f, 0x4a5a6a, 0xd8d4c8, 0xc8c8c0, 0xe8c020, 0xd89a20, 0x20406a, 0xe3e1d9, 0x1d3a5c, ...CAR_COLORS]) mat(c);

/* builds a vehicle group in the scene; `pick` selects the sedan colour */
export function buildVehicle(def, pick = 0) {
  const g = new THREE.Group(); g.userData.pick = pick; g.userData.hi = pick % 3 === 0; STYLES[def.type](g, def); scene.add(g); return g;
}
export function removeVehicle(g) { scene.remove(g); releaseTree(g); }   // its mk() parts go back to the pool (world/pool.js)
