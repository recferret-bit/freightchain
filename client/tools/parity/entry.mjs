// Builds the whole 3D catalogue with the game's own builders and prints one canonical line per object (key \t tree),
// so two code versions can be compared bit for bit (tools/parity/run.mjs). Numbers print with full precision and -0 kept.
import './dom.mjs';
import { createHash } from 'node:crypto';
import { VEHICLES, buildVehicle } from '../../js/world/vehicles.js';
import { THEMES } from '../../js/themes/index.js';
import { TYPES } from '../../js/themes/_shared/landmarks/index.js';
import { buildGantry } from '../../js/world/gantry.js';
import { meshPool, groupPool } from '../../js/world/pool.js';
import { loadEntities } from '../../js/world/entities.js';   // (run.mjs gives a pre-entity base tree a no-op one)

await loadEntities();

const n = v => (Object.is(v, -0) ? '-0' : String(v));
const hash = s => createHash('sha1').update(s).digest('hex').slice(0, 12);
const val = v => (typeof v === 'number' ? n(v) : JSON.stringify(v));
function ser(root) {
  const paths = new Map(), mats = new Map();
  (function walk(o, p) { paths.set(o, p); o.children.forEach((c, i) => walk(c, p + '.' + i)); })(root, 'r');
  const mat = m => {
    if (!mats.has(m)) mats.set(m, mats.size);
    const o = Object.entries(m.opts ?? {}).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v && typeof v === 'object' ? (v.log ? 'tex:' + hash(JSON.stringify(v.log)) : '[obj]') : val(v)}`).join(',');
    return `m${mats.get(m)}<${m.kind}${o ? ' ' + o : ''}${m.userData?.gain !== undefined ? ' gain=' + n(m.userData.gain) : ''}${m.side ? ' side=' + m.side : ''}>`;
  };
  const ud = v => {
    if (v === null || v === undefined) return String(v);
    if (typeof v !== 'object') return val(v);
    if (paths.has(v)) return '@' + paths.get(v);
    if (v.kind && v.opts) return mat(v);
    if (Array.isArray(v)) return '[' + v.map(ud).join(',') + ']';
    if (v.children) return '@outside';
    return '{' + Object.entries(v).map(([k, x]) => `${k}:${ud(x)}`).join(',') + '}';
  };
  const out = [];
  for (const [o, p] of paths) {
    const g = o.geometry, pool = meshPool.owned.has(o) ? 'P' : groupPool.owned.has(o) ? 'G' : '-';
    const r = o.rotation, s = o.scale, q = o.position;
    let line = `${p} ${o.type}${pool} '${o.name}' v=${o.visible} ro=${o.renderOrder} fc=${o.frustumCulled} p=${n(q.x)},${n(q.y)},${n(q.z)} r=${n(r.x)},${n(r.y)},${n(r.z)},${r.order} s=${n(s.x)},${n(s.y)},${n(s.z)}`;
    if (g) line += ` g=${g.kind}(${g.args.map(n).join(',')})${g.ops.length ? JSON.stringify(g.ops) : ''}`;
    if (o.material) line += ` mat=${Array.isArray(o.material) ? '[' + o.material.map(mat).join(',') + ']' : mat(o.material)}`;
    const keys = Object.keys(o.userData); if (keys.length) line += ` ud=${ud(o.userData)}`;
    out.push(line);
  }
  return out.join(' | ');
}
const emit = (key, s) => console.log(key + '\t' + s);

for (const [type, d] of Object.entries(VEHICLES)) for (let pick = 0; pick <= 20; pick++) { const g = buildVehicle(d, pick); g.parent?.remove(g); emit(`veh|${type}|${pick}`, ser(g)); }
for (const t of THEMES) {
  const pr = t.createProps();
  emit(`props|${t.id}|meta`, JSON.stringify({ slots: pr.slots, density: pr.density, near: pr.near, span: pr.span }));
  for (let i = 0; i < 100; i++) for (let j = 0; j <= 20; j++) { const r = (i + .5) / 100, r2 = j / 20; emit(`prop|${t.id}|${r}|${r2}`, ser(pr.pick(r, r2))); }
  const f = t.createFurniture();
  for (let ci = 0; ci < 24; ci++) {
    const placed = [];
    f.build({ ci, s0: ci * 32, place: (o, s, lat) => placed.push([o, s, lat]), reg: (o, id, s, lat, ext) => placed.push(['reg', id, s, lat, ext]), destroyed: new Set(), lms: [] });
    emit(`furn|${t.id}|${ci}`, placed.map(x => (x[0] === 'reg' ? `reg ${x[1]} ${n(x[2])} ${n(x[3])} ${JSON.stringify(x[4] ?? null)}` : `${n(x[1])},${n(x[2])} ${ser(x[0])}`)).join(' || '));
    emit(`lampAt|${t.id}|${ci}`, JSON.stringify(f.lampAt?.(ci) ?? null));
  }
  emit(`lampRgb|${t.id}`, JSON.stringify(f.lampRgb ?? null));
  if (t.createLandmarks) {
    const L = t.createLandmarks();
    for (const [type, impls] of Object.entries(TYPES)) impls.forEach((v, i) => { for (let wi = 0; wi < 3; wi++) emit(`lm|${t.id}|${type}|${v.id}|${wi}`, ser(L.preview(type, i, wi))); });
    for (let ci = 0; ci < 400; ci++) {
      const site = L.site(ci, ci * 32); if (!site) continue;
      const { v, ...rest } = site; emit(`site|${t.id}|${ci}`, JSON.stringify({ ...rest, id: v.id, hl: v.hl, hd: v.hd }));
      if (ci < 160) { const placed = []; L.build(site, ci, { place: (o, s, lat) => placed.push([o, s, lat]), reg: (o, id, s, lat, ext) => placed.push(['reg', id, s, lat, ext]), destroyed: new Set() }); emit(`lmbuild|${t.id}|${ci}`, placed.map(x => (x[0] === 'reg' ? `reg ${x[1]} ${n(x[2])} ${n(x[3])} ${JSON.stringify(x[4])}` : `${n(x[1])},${n(x[2])} ${ser(x[0])}`)).join(' || ')); }
    }
  }
  emit(`gantry|${t.id}`, ser(buildGantry(t.finishText)));
}
emit('types', JSON.stringify(Object.fromEntries(Object.entries(TYPES).map(([k, a]) => [k, a.map(v => [v.id, v.hl, v.hd])]))));
