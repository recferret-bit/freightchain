import { st } from '../state.js';
import { CFG } from '../config.js';
import { phone } from '../phone.js';
import { audio } from '../sim/audio.js';
import { clamp } from '../util.js';
import { recordPhone } from '../telemetry.js';
import { ZOOMS, THUMB, view, truck, resetMapView } from './map/state.js';
import { PHONE_POWER, fastForwardHomeLaunch, resetPhonePower } from './map/power-fsm.js';
import { drawMap, drawPhone } from './map/handheld.js';

/* Phone map orchestrator: mounts the handheld phone dialog, handles pointer/wheel/keyboard input, and drives the animation loop. */

const { FREE_MAX } = CFG.PHONE;

let warned = false;
function loop() {
  view.raf = 0; if (!phone.open) return;
  if (st.mode !== 'drive' && !st.watch) { closeMap(); return; }
  try { drawPhone(); } catch (e) { if (!warned) { warned = true; console.warn('map:', e); } }
  view.raf = requestAnimationFrame(loop);
}

function build() {
  const mk = (tag, cls, parent) => { const e = document.createElement(tag); e.className = cls; parent?.appendChild(e); return e; };
  const el = mk('div', 'phone'), body = mk('div', 'phone-body', el); el.id = 'phone'; mk('div', 'phone-notch', body);
  el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Navigation map'); el.inert = true;
  view.el = el; view.cv = mk('canvas', 'phone-screen', body);
  view.cv.setAttribute('role', 'img'); view.cv.setAttribute('aria-label', 'Map of the road ahead: the truck, the route to the finish, forks and junctions');
  const close = mk('button', 'phone-close', body); close.type = 'button'; close.textContent = 'Close map (Esc)'; close.addEventListener('click', () => toggleMap(false));
  document.body.appendChild(el);
  const press = e => {
    const x = e.offsetX / view.k, y = e.offsetY / view.k, h = view.hits.find(b => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h);
    if (h) {
      if (h.id.startsWith('app:')) {
        recordPhone(h.id, 1, e.timeStamp); view.bounce = { id: h.id.slice(4), at: performance.now() };
        if (h.id === 'app:maps') fastForwardHomeLaunch();
        audio.play('switch', .4); return;
      }
      recordPhone(h.id === 'north' ? (view.northUp ? 'heading-up' : 'north-up') : h.id === 'in' ? 'zoom-in' : h.id === 'out' ? 'zoom-out' : h.id === 'home' ? 'recenter' : 'exit', 1, e.timeStamp);
      if (h.id === 'exit') toggleMap(false);
      else if (h.id === 'north') view.northUp = !view.northUp;
      else if (h.id === 'in') view.z = Math.max(0, view.z - 1);
      else if (h.id === 'out') view.z = Math.min(ZOOMS.length - 1, view.z + 1);
      else if (h.id === 'home') view.free = null;
      audio.play('switch', .5); return;
    }
    if (phone.power !== PHONE_POWER.ON) return;
    view.drag = { x: e.offsetX, y: e.offsetY, x0: e.offsetX, y0: e.offsetY, moved: false, id: e.pointerId }; view.cv.setPointerCapture?.(e.pointerId);
  };
  el.addEventListener('pointerdown', e => {
    e.stopPropagation();
    if (e.target === view.cv) press(e);
  });
  el.addEventListener('pointermove', e => {
    const d = view.drag; if (!d || e.pointerId !== d.id) return;
    if (!d.moved && Math.hypot(e.offsetX - d.x0, e.offsetY - d.y0) < 6) return;
    if (!d.moved) { d.moved = true; recordPhone('pan', 1, e.timeStamp); if (!view.free) { const T = truck(); view.free = { x: T.x, z: T.z }; } }
    const mpp = ZOOMS[view.z], rot = view.northUp ? 0 : view.rot ?? 0, dx = (e.offsetX - d.x) * mpp, dy = (e.offsetY - d.y) * mpp; d.x = e.offsetX; d.y = e.offsetY;
    const T = truck(), f = view.free;
    f.x -= dx * Math.cos(rot) - dy * Math.sin(rot); f.z -= dx * Math.sin(rot) + dy * Math.cos(rot);
    const o = Math.hypot(f.x - T.x, f.z - T.z); if (o > FREE_MAX) { f.x = T.x + (f.x - T.x) * FREE_MAX / o; f.z = T.z + (f.z - T.z) * FREE_MAX / o; }
    view.touched = performance.now();
  });
  const release = e => {
    const d = view.drag; if (!d || e.pointerId !== d.id) return; view.drag = null; view.touched = performance.now();
    if (d.moved) recordPhone('pan', 0, e.timeStamp);
    if (d.moved || e.type === 'pointercancel') return;
    const hit = view.pois.find(q => Math.hypot(q.x - e.offsetX, q.y - e.offsetY) <= q.r + 6);
    view.sel = hit && view.sel !== hit.id ? hit.id : null; if (hit) audio.play('switch', .4);
    recordPhone(hit ? (view.sel === null ? 'place-off' : 'place:' + hit.q.type) : 'tap', 1, e.timeStamp);
  };
  el.addEventListener('pointerup', release); el.addEventListener('pointercancel', release);
  el.addEventListener('wheel', e => {
    e.preventDefault();
    const d = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1);
    if (Math.sign(d) !== Math.sign(view.wheel)) view.wheel = 0;
    view.wheel += d; if (Math.abs(view.wheel) < 60) return;
    recordPhone(view.wheel < 0 ? 'wheel-in' : 'wheel-out', 1, e.timeStamp); view.z = clamp(view.z + Math.sign(view.wheel), 0, ZOOMS.length - 1); view.wheel = 0; view.touched = performance.now();
  }, { passive: false });
}

function show(open) {
  phone.open = open; view.el.classList.toggle('on', open); view.el.inert = !open;
  if (!open && view.el.contains(document.activeElement)) document.activeElement.blur();
}

/** open / close the phone map (the dash phone, N, its EXIT, Escape) */
export function toggleMap(open = !phone.open) {
  if (typeof document === 'undefined') return;
  if (!view.el) build();
  if (open !== phone.open) recordPhone(open ? 'open' : 'close');
  show(open); audio.play(open ? 'switch' : 'switch-off', .6);
  if (open && !view.raf) view.raf = requestAnimationFrame(loop);
}

function closeMap() { if (view.el && phone.open) show(false); phone.open = false; }

/** a new ride (ui/game.js resetRide): the phone back on its mount, quietly, and the map's view state from scratch */
export function resetMap() {
  closeMap();
  resetPhonePower();
  resetMapView();
}

if (typeof addEventListener === 'function') addEventListener('keydown', e => { if (e.code === 'Escape' && phone.open) toggleMap(false); });
phone.thumb = (g, x, y, w, h) => drawMap(g, x, y, w, h, THUMB);
