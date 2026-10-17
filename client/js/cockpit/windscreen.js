import { ctx, view } from './canvas.js';
import { st, weather } from '../state.js';
import { toast } from '../ui/toast.js';
import { audio } from '../sim/audio.js';
import { ObjectPool } from '../object-pool.js';
import { GW, GH, resetGlass, frostStep, fogStep, drawGlassClimate, screenClimate } from './glass-climate.js';
import { drawGlassFX, resetGlassFX, drawSnow, drawBug, bugXY, inSector, drawExhaust } from './glass-fx.js';

export { screenClimate, drawBug, drawExhaust };

/* Windscreen orchestrator: grime canvas, washer water jets/drops, and dual wiper sweep + blade rendering. */

const grime = document.createElement('canvas'); grime.width = GW; grime.height = GH;
const gctx = grime.getContext('2d');
export const wip = { mode: 0, phase: 0, burst: 0, wet: 0, phi: 0, acc: 0, last: performance.now() };
export const drops = [], spray = [];
export const dropPool = new ObjectPool('drop2d', () => ({ x: 0, y: 0, r: 1, age: 0, run: false }), d => { d.run = false; });
export const sprayPool = new ObjectPool('spray2d', () => ({ x: 0, y: 0, vx: 0, vy: 0, life: 0 }), () => {});
const PHI_MAX = 1.75;

function speck() { gctx.fillStyle = `rgba(${weather.grime},${.07 + Math.random() * .14})`; gctx.beginPath(); gctx.arc(Math.random() * GW, Math.random() * GH, 1 + Math.random() * 3.5, 0, 7); gctx.fill(); }
function snowSpeck() { gctx.fillStyle = `rgba(244,248,255,${.3 + Math.random() * .3})`; gctx.beginPath(); gctx.arc(Math.random() * GW, Math.random() * GH, 1.2 + Math.random() * 3.2, 0, 7); gctx.fill(); }

export function resetScreen() {
  gctx.clearRect(0, 0, GW, GH); for (let i = 0; i < 250; i++) speck();
  Object.assign(wip, { mode: 0, phase: 0, burst: 0, wet: 0, phi: 0, acc: 0, snowAcc: 0 });
  while (drops.length) dropPool.release(drops.pop());
  while (spray.length) sprayPool.release(spray.pop());
  resetGlass(); resetGlassFX();
}

// washer fluid soaks the WHOLE screen: every wipe pass while it's wet clears a big share of the dust, bugs and water over the entire glass (not just the blade arcs)
function washAll() {
  gctx.save(); gctx.globalCompositeOperation = 'destination-out'; gctx.fillStyle = 'rgba(0,0,0,.45)'; gctx.fillRect(0, 0, GW, GH); gctx.restore();
  for (let i = st.bugs.length - 1; i >= 0; i--) if (Math.random() < .5) st.bugs.splice(i, 1);
  for (const d of drops) d.run = true;   // the water runs off down the glass
}

export function cycleWipers() {
  wip.mode = (wip.mode + 1) % 3;
  audio.play(wip.mode ? 'wiper' : 'switch-off', wip.mode === 2 ? 1 : .8, wip.mode === 2 ? 1.25 : 1);
  toast('Wipers: ' + ['off', 'slow', 'fast'][wip.mode], 900);
}

function drawWiperBlades(pivots, py, L, u) {
  ctx.lineCap = 'round';
  for (const px of pivots) {
    const ex = px + Math.cos(wip.phi) * L, ey = py - Math.sin(wip.phi) * L, bx = px + Math.cos(wip.phi) * L * .3, by = py - Math.sin(wip.phi) * L * .3;
    ctx.strokeStyle = '#141414'; ctx.lineWidth = .7 * u; ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(ex, ey); ctx.stroke();
    ctx.strokeStyle = '#050505'; ctx.lineWidth = 1.2 * u; ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(ex, ey); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,.14)'; ctx.lineWidth = .2 * u; ctx.beginPath(); ctx.moveTo(bx, by - .3 * u); ctx.lineTo(ex, ey - .3 * u); ctx.stroke();
    ctx.fillStyle = '#2a2a2a'; ctx.beginPath(); ctx.arc(px, py, 1.1 * u, 0, 7); ctx.fill();
  }
}

export function drawScreenLayers(u, cx, hy, py) {
  const { W, H } = view;
  const now = performance.now(), dt = Math.min(.05, (now - wip.last) / 1000); wip.last = now;
  const live = st.mode === 'drive', gh = H * .65, L = 40 * u, pivots = [cx - 30 * u, cx + 6 * u], nozzles = [cx - 24 * u, cx + 16 * u];
  if (live) {
    wip.acc += st.v * 2 * dt; while (wip.acc >= 1) { wip.acc--; speck(); }
    if (weather.snow > 0) { wip.snowAcc = (wip.snowAcc || 0) + weather.snow * (1.2 + st.v * .35) * dt; while (wip.snowAcc >= 1) { wip.snowAcc--; snowSpeck(); } }
    frostStep(dt); fogStep(dt);
    wip.wet = Math.max(0, wip.wet - dt * .12);
    if (st.washing) {
      wip.wet = Math.min(1, wip.wet + dt * 4); wip.burst = 2.2;
      for (let i = 0; i < 2; i++) { drops.push(Object.assign(dropPool.acquire(), { x: W * (.12 + Math.random() * .76), y: H * .07 + Math.random() * (py - H * .07), r: (.25 + Math.random() * .5) * u, age: 0, run: false })); if (drops.length > 320) dropPool.release(drops.shift()); }
      for (const nx of nozzles) for (let i = 0; i < 3; i++) spray.push(Object.assign(sprayPool.acquire(), { x: nx, y: py, vx: (Math.random() - .5) * 16 * u, vy: -(38 + Math.random() * 28) * u, life: 0 }));
    } else wip.burst = Math.max(0, wip.burst - dt);
    for (let i = spray.length - 1; i >= 0; i--) {
      const q = spray[i]; q.vy += 60 * u * dt; q.x += q.vx * dt; q.y += q.vy * dt; q.life += dt;
      if (q.vy > -4 * u || q.life > .7) { if (Math.random() < .5) { drops.push(Object.assign(dropPool.acquire(), { x: q.x, y: q.y, r: (.25 + Math.random() * .5) * u, age: 0, run: false })); if (drops.length > 220) dropPool.release(drops.shift()); } sprayPool.release(q); spray.splice(i, 1); }
    }
    for (let i = drops.length - 1; i >= 0; i--) { const d = drops[i]; d.age += dt; if (d.r > .55 * u) d.y += d.r * 2.2 * dt; if (d.run) d.y += 9 * u * dt; if (d.age > 14 || d.y > py + 2 * u) { dropPool.release(d); drops.splice(i, 1); } }
    const active = wip.mode > 0 || wip.burst > 0, pp = wip.phase;
    if (active || wip.phase > 0) { wip.phase += dt / ((wip.mode === 2 || wip.burst > 0) ? 1.1 : 2.2); if (wip.phase >= 1) wip.phase = active ? wip.phase - 1 : 0; }
    if (pp < .5 && wip.phase >= .5 && wip.wet > .3) washAll();
    const phi = PHI_MAX * (.5 - .5 * Math.cos(Math.PI * 2 * wip.phase)), prev = wip.phi;
    if (Math.abs(phi - prev) > 1e-4) {
      const a = .25 + .75 * Math.min(1, wip.wet * 1.5);
      gctx.save(); gctx.globalCompositeOperation = 'destination-out'; gctx.fillStyle = gctx.strokeStyle = `rgba(0,0,0,${a})`; gctx.lineWidth = 2;
      for (const px of pivots) {
        const pts = [[px, py], [px + Math.cos(prev) * L, py - Math.sin(prev) * L], [px + Math.cos(phi) * L, py - Math.sin(phi) * L]].map(([x, y]) => [x * GW / W, y * GH / gh]);
        gctx.beginPath(); pts.forEach(([x, y], i) => gctx[i ? 'lineTo' : 'moveTo'](x, y)); gctx.closePath(); gctx.fill(); gctx.stroke();
        for (let i = drops.length - 1; i >= 0; i--) if (inSector(px, py, L, prev, phi, drops[i].x, drops[i].y)) { dropPool.release(drops[i]); drops.splice(i, 1); }
        for (let i = st.bugs.length - 1; i >= 0; i--) { const b = st.bugs[i], [bx, by] = bugXY(b); if (inSector(px, py, L, prev, phi, bx, by)) { b.sm = (b.sm || 0) + (wip.wet > .3 ? 1 : .5); if (b.sm >= 1) st.bugs.splice(i, 1); } }
      }
      gctx.restore();
    }
    wip.phi = phi;
  }
  if (weather.snow > 0 && st.mode !== 'paused') drawSnow(dt, u);
  ctx.drawImage(grime, 0, 0, GW, GH, 0, 0, W, gh);
  for (const d of drops) {
    const a = Math.max(0, 1 - d.age / 14);
    ctx.fillStyle = `rgba(190,220,245,${.28 * a})`; ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, 7); ctx.fill();
    ctx.strokeStyle = `rgba(255,255,255,${.5 * a})`; ctx.lineWidth = .15 * u; ctx.stroke();
    ctx.fillStyle = `rgba(255,255,255,${.6 * a})`; ctx.beginPath(); ctx.arc(d.x - d.r * .3, d.y - d.r * .3, d.r * .3, 0, 7); ctx.fill();
  }
  ctx.fillStyle = 'rgba(205,232,255,.7)'; for (const q of spray) { ctx.beginPath(); ctx.arc(q.x, q.y, .35 * u, 0, 7); ctx.fill(); }
  drawGlassClimate(dt, W, gh);
  drawGlassFX(u, cx, hy);
  drawWiperBlades(pivots, py, L, u);
}
