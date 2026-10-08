// Screenshot and measure catalogue items in client/viewer.html.
//   node .claude/skills/storybook-models/shot.mjs                 # print ids
//   node .claude/skills/storybook-models/shot.mjs veh-medic-0 …   # measure + right/front/threeq PNGs
// Env: BASE (origin; default the first of :8765 and :3000 that serves /viewer.html),
//      PORT (Chrome debug port, default 9336), SHOTS (output directory).
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const { launch, sleep } = await import(pathToFileURL(path.join(root, 'client/tools/cdp.mjs')).href);

const LEGEND = 'pastWidestBox = outer X of a cylinder turned onto X (a wheel) minus outer X of the widest box — a stripe or a pane can be that box. gaps = one mesh and the nearest mesh under it, when that opening is 8 cm–3 m, the footprints overlap, and no third mesh fills the opening. Ground slabs are not a support. minY = lowest mesh point (the grid is y = 0). faces = boxes with 6 materials; three.js order is +x -x +y -y +z -z; faceX / faceZ mean that pair shares one material. A gap is a candidate — the PNG decides. Black edge lines are hidden; the grid stays.';

const MEASURE = `(() => {
  const root = window.__viewer.obj;
  root.updateMatrixWorld(true);
  const V = root.position.constructor;
  const glow = c => [].concat(c.material).some(m => m && m.userData && 'gain' in m.userData);
  const boxOf = c => {
    const g = c.geometry;
    if (!g.boundingBox) g.computeBoundingBox();
    const b = g.boundingBox, min = new V(Infinity, Infinity, Infinity), max = new V(-Infinity, -Infinity, -Infinity);
    for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) {
      const p = new V(x, y, z).applyMatrix4(c.matrixWorld);
      min.min(p); max.max(p);
    }
    return { min, max };
  };
  const n = v => +v.toFixed(3);
  const rows = [];
  root.traverse(c => {
    if (!c.isMesh || !c.geometry || glow(c)) return;
    const w = boxOf(c);
    const mats = [].concat(c.material).filter(Boolean);
    const uu = mats.map(m => m.uuid);
    rows.push({
      type: c.geometry.type,
      scale: [n(c.scale.x), n(c.scale.y), n(c.scale.z)],
      pos: [n(c.position.x), n(c.position.y), n(c.position.z)],
      rotZ: n(c.rotation.z),
      world: { min: [n(w.min.x), n(w.min.y), n(w.min.z)], max: [n(w.max.x), n(w.max.y), n(w.max.z)] },
      mats: mats.length,
      faceX: mats.length === 6 ? uu[0] === uu[1] : null,
      faceZ: mats.length === 6 ? uu[4] === uu[5] : null,
    });
  });
  const outer = list => list.reduce((m, r) => Math.max(m, Math.abs(r.world.min[0]), Math.abs(r.world.max[0])), 0);
  const wheels = rows.filter(r => r.type === 'CylinderGeometry' && Math.abs(Math.abs(r.rotZ) - Math.PI / 2) < 0.2);
  const boxes = rows.filter(r => r.type === 'BoxGeometry');
  const tyreOuter = wheels.length ? n(outer(wheels)) : null;
  const widestBox = boxes.length ? n(outer(boxes)) : null;
  const foot = w => Math.max(0, w.max[0] - w.min[0]) * Math.max(0, w.max[2] - w.min[2]);
  const slab = r => (r.world.max[1] - r.world.min[1]) < 0.08 && r.world.min[1] < 0.05;
  const brief = r => ({ type: r.type, scale: r.scale, pos: r.pos });
  const gaps = [];
  for (let i = 0; i < rows.length; i++) {
    const up = rows[i];
    if (slab(up) || foot(up.world) < 1e-4) continue;
    let best = null, touching = false;
    for (let j = 0; j < rows.length; j++) {
      if (i === j || slab(rows[j])) continue;
      const lo = rows[j].world;
      if (lo.max[1] > up.world.min[1] + 0.02) continue;
      const ox = Math.min(up.world.max[0], lo.max[0]) - Math.max(up.world.min[0], lo.min[0]);
      const oz = Math.min(up.world.max[2], lo.max[2]) - Math.max(up.world.min[2], lo.min[2]);
      const ov = ox > 0 && oz > 0 ? ox * oz : 0;
      if (ov < 0.4 * foot(up.world) && ov < 0.8 * foot(lo)) continue;
      const gap = up.world.min[1] - lo.max[1];
      if (gap <= 0.08) touching = true;
      else if (gap < 3 && (!best || gap < best.gap)) best = { j, gap };
    }
    if (touching || !best) continue;
    const y0 = rows[best.j].world.max[1], y1 = up.world.min[1];
    const filled = rows.some((r, k) => {
      if (k === i || k === best.j) return false;
      const c = r.world;
      const ox = Math.min(up.world.max[0], rows[best.j].world.max[0], c.max[0]) - Math.max(up.world.min[0], rows[best.j].world.min[0], c.min[0]);
      const oz = Math.min(up.world.max[2], rows[best.j].world.max[2], c.max[2]) - Math.max(up.world.min[2], rows[best.j].world.min[2], c.min[2]);
      return ox > 0.05 && oz > 0.05 && c.min[1] <= y0 + 0.05 && c.max[1] >= y1 - 0.05;
    });
    if (!filled) gaps.push({ gap: n(best.gap), upper: brief(up), lower: brief(rows[best.j]) });
  }
  gaps.sort((p, q) => q.gap - p.gap);
  let minY = Infinity, maxY = -Infinity, maxX = 0, maxZ = 0;
  for (const r of rows) {
    minY = Math.min(minY, r.world.min[1]); maxY = Math.max(maxY, r.world.max[1]);
    maxX = Math.max(maxX, Math.abs(r.world.min[0]), Math.abs(r.world.max[0]));
    maxZ = Math.max(maxZ, Math.abs(r.world.min[2]), Math.abs(r.world.max[2]));
  }
  return {
    meshes: rows.length,
    minY: rows.length ? n(minY) : null,
    size: rows.length ? [n(maxX * 2), n(maxY - minY), n(maxZ * 2)] : null,
    tyreOuter, widestBox,
    pastWidestBox: tyreOuter != null && widestBox != null ? n(tyreOuter - widestBox) : null,
    gaps: gaps.slice(0, 8),
    gapsMore: Math.max(0, gaps.length - 8),
    faces: rows.filter(r => r.mats === 6).map(r => ({ scale: r.scale, pos: r.pos, faceX: r.faceX, faceZ: r.faceZ })),
  };
})()`;

async function reachable(origin) {
  try {
    const r = await fetch(origin + '/viewer.html', { signal: AbortSignal.timeout(2000) });
    return r.ok;
  } catch { return false; }
}

async function origin() {
  if (process.env.BASE) return process.env.BASE.replace(/\/$/, '').replace(/\/viewer\.html$/, '');
  for (const o of ['http://127.0.0.1:8765', 'http://127.0.0.1:3000']) if (await reachable(o)) return o;
  return null;
}

const base = await origin();
if (!base) {
  console.error('viewer.html is not being served on 127.0.0.1:8765 or :3000. Serve client/ (see the storybook-models skill) or set BASE.');
  process.exit(2);
}

const ids = process.argv.slice(2);
const port = +process.env.PORT || 9336;
const { send, ev, shot, problems, SHOTS, finish } = await launch({ port, shotsDir: 'fc-storybook-shots', evalProblems: true });
let failed = false;
try {
  await send('Page.navigate', { url: base + '/viewer.html' });
  let ready = false;
  for (let i = 0; i < 40 && !ready; i++) {
    ready = await ev('typeof window.__viewer') === 'object';
    if (!ready) await sleep(250);
  }
  if (!ready) throw new Error('viewer did not start at ' + base + '/viewer.html (three.js is loaded from the CDN — the machine needs network)');
  await ev(`['side','info','opts','help'].forEach(id => { const n = document.getElementById(id); if (n) n.style.visibility = 'hidden'; })`);
  if (!ids.length) {
    const text = await ev(`__viewer.items.map(i => i.group + '\\t' + i.id + '\\t' + i.label).join('\\n')`);
    console.log(String(text));
    console.log('count ' + await ev('__viewer.items.length'));
  } else {
    console.log(LEGEND);
    const views = [['right', Math.PI / 2, 0.12], ['front', Math.PI, 0.12], ['threeq', 0.6, 0.35]];
    for (const id of ids) {
      const sel = await ev(`(() => { try { __viewer.select(${JSON.stringify(id)}); return 'ok'; } catch (e) { return 'ERR ' + e.message; } })()`);
      if (sel !== 'ok') { console.error(id + ': ' + sel); failed = true; continue; }
      await ev(`__viewer.obj.traverse(c => { if (c.isLineSegments) c.visible = false; })`);
      const data = await ev(MEASURE);
      if (!data || typeof data !== 'object') { console.error(id + ': measure failed: ' + data); failed = true; continue; }
      const label = await ev('__viewer.items.find(i => i.id === ' + JSON.stringify(id) + ').label');
      console.log([id, label, 'size', (data.size || []).join('x'), 'minY', data.minY, 'tyre', data.tyreOuter, 'widestBox', data.widestBox, 'pastWidestBox', data.pastWidestBox, 'gaps', data.gaps.length + (data.gapsMore || 0), 'faces', data.faces.length].join(' '));
      console.log(JSON.stringify(data));
      const slug = id.replace(/[^\w.-]+/g, '_');
      for (const [name, yaw, pitch] of views) {
        await ev(`__viewer.cam.yaw = ${yaw}; __viewer.cam.pitch = ${pitch}; __viewer.opts.spin = false;`);
        await sleep(350);
        await shot(slug + '-' + name);
      }
    }
    console.log('screenshots in ' + SHOTS);
  }
  const bad = problems.filter(p => !/favicon/.test(p));
  if (bad.length) { console.error(bad.join('\n')); failed = true; }
  else console.log('no page errors');
  finish(failed ? 1 : 0);
} catch (e) {
  console.error(e && e.stack || e);
  finish(1);
}
