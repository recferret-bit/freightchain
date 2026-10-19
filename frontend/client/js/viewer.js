import './crash-boot.js';   // before three.js: a throw while the viewer loads is still reported
import * as THREE from 'three';
import { renderer } from './world/scene.js';
import { buildCatalogue } from './catalogue.js';
import { loadEntities, putEntity, reloadEntities } from './world/entities.js';
import { setFormShade } from './world/nightlight.js';   // installs the form-shade patch; this page has no day/night loop, so the sun stays the default and F8 is instant

/* Model viewer (viewer.html): a separate scene with every 3D object of the game except the player's own freighter/trailer –
   traffic vehicles, and per route the scenery props, roadside furniture, landmarks and finish gantry – each an entity (client/shared/entity/),
   built by the SAME code the game uses.
   Orbit / zoom / pan are hand-rolled (no extra imports). Selection lives in location.hash so a view can be linked. */

const $ = id => document.getElementById(id);
const scene = new THREE.Scene(); scene.background = new THREE.Color(0x25282c);
const camera = new THREE.PerspectiveCamera(45, 1, .05, 600);
const grid = new THREE.GridHelper(60, 60, 0x6a7078, 0x3a3f45); grid.position.y = -.002; scene.add(grid);
const stage = new THREE.Group(); scene.add(stage);

/* ---------- catalogue: { group, id, entity, label, make() → Object3D, info() → [[k, v]…] } (js/catalogue.js) ---------- */
await loadEntities();
let items = buildCatalogue();
const f = (n, d = 2) => +n.toFixed(d);

/* ---------- selection ---------- */
let cur = null, obj = null, bounds = new THREE.Box3();
const opts = { edges: true, grid: true, box: false, wire: false, spin: false, brake: false, siren: true, form: true };
let boxHelper = null, edgeLines = [], wireMats = [];
const edgeCache = new Map(), edgeMat = new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: .55 });

function clearStage() {
  for (const m of wireMats) m.wireframe = false; wireMats = [];
  for (const c of [...stage.children]) stage.remove(c); edgeLines = []; boxHelper = null;
}
// headlight/brake/siren glow sprites and ground light-pool planes (world/glow.js) carry a `gain` on their material;
// they reach tens of metres from the body and would otherwise blow up the auto-frame, so they're excluded from the measured size.
const isGlowNode = c => (c.isMesh || c.isSprite) && [].concat(c.material).some(m => m?.userData && 'gain' in m.userData);
function measureBounds(root) {
  const pulled = []; root.traverse(c => { if (isGlowNode(c)) pulled.push({ p: c.parent, c }); });
  for (const { p, c } of pulled) p.remove(c);
  const box = new THREE.Box3().setFromObject(root);
  for (const { p, c } of pulled) p.add(c);
  return box.isEmpty() ? new THREE.Box3().setFromObject(root) : box;
}
const selectHooks = [];
function select(item, keepCam) {
  const made = item.make();   // build first: a draft that will not compile must not wipe the model already on stage
  clearStage(); cur = item; item.obj = obj = made; stage.add(obj);
  bounds = measureBounds(obj);   // measured before the helper lines are added
  obj.traverse(c => { if (!c.isMesh) return; for (const m of [].concat(c.material)) if (!wireMats.includes(m)) wireMats.push(m);
    let g = edgeCache.get(c.geometry); if (!g) edgeCache.set(c.geometry, g = new THREE.EdgesGeometry(c.geometry, 25));
    const l = new THREE.LineSegments(g, edgeMat); c.add(l); edgeLines.push(l); });
  boxHelper = new THREE.Box3Helper(bounds, 0xffcf5a); stage.add(boxHelper);
  const sz = bounds.getSize(new THREE.Vector3());
  const info = $('info'), b = document.createElement('b'), g = document.createElement('div'), t = document.createElement('table'); info.textContent = '';
  b.textContent = item.label; g.textContent = item.group; g.style.color = '#7d8187';
  for (const [k, v] of [['size (x × y × z)', `${f(sz.x)} × ${f(sz.y)} × ${f(sz.z)} m`], ...item.info()]) { const r = t.insertRow(); r.insertCell().textContent = k; r.insertCell().textContent = String(v); }
  info.append(b, g, t);
  for (const cb of selectHooks) cb(item);
  const det = [...document.querySelectorAll('details')].find(d => d.dataset.g === item.group); if (det) det.open = true;
  document.querySelectorAll('.item').forEach(e => e.classList.toggle('on', e.dataset.id === item.id));
  const on = document.querySelector('.item.on'); on?.scrollIntoView({ block: 'nearest' });
  try { history.replaceState(null, '', '#' + encodeURIComponent(item.id)); } catch { /* sandboxed frame */ }
  applyOpts(); if (!keepCam) frame();
}
function applyOpts() {
  for (const l of edgeLines) l.visible = opts.edges; if (boxHelper) boxHelper.visible = opts.box; grid.visible = opts.grid;
  for (const m of wireMats) m.wireframe = opts.wire;
  const u = obj?.userData ?? {}; if (u.brake) u.brake.visible = opts.brake; if (u.flash && !opts.siren) u.flash.forEach(g => g.visible = false);
  const rows = [['edges', 'E  edges'], ['grid', 'G  grid (1 m)'], ['box', 'X  bounding box'], ['wire', 'V  wireframe'], ['spin', 'Space  auto-rotate'], ['form', 'F8  form shade'], ['brake', 'brake lights', !u.brake], ['siren', 'siren flash', !u.flash]];
  if (!$('opts').children.length) $('opts').innerHTML = rows.map(([k, t]) => `<label data-k="${k}"><input type="checkbox" data-k="${k}"> ${t}</label>`).join('');
  for (const [k, , off] of rows) { const l = $('opts').querySelector(`label[data-k=${k}]`); l.classList.toggle('off', !!off); l.firstChild.checked = opts[k]; }
}
$('opts').addEventListener('change', e => { opts[e.target.dataset.k] = e.target.checked; if (e.target.dataset.k === 'form') setFormShade(opts.form); applyOpts(); });

/* sidebar (labels and ids come from entities, which an editor can write: built with textContent, never markup) */
function renderList() {
  const list = $('list'), open = new Set([...list.querySelectorAll('details[open]')].map(d => d.dataset.g)); list.textContent = '';
  let det = null;
  for (const it of items) {
    if (det?.dataset.g !== it.group) { det = document.createElement('details'); det.dataset.g = it.group; det.open = open.size ? open.has(it.group) : it.group === 'Vehicles'; const s = document.createElement('summary'); s.textContent = it.group; det.append(s); list.append(det); }
    const d = document.createElement('div'); d.className = 'item'; d.dataset.id = it.id; d.textContent = it.label; det.append(d);
  }
}
renderList();
$('list').addEventListener('click', e => { const it = items.find(i => i.id === e.target.dataset?.id); if (it) select(it); });
const step = d => select(items[(items.indexOf(cur) + d + items.length) % items.length]);

/* ---------- orbit camera ---------- */
const cam = { target: new THREE.Vector3(), yaw: .6, pitch: .35, dist: 10, min: 1, max: 100 };
function frame() {
  const s = bounds.getBoundingSphere(new THREE.Sphere());
  cam.target.copy(s.center); cam.dist = Math.max(s.radius, .3) / Math.sin(THREE.MathUtils.degToRad(camera.fov) / 2) * 1.4; cam.min = s.radius * .2; cam.max = cam.dist * 8; cam.yaw = .6; cam.pitch = .35;
}
function place() {
  const cp = Math.cos(cam.pitch); camera.position.set(cam.target.x + cam.dist * Math.sin(cam.yaw) * cp, cam.target.y + cam.dist * Math.sin(cam.pitch), cam.target.z + cam.dist * Math.cos(cam.yaw) * cp);
  camera.lookAt(cam.target); camera.near = Math.max(cam.dist / 200, .02); camera.updateProjectionMatrix();
}
const cv = $('world'), ptr = new Map(); let pinch = 0;
const zoom = k => { cam.dist = THREE.MathUtils.clamp(cam.dist * k, cam.min, cam.max); };
// shared camera-relative axes (right / up / forward), read off the live view matrix – used by both mouse-pan and WASD strafe
const _right = new THREE.Vector3(), _up = new THREE.Vector3(), _fwd = new THREE.Vector3();
function basis() {
  camera.updateMatrixWorld(); const el = camera.matrixWorld.elements;
  _right.set(el[0], el[1], el[2]); _up.set(el[4], el[5], el[6]); _fwd.set(-el[8], -el[9], -el[10]);
}
const pan = (dx, dy) => {
  basis(); const k = 2 * cam.dist * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) / innerHeight;
  cam.target.addScaledVector(_right, -dx * k).addScaledVector(_up, dy * k);
};
cv.addEventListener('contextmenu', e => e.preventDefault());
cv.addEventListener('pointerdown', e => { cv.setPointerCapture(e.pointerId); ptr.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (ptr.size === 2) pinch = dist2(); });
cv.addEventListener('pointerup', e => ptr.delete(e.pointerId)); cv.addEventListener('pointercancel', e => ptr.delete(e.pointerId));
const dist2 = () => { const [a, b] = [...ptr.values()]; return Math.hypot(a.x - b.x, a.y - b.y) || 1; };
cv.addEventListener('pointermove', e => {
  const p = ptr.get(e.pointerId); if (!p) return; const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
  if (ptr.size === 2) { const d = dist2(); zoom(pinch / d); pinch = d; return; }
  const orbiting = e.pointerType !== 'mouse' || (e.buttons & 2);   // right mouse button, or a single touch/pen
  if (orbiting) { cam.yaw -= dx * .008; cam.pitch = THREE.MathUtils.clamp(cam.pitch + dy * .008, -1.5, 1.5); } else pan(dx, dy);
});
cv.addEventListener('wheel', e => { e.preventDefault(); zoom(Math.exp(e.deltaY * (e.deltaMode ? .05 : .0012))); }, { passive: false });
const keys = new Set();
addEventListener('keydown', e => {
  if (e.target.closest?.('input, textarea, select, [contenteditable]')) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return; const k = e.key.toLowerCase();
  if ('wasd'.includes(k)) { keys.add(k); return; }
  const flip = { e: 'edges', g: 'grid', x: 'box', v: 'wire' }[k];
  if (k === 'arrowright' || k === 'arrowdown') step(1); else if (k === 'arrowleft' || k === 'arrowup') step(-1); else if (k === 'f' || k === 'r') frame();
  else if (k === ' ') { opts.spin = !opts.spin; applyOpts(); e.preventDefault(); } else if (k === 'f8') { opts.form = !opts.form; setFormShade(opts.form); applyOpts(); }
  else if (flip) { opts[flip] = !opts[flip]; applyOpts(); }
});
addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));
addEventListener('blur', () => keys.clear());
document.addEventListener('visibilitychange', () => { if (document.hidden) keys.clear(); });
function strafe(dt) {
  if (!keys.size) return;
  basis(); const spd = cam.dist * 1.1 * dt;
  if (keys.has('w')) cam.target.addScaledVector(_fwd, spd); if (keys.has('s')) cam.target.addScaledVector(_fwd, -spd);
  if (keys.has('a')) cam.target.addScaledVector(_right, -spd); if (keys.has('d')) cam.target.addScaledVector(_right, spd);
}

/* ---------- loop ---------- */
function resize() { renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2)); renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();
let last = performance.now(), t = 0;
renderer.setAnimationLoop(now => {
  const dt = Math.min((now - last) / 1000, .1); last = now; t += dt;
  if (opts.spin && !ptr.size) cam.yaw += dt * .6;
  strafe(dt);
  const fl = obj?.userData.flash; if (fl && opts.siren) { const on = Math.floor(t * 6) % 2 === 0; fl[0].visible = on; fl[1].visible = !on; }
  place(); renderer.render(scene, camera);
});

const want = decodeURIComponent(location.hash.slice(1));
select(items.find(i => i.id === want) ?? items[0]);
/* the editor (js/editor/) drives the viewer through these: preview a config in place, reload the catalogue after a new entity or a publish */
window.__viewer = {
  get items() { return items; }, cam, opts, get obj() { return obj; }, get current() { return cur; },
  select: id => { const it = items.find(i => i.id === id); if (!it) throw new Error('unknown viewer item: ' + id); select(it); },
  onSelect: cb => selectHooks.push(cb),
  /* show `config` for its entity now (the registry keeps it until the next preview / reload); selects an item of that entity if the current one is another */
  preview(config) {
    putEntity(config);
    if (!items.some(i => i.entity === config.id)) { items = buildCatalogue(); renderList(); }
    select(cur?.entity === config.id ? cur : items.find(i => i.entity === config.id), true);
  },
  /* back to the published models (after a publish, or to drop a preview) */
  async reload() { await reloadEntities(); const id = cur?.id; items = buildCatalogue(); renderList(); select(items.find(i => i.id === id) ?? items[0], true); },
};
if (new URLSearchParams(location.search).get('editor') !== 'off') import('./editor/index.js').then(m => m.mountEditor(window.__viewer)).catch(e => console.error('[editor]', e));
