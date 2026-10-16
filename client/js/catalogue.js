import * as THREE from 'three';
import { VEHICLES, buildVehicle } from './world/vehicles.js';
import { KINDS } from './world/props.js';
import { buildGantry } from './world/gantry.js';
import { THEMES } from './themes/index.js';
import { TYPES } from './themes/_shared/landmarks/index.js';
import { entityOf, buildInto } from './world/entity-build.js';
import { entityConfig, entityIds } from './world/entities.js';
import { colorMat } from './themes/_shared/mats.js';

/* The model viewer's catalogue (viewer.html, no DOM here): every 3D object of the game except the player's own truck, built by the SAME code
   the game uses. id = '<entity>' for a vehicle ('sedan#3' = paint 3), '<route>/<entity>' for what a route places ('route66/cactus',
   'route66/cactus~2' = its second look, 'brenner/guard', 'stuart/gas-kiosk', 'siberia/gantry'). Each item: { group, id, entity, label, make(), info() }. */

const f = (n, d = 2) => +n.toFixed(d);
const FURN = { post: 'delineator post', pole: 'utility pole', guard: 'guardrail segment', lamp: 'street lamp' };
export const collider = o => { const u = o.userData, k = KINDS[u.kind]?.(u.size); return k ? [['kind', u.kind], ['size param', f(u.size)], ['collision r', k.rf ? `${k.rf} × ${k.rl} m` : `${f(k.r)} m`], ['hp (speed² budget)', f(k.hp, 0)], ['hull dmg @28 m/s', `${f(k.dmg, 1)} %`], ['slowdown on break', `${f(k.slow * 100, 0)} %`]] : []; };
const sig = o => { const m = []; o.traverse(c => c.isMesh && m.push(c.material.uuid ?? c.material.id)); return `${m.length}|${m.join()}`; };

export function buildCatalogue() {
  const items = [], add = (group, id, entity, label, make, info) => items.push({ group, id, entity, label, make, info });
  for (const [type, d] of Object.entries(VEHICLES)) {
    const paints = type === 'sedan' ? entityConfig('sedan')?.consts?.palette?.length ?? 1 : 1;
    for (let p = 0; p < paints; p++) add('Vehicles', p ? `${type}#${p}` : type, type, paints > 1 ? `${d.name} · colour ${p + 1}` : d.name, () => buildVehicle(d, p),
      () => [['entity', type], ['length × width × height', `${d.len} × ${d.w} × ${d.h} m`], ['mass (hull dmg ×)', d.mass], ['cruise speed', `${d.v[0]}–${d.v[1]} m/s`], ['AI presets', Object.keys(d.presets).join(', ')]]);
  }
  for (const t of THEMES) {
    const G = `Route · ${t.name}`, pr = t.createProps(), seen = new Map();
    // the picker maps (r, r2) → an entity with params; sweep both to find every distinct look (entity × part count × materials)
    for (let i = 0; i < 100; i++) for (const r2 of [.1, .5, .9]) { const o = pr.pick((i + .5) / 100, r2), e = entityOf(o), s = `${e}|${sig(o)}`; if (!seen.has(s)) seen.set(s, { r: (i + .5) / 100, r2, e, name: o.name || e }); }
    const n = {};
    for (const v of seen.values()) {
      const k = (n[v.e] = (n[v.e] ?? 0) + 1);
      add(G, `${t.id}/${v.e}${k > 1 ? '~' + k : ''}`, v.e, v.name + (k > 1 ? ` ${k}` : ''), () => t.createProps().pick(v.r, v.r2), function () { return [['entity', v.e], ...collider(this.obj)]; });   // fresh createProps: the same materials are shared per call
    }
    const furniture = e => { let got = null; t.createFurniture().build({ ci: 0, s0: 0, place: o => { if (!got && (e === null || entityOf(o) === e)) got = o; }, reg() {}, destroyed: new Set() }); return got; };
    const caught = new Set(); t.createFurniture().build({ ci: 0, s0: 0, place: o => { const e = entityOf(o); if (e) caught.add(e); }, reg() {}, destroyed: new Set() });
    for (const e of caught) add(G, `${t.id}/${e}`, e, FURN[e] || e, () => furniture(e), function () { return [['entity', e], ...collider(this.obj)]; });   // rebuilt on every select: a preview of an edit shows at once
    if (t.createLandmarks) for (const [type, impls] of Object.entries(TYPES)) impls.forEach((v, i) => add(`Landmarks · ${t.name}`, `${t.id}/${v.id}`, v.id, `${type} · ${v.id.replace(/^[a-z]+-/, '')}`, () => t.createLandmarks().preview(type, i),
      () => [['entity', v.id], ['type', type], ['footprint', `${v.hl * 2} × ${v.hd * 2} m`], ['collider', 'building: hp 3000, 40 % hull @28 m/s']]));
    add(G, `${t.id}/gantry`, 'gantry', 'finish gantry', () => buildGantry(t.finishText), () => [['entity', 'gantry'], ['banner text', t.finishText], ['span', '14.4 m between posts, 7 m high'], ['hp / hull dmg', '500 / 35 % per post']]);
  }
  // every entity no route places: parts, and new entities the editor made – drawn with stand-in materials (one colour per slot name)
  const shown = new Set(items.map(i => i.entity));
  for (const id of entityIds().sort()) if (!shown.has(id)) { const e = entityConfig(id); add('Entities', id, id, `${e.label ?? id} · ${e.kind}`, () => previewEntity(id), () => [['entity', id], ['kind', e.kind], ['note', 'not placed by any route yet – stand-in colours']]); }
  return items;
}

/* An entity on its own, with stand-in materials: every slot a stable colour from its name, painters as flat colours. */
const STAND_IN = [0x8a8f96, 0xc8281f, 0x3f7a3b, 0x6b4f33, 0x5f8fa8, 0xe8d9b8, 0xffd84a, 0x1f4a9a, 0xf2efe6, 0x23252a];
const slotColor = n => { let h = 0; for (const c of n) h = (h * 31 + c.charCodeAt(0)) >>> 0; return STAND_IN[h % STAND_IN.length]; };
export function previewEntity(id) {
  const g = new THREE.Group();
  buildInto(g, id, {}, {
    slot: n => colorMat(slotColor(n)), facade: () => colorMat(0xb9d4cf), sign: () => colorMat(0xffd84a), edge: () => colorMat(0x23252a), disk: () => colorMat(0xc8281f), flag: () => colorMat(0xd22a22),
    banner: (w, h, x, y, z) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), colorMat(0x1d3a5c)); m.position.set(x, y, z); m.userData.disposable = true; return m; },
  });
  return g;
}
