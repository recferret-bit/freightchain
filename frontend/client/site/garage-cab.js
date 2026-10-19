import { el } from './dom.js';
import { setLoadout, pose } from '../js/cosmetics.js';

/* The Garage's cab (lobby → GARAGE, docs/spec/ten4.md): the game's OWN cockpit renderer (js/cockpit, no three.js) draws into one hidden canvas and this copies it onto the visible one,
   over a small sky + road backdrop (the windscreen and mirrors are see-through in the game, where the 3D scene shows there). Same pattern as the landing's dash cards (landing/src/dash-live.js):
   the cockpit modules are singletons that read the global st / dn / disp and look up #cockpit / #toast at import time, so they are loaded lazily (first time the tab opens) after both nodes exist.
   `set(pick)` wears a selection at once (setLoadout) – the picked parts are what the engine draws, before they are applied. Hovering a part (or its slot card) plays a looped movement:
   the wheel turns, the lever walks the gears, the dice swing, the needles sweep; the hood gets a gloss glint. Reduced motion keeps a still frame. */

const W = 1280, H = 633, FPS = 30, SETTLE = 1.3;   // the design canvas (u = min(H/100, W/150) = 6.33 px, as in the cockpit)

/* Hit regions in cockpit units (u), x from the cab centre – the shapes cockpit/rig.js draws. 'e' ellipse (x, y, rx, ry), 'r' rect (x, y, w, h). First match wins. */
const REGIONS = [
  { slot: 'dice', k: 'r', x: -40, y: 0, w: 12, h: 15 },
  { slot: 'gearbox', k: 'r', x: 58.5, y: 82, w: 15.5, h: 21 },
  { slot: 'needle', k: 'e', x: -14, y: 76, rx: 12, ry: 12 },
  { slot: 'needle', k: 'e', x: 14, y: 76, rx: 12, ry: 12 },
  { slot: 'wheel', k: 'e', x: 0, y: 106, rx: 30, ry: 19 },
  { slot: 'truck_color', k: 'r', x: -30, y: 47, w: 60, h: 12 },
];
const inside = (r, x, y) => (r.k === 'e' ? ((x - r.x) / r.rx) ** 2 + ((y - r.y) / r.ry) ** 2 <= 1 : x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h);

/* what each slot's loop does to the cockpit state; `t` = seconds of the loop. Everything else rests at the idle values (applyIdle). */
const GEARS = [1, 2, 3, 4, 5, 6, 7, 0, -1];
const LOOPS = {
  wheel: (t, g) => { g.steerTo = Math.sin(t * 2.2) * .6; },
  gearbox: (t, g) => { g.st.gear = GEARS[Math.floor(t / .55) % GEARS.length]; },
  dice: (t, g) => { g.diceTo = Math.sin(t * 4.2) * .45; },
  needle: (t, g) => { g.st.v = 13 + 11 * Math.sin(t * 1.7); g.st.rpm = 1500 + 800 * Math.sin(t * 1.7 + .4); g.st.gear = 4; },
  truck_color: () => {},
};

export function garageCab({ onPickSlot = () => {} } = {}) {
  const canvas = el('canvas', { width: W, height: H, 'aria-label': 'your cab – hover a part to see it move, click to jump to its parts', role: 'img' });
  const note = el('p', { class: 'dim cabnote' }, 'Loading the cab…');
  const root = el('div', { class: 'card gprev', id: 'garage-preview' }, canvas, note);
  const c2 = canvas.getContext('2d');
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let pick = null, eng = null, loading = null, failed = false;
  let hover = null, forced = null, tapped = null, t = 0, settle = 0, last = 0, raf = 0, redraw = true;
  const g = { steerTo: 0, diceTo: 0, st: null };

  const load = () => loading ??= (async () => {
    /* the cockpit modules look these up at import time (the game page has them) */
    for (const [tag, id] of [['canvas', 'cockpit'], ['div', 'toast']]) if (!document.getElementById(id)) document.body.append(Object.assign(document.createElement(tag), { id, hidden: true }));
    const cv = document.getElementById('cockpit'); Object.assign(cv, { width: W, height: H });
    const [{ view, ctx }, { drawCockpit }, state, common] = await Promise.all([import('../js/cockpit/canvas.js'), import('../js/cockpit/index.js'), import('../js/state.js'), import('../js/cockpit/common.js')]);
    Object.assign(view, { W, H, DPR: 1 });
    const { st, dn, weather, disp, updateDisp, rideStart } = state;
    Object.assign(st, rideStart({ rpm: 700, engineOn: true, temp: 88, pull: 1 }), { mode: 'menu', park: false, keyOn: true, batt: .8, bugs: [] });
    Object.assign(dn, { k: 0, night: false, head: false, cab: false, blind: 0, hood: 0, phase: 'day' });
    Object.assign(weather, { ambient: 26, snow: 0, grime: '176,146,104' });
    Object.assign(common.keyAnim, { pos: 1, t: performance.now() });
    g.st = st;
    eng = { cv, ctx, drawCockpit, st, disp, updateDisp };
    for (let i = 0; i < 60; i++) updateDisp(.05);
  })().then(() => { note.textContent = 'Hover a part to see it move · click it to jump to its parts.'; }, e => { failed = true; note.textContent = `The cab preview is unavailable (${e.message}).`; note.className = 'bad cabnote'; });

  const active = () => forced ?? tapped ?? hover;
  const idle = () => { eng.st.gear = 0; eng.st.v = 0; eng.st.rpm = 700; };

  function backdrop() {
    const sky = c2.createLinearGradient(0, 0, 0, H * .56); sky.addColorStop(0, '#5f9fd6'); sky.addColorStop(1, '#dfe9ef'); c2.fillStyle = sky; c2.fillRect(0, 0, W, H);
    c2.fillStyle = '#c9a46a'; c2.fillRect(0, H * .56, W, H); c2.fillStyle = '#a07a45'; c2.fillRect(0, H * .56, W, 4);
    c2.fillStyle = '#4a4a4e'; c2.beginPath(); c2.moveTo(W / 2 - 14, H * .56); c2.lineTo(W / 2 + 14, H * .56); c2.lineTo(W * .88, H); c2.lineTo(W * .12, H); c2.fill();
    c2.strokeStyle = '#e8dca0'; c2.lineWidth = 6; c2.setLineDash([26, 30]); c2.beginPath(); c2.moveTo(W / 2, H * .56); c2.lineTo(W / 2, H); c2.stroke(); c2.setLineDash([]);
  }

  function overlay(slot, tt) {
    const u = Math.min(H / 100, W / 150), cx = W / 2;
    if (slot === 'truck_color') {   // a gloss glint sweeping across the hood + fenders
      const hy = 47 * u, hb = 64 * u;
      c2.save(); c2.beginPath(); c2.rect(0, 0, W, 59 * u); c2.clip();
      c2.beginPath(); c2.moveTo(cx - 12 * u, hy + 2 * u); c2.lineTo(cx - 36 * u, hb); c2.lineTo(cx + 36 * u, hb); c2.lineTo(cx + 12 * u, hy + 2 * u); c2.closePath(); c2.clip();
      const gx = cx + (((tt * .55) % 1.6) - .8) * 90 * u, gr = c2.createLinearGradient(gx - 9 * u, 0, gx + 9 * u, 0);
      gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(.5, 'rgba(255,255,255,.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); c2.fillStyle = gr; c2.fillRect(0, hy - 4 * u, W, 24 * u);
      c2.restore();
    }
    c2.save(); c2.strokeStyle = '#ffcf5a'; c2.lineWidth = 3; c2.globalAlpha = .55 + .35 * Math.sin(tt * 6);   // amber outline of what is hovered
    for (const r of REGIONS) {
      if (r.slot !== slot) continue;
      c2.beginPath();
      if (r.k === 'e') c2.ellipse(cx + r.x * u, r.y * u, r.rx * u, r.ry * u, 0, 0, 7); else c2.roundRect(cx + r.x * u, r.y * u, r.w * u, r.h * u, 8);
      c2.stroke();
    }
    c2.restore();
  }

  function draw(dt) {
    setLoadout(pick);   // what the engine wears is what is picked – before it is applied
    const slot = active(), { st } = eng;
    idle(); g.steerTo = 0; g.diceTo = 0;
    if (slot) { t += dt; LOOPS[slot]?.(t, g); } else t = 0;
    st.steer += (g.steerTo - st.steer) * Math.min(1, dt * 9); pose.dice += (g.diceTo - pose.dice) * Math.min(1, dt * 9);
    st.t += dt; eng.updateDisp(dt);
    eng.drawCockpit();
    c2.clearRect(0, 0, W, H); backdrop(); c2.drawImage(eng.cv, 0, 0);
    if (slot) overlay(slot, t);
  }

  function frame(now) {
    raf = 0;
    if (!root.isConnected || failed) return;   // the view was repainted away / another tab: set() wakes it again
    const slot = active();
    if (slot || redraw || settle > 0) {
      const dt = Math.min((now - last) / 1000, .1);
      if (dt >= 1 / FPS - .002 || redraw) { last = now; draw(still ? 0 : dt); redraw = false; if (slot) settle = SETTLE; else settle = Math.max(0, settle - dt); }
    }
    if (!document.hidden || slot) raf = requestAnimationFrame(frame);
  }
  const wake = () => { if (!raf && eng && root.isConnected) { last = performance.now(); raf = requestAnimationFrame(frame); } };

  /* pointer → the part under it (design coordinates) */
  const at = e => {
    const b = canvas.getBoundingClientRect(), u = Math.min(H / 100, W / 150);
    const x = ((e.clientX - b.left) / b.width * W - W / 2) / u, y = ((e.clientY - b.top) / b.height * H) / u;
    return REGIONS.find(r => inside(r, x, y))?.slot ?? null;
  };
  const setHover = s => { if (s === hover) return; hover = s; canvas.style.cursor = s ? 'pointer' : 'default'; redraw = true; wake(); };
  canvas.addEventListener('pointermove', e => { if (e.pointerType === 'mouse') setHover(at(e)); });
  canvas.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') setHover(null); });
  canvas.addEventListener('pointerdown', e => { if (e.pointerType === 'mouse') return; const s = at(e); tapped = s === tapped ? null : s; redraw = true; wake(); });   // touch: a tap toggles the loop
  canvas.addEventListener('click', e => { const s = at(e); if (s) onPickSlot(s); });

  return {
    el: root,
    /** Wear `p` ({ slot: part }) now and draw it. */
    set(p) {
      pick = { ...p }; redraw = true;
      if (eng) wake(); else load().then(() => { redraw = true; wake(); });
    },
    /** A slot card is hovered / focused: play that slot's loop (null = stop). */
    hoverSlot(slot) { if (slot === forced) return; forced = slot; redraw = true; wake(); },
  };
}
