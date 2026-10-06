import * as THREE from 'three';
import { GEO, mk } from '../../../world/props.js';
import { canvasTex } from '../../../world/scene.js';
import { rnd } from '../../../util.js';
import { basic, trackMat } from '../mats.js';
import { motel, hotel } from './lodging.js';
import { restaurant } from './food.js';
import { gas } from './fuel.js';
import { police } from './police.js';

/* Roadside LANDMARKS: static buildings beside the road (motels, hotels, gas stations, police stop points, restaurants).
   Abstract on two levels:
   – a TYPE (key of TYPES) is a kind of place; it owns a list of interchangeable IMPLEMENTATIONS { id, hl, hd, make(g, c) } (see lodging.js…).
     Add an implementation: push a row to a type's array. Add a type: new array here + a default name list + a weight in the theme.
   – a theme only supplies a look (palette, names, frequency, mix) through createLandmarks(config) – never geometry.
   At most one landmark per 32 m chunk (deterministic per chunk), set back from the road on an apron, solid like a building (KINDS.building). */
export const TYPES = { motel, hotel, restaurant, gas, police };
const NAMES = { motel: ['MOTEL', 'INN', 'LODGE'], hotel: ['HOTEL', 'GRAND', 'RESORT'], restaurant: ['DINER', 'CAFE', 'GRILL', 'EATS'], gas: ['GAS', 'FUEL', 'DIESEL'], police: ['POLICE', 'CHECK'] };
const PAL = {   // CSS colours; walls = per-site variants. A theme overrides only what it wants to change.
  walls: ['#e8d9b8', '#d9b99a', '#b9d4cf'], roof: '#7a4a38', trim: '#f2efe6', glass: '#5f8fa8', door: '#7a3b2a', lot: '#3b3b3e', metal: '#8a8f96', dark: '#23252a',
  accent: '#c8281f', accent2: '#1f4a9a', neon: '#ffd84a', leaf: '#3f7a3b', trunk: '#6b4f33', cone: '#ff7a1a',
};

export function createLandmarks({ pal = {}, chance = .22, near = [12, 16], weights = {}, names = {} } = {}) {
  const P = { ...PAL, ...pal }, W = { motel: 1, hotel: 1, restaurant: 1, gas: 1, police: 1, ...weights }, N = { ...NAMES, ...names };
  const m = { roof: basic(P.roof), trim: basic(P.trim), glass: basic(P.glass), door: basic(P.door), lot: basic(P.lot), metal: basic(P.metal), dark: basic(P.dark), accent: basic(P.accent), accent2: basic(P.accent2), neon: basic(P.neon),
    leaf: basic(P.leaf), trunk: basic(P.trunk), cone: basic(P.cone), white: basic(0xf2f2ea), red: basic(0xd22a22), blue: basic(0x1f4a9a), walls: P.walls.map(w => basic(w)) };
  const SIGN = { neon: [P.dark, P.neon], red: [P.accent, '#ffffff'], blue: [P.accent2, '#ffffff'], cream: [P.trim, P.dark] };
  const cache = new Map(), tex = (key, make) => cache.get(key) ?? (cache.set(key, make()), cache.get(key));
  const signMat = (style, text) => tex(style + text, () => {
    const [bg, fg] = SIGN[style];
    return trackMat(new THREE.MeshBasicMaterial({ map: canvasTex(256, 128, (g, w, h) => {
      g.fillStyle = bg; g.fillRect(0, 0, w, h); g.strokeStyle = fg; g.lineWidth = 6; g.strokeRect(8, 8, w - 16, h - 16);
      let px = 70; do g.font = `bold ${px -= 4}px sans-serif`; while (g.measureText(text).width > w - 44);
      g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, w / 2, h / 2 + 4);
    }, false) }));
  });
  const facadeMat = (wi, cols, rows) => tex(`f${wi}.${cols}.${rows}`, () => trackMat(new THREE.MeshBasicMaterial({ map: canvasTex(256, 256, (g, w, h) => {   // window grid (some lit)
    g.fillStyle = P.walls[wi]; g.fillRect(0, 0, w, h);
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) { g.fillStyle = rnd(i * 13 + j * 7 + wi) < .25 ? '#ffe9a0' : P.glass; g.fillRect((i + .2) * w / cols, (j + .2) * h / rows, w / cols * .6, h / rows * .55); }
  }, false) })));

  /* Which landmark (if any) sits in chunk `ci`; chunks.js asks first so it can keep ordinary props out of the footprint. */
  function site(ci, s0) {
    if (ci < 1 || rnd(ci * 3.31 + 17) > chance) return null;
    const keys = Object.keys(TYPES).filter(k => W[k] > 0); let x = rnd(ci * 5.17 + 2) * keys.reduce((a, k) => a + W[k], 0), type = keys[keys.length - 1];
    for (const k of keys) { if ((x -= W[k]) < 0) { type = k; break; } }
    const impls = TYPES[type], v = impls[Math.floor(rnd(ci * 7.9 + 5) * impls.length)], names = N[type], side = rnd(ci * 2.3 + 9) < .5 ? -1 : 1, set = near[0] + rnd(ci * 4.1 + 1) * (near[1] - near[0]);
    return { type, v, side, near: set, s: s0 + 16, lat: side * (set + v.hd), hl: v.hl, hd: v.hd, wi: Math.floor(rnd(ci * 9.3 + 4) * m.walls.length), name: names[Math.floor(rnd(ci * 1.9 + 8) * names.length)] };
  }
  function model(L) {   // the finished model for a site (also used by the model viewer)
    const root = new THREE.Group(), g = new THREE.Group(), wall = m.walls[L.wi];
    const c = { m, wall, wi: L.wi, facade: (cols, rows) => facadeMat(L.wi, cols, rows),
      sign: (style, w, h, x, y, z, text = L.name) => mk(GEO.box, signMat(style, text), .2, h, w, x, y + h / 2, z) };
    L.v.make(g, c);
    const wa = L.near - 6.1 + L.hd;   // apron: tarmac from the shoulder to the middle of the footprint
    g.add(mk(GEO.box, m.lot, wa, .04, L.hl * 2 + 2, -wa / 2, .02, 0));
    g.rotation.y = L.side > 0 ? 0 : Math.PI; root.add(g);   // models face -x (toward the road for right-hand sites)
    root.name = L.v.id; root.userData = { kind: 'building', size: 1, debris: wall };
    return root;
  }
  function build(L, ci, { place, reg, destroyed }) {
    const id = ci + ':lm'; if (!L || destroyed.has(id)) return;
    const root = model(L); place(root, L.s, L.lat); reg(root, id, L.s, L.lat, { rf: L.hl, rl: L.hd });
  }
  const preview = (type, i, wi = 0) => { const v = TYPES[type][i]; return model({ v, side: 1, near: near[0], hl: v.hl, hd: v.hd, wi, name: N[type][0] }); };
  return { site, build, preview };
}
