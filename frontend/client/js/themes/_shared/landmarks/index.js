import * as THREE from 'three';
import { GEO, mk } from '../../../world/props.js';
import { canvasTex } from '../../../world/scene.js';
import { rnd } from '../../../util.js';
import { basic, trackMat } from '../mats.js';
import { drawFlag } from './flags.js';
import { buildInto } from '../../../world/entity-build.js';
import { ROSTER } from '../../../../shared/entity/roster.js';
import { SHOULDER } from '../../../../shared/road.js';

/* Roadside LANDMARKS: static buildings beside the road (motels, hotels, gas stations, police stop points, restaurants).
   Abstract on two levels:
   – a TYPE (key of TYPES) is a kind of place; it owns a list of interchangeable IMPLEMENTATIONS { id, hl, hd }: the footprint and order are
     gameplay (client/shared/entity/roster.js), the model is the entity of that id (client/shared/entity/seed/landmark/<id>.js).
     Add an implementation: an entity + a roster row (at the END of its type). Add a type: a roster list + a default name list + a weight in W.
   – a theme only supplies a look (palette, names, frequency, mix, flag id) through createLandmarks(config) – never geometry.
   At most one landmark per 32 m chunk (deterministic per chunk), set back from the road on an apron, solid like a building (KINDS.building). */
export const TYPES = ROSTER.landmark;
const NAMES = { motel: ['MOTEL', 'INN', 'LODGE'], hotel: ['HOTEL', 'GRAND', 'RESORT'], restaurant: ['DINER', 'CAFE', 'GRILL', 'EATS'], gas: ['GAS', 'FUEL', 'DIESEL'], gulp: ['GULP'], police: ['POLICE', 'CHECK'] };
const PAL = {   // CSS colours; walls = per-site variants. A theme overrides only what it wants to change.
  walls: ['#e8d9b8', '#d9b99a', '#b9d4cf'], roof: '#7a4a38', trim: '#f2efe6', glass: '#5f8fa8', door: '#7a3b2a', lot: '#3b3b3e', metal: '#8a8f96', dark: '#23252a',
  accent: '#c8281f', accent2: '#1f4a9a', neon: '#ffd84a', leaf: '#3f7a3b', trunk: '#6b4f33', cone: '#ff7a1a',
};

export function createLandmarks({ pal = {}, chance = .22, near = [12, 16], weights = {}, names = {}, flag = null } = {}) {
  const P = { ...PAL, ...pal }, W = { motel: 1, hotel: 1, restaurant: 1, gas: 1, police: 1, gulp: 0.9, ...weights }, N = { ...NAMES, ...names };
  const m = { roof: basic(P.roof), trim: basic(P.trim), glass: basic(P.glass), door: basic(P.door), lot: basic(P.lot), apron: basic(P.lot, { polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }), metal: basic(P.metal), dark: basic(P.dark), accent: basic(P.accent), accent2: basic(P.accent2), neon: basic(P.neon),
    leaf: basic(P.leaf), trunk: basic(P.trunk), cone: basic(P.cone), white: basic(0xf2f2ea), red: basic(0xd22a22), blue: basic(0x1f4a9a), walls: P.walls.map(w => basic(w)) };
  const SIGN = { neon: [P.dark, P.neon], red: [P.accent, '#ffffff'], blue: [P.accent2, '#ffffff'], cream: [P.trim, P.dark] };
  const cache = new Map(), tex = (key, make) => cache.get(key) ?? (cache.set(key, make()), cache.get(key));
  const signMat = (style, text) => tex(style + text, () => {
    const [bg, fg] = SIGN[style];
    return trackMat(new THREE.MeshBasicMaterial({ map: canvasTex(256, 128, (g, w, h) => {
      g.fillStyle = bg; g.fillRect(0, 0, w, h); g.strokeStyle = fg; g.lineWidth = 6; g.strokeRect(8, 8, w - 16, h - 16);
      let px = 70; do g.font = `bold ${px -= 4}px sans-serif`; while (px > 14 && g.measureText(text).width > w - 44);
      g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, w / 2, h / 2 + 4);
    }, false) }));
  });
  const signEdge = style => tex('edge' + style, () => basic(SIGN[style][0]));
  // Cylinder caps: +y puts texture-up at local +x, −y puts it at local −x. rotation.z = π/2 then sends +y to −x
  // (the road) and local +x to world up, so the −y face is drawn flipped or GAS is upside down from the back.
  const diskFace = (style, text, back) => tex('disk:' + style + ':' + text + ':' + (back ? 'b' : 'f'), () => {
    const [bg, fg] = SIGN[style];
    return trackMat(new THREE.MeshBasicMaterial({ map: canvasTex(256, 256, (g, w, h) => {
      g.fillStyle = bg; g.fillRect(0, 0, w, h);
      g.save();
      if (back) { g.translate(w, h); g.scale(-1, -1); }
      g.strokeStyle = fg; g.lineWidth = 8; g.beginPath(); g.arc(w / 2, h / 2, w * .44, 0, Math.PI * 2); g.stroke();
      let px = Math.floor(h * .34); do g.font = `bold ${px -= 2}px sans-serif`; while (px > 16 && g.measureText(text).width > w * .6);
      g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, w / 2, h / 2);
      g.restore();
    }, false) }));
  });
  const flagPair = id => ['px', 'nx'].map(side => tex('flag:' + id + ':' + side, () => trackMat(new THREE.MeshBasicMaterial({ map: canvasTex(256, 160, (g, w, h) => drawFlag(g, w, h, id, side), false) }))));
  const facadeMat = (wi, cols, rows) => tex(`f${wi}.${cols}.${rows}`, () => trackMat(new THREE.MeshBasicMaterial({ map: canvasTex(256, 256, (g, w, h) => {   // window grid (some lit)
    g.fillStyle = P.walls[wi]; g.fillRect(0, 0, w, h);
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) { g.fillStyle = rnd(i * 13 + j * 7 + wi) < .25 ? '#ffe9a0' : P.glass; g.fillRect((i + .2) * w / cols, (j + .2) * h / rows, w / cols * .6, h / rows * .55); }
  }, false) })));

  /* Which landmark (if any) sits in chunk `ci`; chunks.js asks first so it can keep ordinary props out of the footprint.
     Chunk 2 is the access road just past the yard (s ≈ 80). One GULP is pinned there, on the driver's right, so a ride can fuel without hunting. */
  const NEAR_START = 2;
  function site(ci, s0) {
    if (ci === NEAR_START) {
      const v = TYPES.gulp[0], set = near[0], side = 1;
      return { type: 'gulp', v, side, near: set, s: s0 + 16, lat: side * (set + v.hd), hl: v.hl, hd: v.hd, wi: 0, name: 'GULP' };
    }
    if (ci < 1 || rnd(ci * 3.31 + 17) > chance) return null;
    const keys = Object.keys(TYPES).filter(k => W[k] > 0); let x = rnd(ci * 5.17 + 2) * keys.reduce((a, k) => a + W[k], 0), type = keys[keys.length - 1];
    for (const k of keys) { if ((x -= W[k]) < 0) { type = k; break; } }
    const impls = TYPES[type], v = impls[Math.floor(rnd(ci * 7.9 + 5) * impls.length)], names = N[type], side = rnd(ci * 2.3 + 9) < .5 ? -1 : 1, set = near[0] + rnd(ci * 4.1 + 1) * (near[1] - near[0]);
    return { type, v, side, near: set, s: s0 + 16, lat: side * (set + v.hd), hl: v.hl, hd: v.hd, wi: Math.floor(rnd(ci * 9.3 + 4) * m.walls.length), name: names[Math.floor(rnd(ci * 1.9 + 8) * names.length)] };
  }
  function model(L) {   // the finished model for a site (also used by the model viewer)
    const root = new THREE.Group(), g = new THREE.Group(), wall = m.walls[L.wi];
    const ids = flag == null ? [] : Array.isArray(flag) ? flag : [flag];
    const flags = ids.map(flagPair);
    // the painters behind the entity's material descriptors (a sign is a chunky box with the word on every vertical face – plan.js;
    // a disk's groups are side, +y cap, −y cap)
    // Expressions can take interior parameter values the validator cannot enumerate; painter work stays bounded at runtime too.
    const ctx = { slot: n => (n === 'wall' ? wall : m[n] ?? null), facade: (cols, rows) => facadeMat(L.wi, Math.max(1, Math.min(32, Math.floor(cols) || 1)), Math.max(1, Math.min(32, Math.floor(rows) || 1))), sign: (style, text) => signMat(style, text ?? L.name), edge: signEdge,
      disk: (style, text, back) => diskFace(style, text, back), flag: (i, side) => flags[i]?.[side] ?? m.red };
    buildInto(g, L.v.id, { flags: flags.length }, ctx);
    const wa = L.near - 6.1 - SHOULDER + L.hd + .6;   // across the shoulder and 0.5 m under the asphalt; offset -3 covers the grass, marks stay at -4
    g.add(mk(GEO.box, m.apron, wa, .04, L.hl * 2 + 2, -wa / 2, .02, 0));
    g.rotation.y = L.side > 0 ? 0 : Math.PI; root.add(g);   // models face -x (toward the road for right-hand sites)
    root.name = L.v.id; root.userData = { kind: 'building', size: 1, debris: wall };
    return root;
  }
  function build(L, ci, { place, reg, destroyed }) {
    const id = ci + ':lm'; if (!L || destroyed.has(id)) return;
    const root = model(L); place(root, L.s, L.lat); reg(root, id, L.s, L.lat, { rf: L.hl, rl: L.hd });
  }
  const preview = (type, i, wi = 0) => { const v = TYPES[type][i]; return model({ v, side: 1, near: near[0], hl: v.hl, hd: v.hd, wi, name: N[type][0] }); };
  return { site, build, preview, nearStart: NEAR_START };
}
