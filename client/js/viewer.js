import * as THREE from 'three';
import { renderer } from './world/scene.js';
import { VEHICLES, buildVehicle } from './world/vehicles.js';
import { KINDS } from './world/props.js';
import { buildGantry } from './world/gantry.js';
import { THEMES } from './themes/index.js';
import { TYPES } from './themes/_shared/landmarks/index.js';

/* Model viewer (viewer.html): a separate scene with every 3D object of the game except the player's own freighter/trailer –
   traffic vehicles, and per route the scenery props, roadside furniture and finish gantry – built by the SAME code the game uses.
   Orbit / zoom / pan are hand-rolled (no extra imports). Selection lives in location.hash so a view can be linked. */

const $ = id => document.getElementById(id);
const scene = new THREE.Scene(); scene.background = new THREE.Color(0x25282c);
const camera = new THREE.PerspectiveCamera(45, 1, .05, 600);
const grid = new THREE.GridHelper(60, 60, 0x6a7078, 0x3a3f45); grid.position.y = -.002; scene.add(grid);
const stage = new THREE.Group(); scene.add(stage);

/* ---------- catalogue: { group, label, make() → Object3D, info() → [[k, v]…] } ---------- */
const items = [];
const add = (group, id, label, make, info) => items.push({ group, id, label, make, info });
const f = (n, d = 2) => +n.toFixed(d);

for (const [type, d] of Object.entries(VEHICLES)) {
  const picks = type === 'sedan' ? [0, 1, 2, 3, 4, 5, 6] : [0];   // sedans come in 7 paint colours
  for (const p of picks) add('Vehicles', `veh-${type}-${p}`, picks.length > 1 ? `${d.name} · colour ${p + 1}` : d.name, () => buildVehicle(d, p),
    () => [['type', type], ['length × width × height', `${d.len} × ${d.w} × ${d.h} m`], ['mass (hull dmg ×)', d.mass], ['cruise speed', `${d.v[0]}–${d.v[1]} m/s`], ['AI presets', Object.keys(d.presets).join(', ')]]);
}
const FURN = { post: 'delineator post', pole: 'utility pole', guard: 'guardrail segment' };
const collider = o => { const u = o.userData, k = KINDS[u.kind]?.(u.size); return k ? [['kind', u.kind], ['size param', f(u.size)], ['collision r', k.rf ? `${k.rf} × ${k.rl} m` : `${f(k.r)} m`], ['hp (speed² budget)', f(k.hp, 0)], ['hull dmg @28 m/s', `${f(k.dmg, 1)} %`], ['slowdown on break', `${f(k.slow * 100, 0)} %`]] : []; };
const sig = o => { const m = []; o.traverse(c => c.isMesh && m.push(c.material.uuid)); return `${o.userData.kind}|${m.length}|${m.join()}`; };
for (const t of THEMES) {
  const G = `Route · ${t.name}`, pr = t.createProps(), seen = new Map();
  // the picker maps (r, r2) → prop; sweep both to find every distinct variant (kind × part count × materials)
  for (let i = 0; i < 100; i++) for (const r2 of [.1, .5, .9]) { const o = pr.pick((i + .5) / 100, r2), s = sig(o); if (!seen.has(s)) seen.set(s, { r: (i + .5) / 100, r2, name: o.name || o.userData.kind }); }
  const count = {}; for (const v of seen.values()) count[v.name] = (count[v.name] || 0) + 1;
  const idx = {};
  for (const v of seen.values()) {
    const n = count[v.name] > 1 ? ` ${(idx[v.name] = (idx[v.name] || 0) + 1)}` : '';
    add(G, `${t.id}-${v.name.replace(/\W+/g, '_')}${n.trim()}`, v.name + n, () => t.createProps().pick(v.r, v.r2), function () { return collider(this.obj); });   // fresh createProps: same materials are shared per call
  }
  const caught = new Map();
  t.createFurniture().build({ ci: 0, s0: 0, place: o => { if (!caught.has(o.userData.kind)) caught.set(o.userData.kind, o); }, reg() {}, destroyed: new Set() });
  for (const [k, o] of caught) add(G, `${t.id}-${k}`, FURN[k] || k, () => o, function () { return collider(this.obj); });
  if (t.createLandmarks) for (const [type, impls] of Object.entries(TYPES)) impls.forEach((v, i) => add(`Landmarks · ${t.name}`, `${t.id}-lm-${v.id}`, `${type} · ${v.id.replace(/^[a-z]+-/, '')}`, () => t.createLandmarks().preview(type, i),
    () => [['type', type], ['implementation', v.id], ['footprint', `${v.hl * 2} × ${v.hd * 2} m`], ['collider', 'building: hp 3000, 40 % hull @28 m/s']]));
  add(G, `${t.id}-gantry`, 'finish gantry', () => buildGantry(t.finishText), () => [['kind', 'gantry'], ['banner text', t.finishText], ['span', '14.4 m between posts, 7 m high'], ['hp / hull dmg', '500 / 35 % per post']]);
}

/* ---------- selection ---------- */
let cur = null, obj = null, bounds = new THREE.Box3();
const opts = { edges: true, grid: true, box: false, wire: false, spin: false, brake: false, siren: true };
let boxHelper = null, edgeLines = [], wireMats = [];
const edgeCache = new Map(), edgeMat = new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: .55 });

function clearStage() {
  for (const m of wireMats) m.wireframe = false; wireMats = [];
  for (const c of [...stage.children]) stage.remove(c); edgeLines = []; boxHelper = null;
}
function select(item, keepCam) {
  clearStage(); cur = item; item.obj = obj = item.make(); stage.add(obj);
  bounds = new THREE.Box3().setFromObject(obj);   // measured before the helper lines are added
  obj.traverse(c => { if (!c.isMesh) return; for (const m of [].concat(c.material)) if (!wireMats.includes(m)) wireMats.push(m);
    let g = edgeCache.get(c.geometry); if (!g) edgeCache.set(c.geometry, g = new THREE.EdgesGeometry(c.geometry, 25));
    const l = new THREE.LineSegments(g, edgeMat); c.add(l); edgeLines.push(l); });
  boxHelper = new THREE.Box3Helper(bounds, 0xffcf5a); stage.add(boxHelper);
  const sz = bounds.getSize(new THREE.Vector3());
  $('info').innerHTML = `<b>${item.label}</b><div style="color:#7d8187">${item.group}</div><table>` +
    [['size (x × y × z)', `${f(sz.x)} × ${f(sz.y)} × ${f(sz.z)} m`], ...item.info()].map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('') + '</table>';
  const det = document.querySelector(`details[data-g="${item.group}"]`); if (det) det.open = true;
  document.querySelectorAll('.item').forEach(e => e.classList.toggle('on', e.dataset.id === item.id));
  const on = document.querySelector('.item.on'); on?.scrollIntoView({ block: 'nearest' });
  try { history.replaceState(null, '', '#' + encodeURIComponent(item.id)); } catch { /* sandboxed frame */ }
  applyOpts(); if (!keepCam) frame();
}
function applyOpts() {
  for (const l of edgeLines) l.visible = opts.edges; if (boxHelper) boxHelper.visible = opts.box; grid.visible = opts.grid;
  for (const m of wireMats) m.wireframe = opts.wire;
  const u = obj?.userData ?? {}; if (u.brake) u.brake.visible = opts.brake; if (u.flash && !opts.siren) u.flash.forEach(g => g.visible = false);
  const rows = [['edges', 'E  edges'], ['grid', 'G  grid (1 m)'], ['box', 'X  bounding box'], ['wire', 'W  wireframe'], ['spin', 'Space  auto-rotate'], ['brake', 'brake lights', !u.brake], ['siren', 'siren flash', !u.flash]];
  if (!$('opts').children.length) $('opts').innerHTML = rows.map(([k, t]) => `<label data-k="${k}"><input type="checkbox" data-k="${k}"> ${t}</label>`).join('');
  for (const [k, , off] of rows) { const l = $('opts').querySelector(`label[data-k=${k}]`); l.classList.toggle('off', !!off); l.firstChild.checked = opts[k]; }
}
$('opts').addEventListener('change', e => { opts[e.target.dataset.k] = e.target.checked; applyOpts(); });

/* sidebar */
{
  let html = '', g = null;
  for (const it of items) { if (it.group !== g) { html += (g ? '</details>' : '') + `<details ${it.group === 'Vehicles' ? 'open' : ''} data-g="${it.group}"><summary>${it.group}</summary>`; g = it.group; } html += `<div class="item" data-id="${it.id}">${it.label}</div>`; }
  $('list').innerHTML = html + '</details>';
  $('list').addEventListener('click', e => { const it = items.find(i => i.id === e.target.dataset?.id); if (it) select(it); });
}
const step = d => select(items[(items.indexOf(cur) + d + items.length) % items.length]);

/* ---------- orbit camera ---------- */
const cam = { target: new THREE.Vector3(), yaw: .6, pitch: .35, dist: 10, min: 1, max: 100 };
function frame() {
  const s = bounds.getBoundingSphere(new THREE.Sphere());
  cam.target.copy(s.center); cam.dist = Math.max(s.radius, .3) / Math.sin(THREE.MathUtils.degToRad(camera.fov) / 2) * 1.05; cam.min = s.radius * .2; cam.max = cam.dist * 8; cam.yaw = .6; cam.pitch = .35;
}
function place() {
  const cp = Math.cos(cam.pitch); camera.position.set(cam.target.x + cam.dist * Math.sin(cam.yaw) * cp, cam.target.y + cam.dist * Math.sin(cam.pitch), cam.target.z + cam.dist * Math.cos(cam.yaw) * cp);
  camera.lookAt(cam.target); camera.near = Math.max(cam.dist / 200, .02); camera.updateProjectionMatrix();
}
const cv = $('world'), ptr = new Map(); let pinch = 0;
const zoom = k => { cam.dist = THREE.MathUtils.clamp(cam.dist * k, cam.min, cam.max); };
const pan = (dx, dy) => {
  camera.updateMatrixWorld(); const k = 2 * cam.dist * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) / innerHeight, e = camera.matrixWorld.elements;
  cam.target.addScaledVector(new THREE.Vector3(e[0], e[1], e[2]), -dx * k).addScaledVector(new THREE.Vector3(e[4], e[5], e[6]), dy * k);
};
cv.addEventListener('contextmenu', e => e.preventDefault());
cv.addEventListener('pointerdown', e => { cv.setPointerCapture(e.pointerId); ptr.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (ptr.size === 2) pinch = dist2(); });
cv.addEventListener('pointerup', e => ptr.delete(e.pointerId)); cv.addEventListener('pointercancel', e => ptr.delete(e.pointerId));
const dist2 = () => { const [a, b] = [...ptr.values()]; return Math.hypot(a.x - b.x, a.y - b.y) || 1; };
cv.addEventListener('pointermove', e => {
  const p = ptr.get(e.pointerId); if (!p) return; const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
  if (ptr.size === 2) { const d = dist2(); zoom(pinch / d); pinch = d; return; }
  if (e.shiftKey || e.buttons & 6) pan(dx, dy); else { cam.yaw -= dx * .008; cam.pitch = THREE.MathUtils.clamp(cam.pitch + dy * .008, -1.5, 1.5); }
});
cv.addEventListener('wheel', e => { e.preventDefault(); zoom(Math.exp(e.deltaY * (e.deltaMode ? .05 : .0012))); }, { passive: false });
addEventListener('keydown', e => {
  if (e.metaKey || e.ctrlKey || e.altKey) return; const k = e.key.toLowerCase(), flip = { e: 'edges', g: 'grid', x: 'box', w: 'wire' }[k];
  if (k === 'arrowright' || k === 'arrowdown') step(1); else if (k === 'arrowleft' || k === 'arrowup') step(-1); else if (k === 'f' || k === 'r') frame();
  else if (k === ' ') { opts.spin = !opts.spin; applyOpts(); e.preventDefault(); } else if (flip) { opts[flip] = !opts[flip]; applyOpts(); }
});

/* ---------- loop ---------- */
function resize() { renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2)); renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();
let last = performance.now(), t = 0;
renderer.setAnimationLoop(now => {
  const dt = Math.min((now - last) / 1000, .1); last = now; t += dt;
  if (opts.spin && !ptr.size) cam.yaw += dt * .6;
  const fl = obj?.userData.flash; if (fl && opts.siren) { const on = Math.floor(t * 6) % 2 === 0; fl[0].visible = on; fl[1].visible = !on; }
  place(); renderer.render(scene, camera);
});

const want = decodeURIComponent(location.hash.slice(1));
select(items.find(i => i.id === want) ?? items[0]);
window.__viewer = { items, select: id => { const it = items.find(i => i.id === id); if (!it) throw new Error('unknown viewer item: ' + id); select(it); }, cam, opts, get obj() { return obj; } };
