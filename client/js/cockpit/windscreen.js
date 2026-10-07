import { ctx, view } from './canvas.js';
import { st, dn, weather } from '../state.js';
import { CFG } from '../config.js';
import { ambientC } from '../sim/climate.js';
import { toast } from '../ui/toast.js';
import { clamp, rnd } from '../util.js';

/* Windscreen layer: cracks + hood smoke, dust (grime canvas), washer water, wipers, and exhaust-stack smoke. */

const smoke = []; let smokeT = 0, fxLast = performance.now();
function drawGlassFX(u, cx, hy) {
  const { W, H } = view;
  const now = performance.now(), dt = Math.min(.05, (now - fxLast) / 1000); fxLast = now;
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(235,240,245,1)'; ctx.lineWidth = .1 * u;   // scratches: faint hairlines that catch the light
  for (const k of st.scratches) { ctx.globalAlpha = k.a; ctx.beginPath(); k.pts.forEach(([x, y], i) => ctx[i ? 'lineTo' : 'moveTo'](W * k.x + x * u, H * k.y + y * u)); ctx.stroke(); }
  ctx.globalAlpha = 1;
  for (const c of st.cracks) {   // dark shadow under a bright edge, thicker for harder hits
    const sev = c.sev ?? .5;
    for (const [col, lw, dx] of [['rgba(20,25,30,.35)', .3 + .2 * sev, .12], ['rgba(240,245,250,.75)', .15 + .15 * sev, 0]]) {
      ctx.strokeStyle = col; ctx.lineWidth = lw * u;
      for (const seg of c.segs) { ctx.beginPath(); seg.forEach(([x, y], i) => ctx[i ? 'lineTo' : 'moveTo'](W * c.x + (x + dx) * u, H * c.y + (y + dx) * u)); ctx.stroke(); }
    }
    ctx.fillStyle = 'rgba(255,255,255,.25)'; ctx.beginPath(); ctx.arc(W * c.x, H * c.y, (.4 + .5 * sev) * u, 0, 7); ctx.fill();   // impact point
  }
  if (st.hull < 35 && st.mode === 'drive') {   // smoke from under the hood, thicker and darker as the hull fails
    smokeT += dt * (35 - st.hull) / 35 * 25;
    while (smokeT >= 1) { smokeT--; smoke.push({ x: cx + (Math.random() - .5) * 10 * u, y: hy + 6 * u, vx: (Math.random() - .5) * 3 * u, vy: -(6 + Math.random() * 6) * u, life: 0, max: 1.5 + Math.random(), r: (2 + Math.random() * 2) * u, dark: st.hull < 18 }); }
  }
  for (let i = smoke.length - 1; i >= 0; i--) {
    const q = smoke[i]; q.life += dt; if (q.life > q.max) { smoke.splice(i, 1); continue; }
    q.x += q.vx * dt; q.y += q.vy * dt; q.r += 4 * u * dt;
    ctx.fillStyle = q.dark ? `rgba(25,25,25,${(1 - q.life / q.max) * .55})` : `rgba(225,225,225,${(1 - q.life / q.max) * .45})`; ctx.beginPath(); ctx.arc(q.x, q.y, q.r, 0, 7); ctx.fill();
  }
}

/* ───────────────────────── windscreen: grime, washer water, wipers ───────────────────────── */
const GW = 512, GH = 256, grime = document.createElement('canvas'); grime.width = GW; grime.height = GH;
const gctx = grime.getContext('2d');
export const wip = { mode: 0, phase: 0, burst: 0, wet: 0, phi: 0, acc: 0, last: performance.now() };
const drops = [], spray = [], PHI_MAX = 1.75;
function speck() { gctx.fillStyle = `rgba(${weather.grime},${.07 + Math.random() * .14})`; gctx.beginPath(); gctx.arc(Math.random() * GW, Math.random() * GH, 1 + Math.random() * 3.5, 0, 7); gctx.fill(); }
function snowSpeck() { gctx.fillStyle = `rgba(244,248,255,${.3 + Math.random() * .3})`; gctx.beginPath(); gctx.arc(Math.random() * GW, Math.random() * GH, 1.2 + Math.random() * 3.2, 0, 7); gctx.fill(); }
export function resetScreen() { gctx.clearRect(0, 0, GW, GH); for (let i = 0; i < 250; i++) speck(); Object.assign(wip, { mode: 0, phase: 0, burst: 0, wet: 0, phi: 0, acc: 0, snowAcc: 0 }); drops.length = 0; spray.length = 0; resetFrost(); flakes.length = 0; }

/* ───────────────────────── cold: frost on the glass + falling snow ─────────────────────────
   Frost is a coarse grid (FW×FH cells over the glass) of thickness 0..1. It grows from the edges when the air is below freezing (faster in snow and with speed: wind chill)
   and is melted by the cab heater from the defrost vents (bottom centre) outwards, at a strength that depends on the engine temperature (st.heatEff). Wipers do not touch it.
   It is rendered through an offscreen canvas: blobs = the thickness mask, filled with a crystal texture (and darkened at night so it doesn't glow on a dark world). */
const FW = 48, FH = 24, frost = new Float32Array(FW * FH), fjit = Float32Array.from(frost, (_, i) => .8 + .4 * rnd(i * 1.7));
const fcv = document.createElement('canvas'); fcv.width = GW; fcv.height = GH; const fctx = fcv.getContext('2d');
const blob = document.createElement('canvas'); blob.width = blob.height = 32; { const b = blob.getContext('2d'), g = b.createRadialGradient(16, 16, 0, 16, 16, 16); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(.55, 'rgba(255,255,255,.7)'); g.addColorStop(1, 'rgba(255,255,255,0)'); b.fillStyle = g; b.fillRect(0, 0, 32, 32); }
const ftex = document.createElement('canvas'); ftex.width = GW; ftex.height = GH;
{ const t = ftex.getContext('2d'); t.fillStyle = 'rgba(214,230,244,.82)'; t.fillRect(0, 0, GW, GH);
  for (let i = 0; i < 1400; i++) { t.fillStyle = `rgba(255,255,255,${.08 + Math.random() * .22})`; t.beginPath(); t.arc(Math.random() * GW, Math.random() * GH, .6 + Math.random() * 2.4, 0, 7); t.fill(); }
  t.lineCap = 'round'; t.strokeStyle = 'rgba(255,255,255,.75)';
  const fern = (x, y, a, len, w) => { if (len < 3) return; const x2 = x + Math.cos(a) * len, y2 = y + Math.sin(a) * len; t.lineWidth = w; t.beginPath(); t.moveTo(x, y); t.lineTo(x2, y2); t.stroke(); for (const k of [-1, 1]) fern(x + Math.cos(a) * len * .55, y + Math.sin(a) * len * .55, a + k * (.7 + Math.random() * .3), len * .45, w * .7); fern(x2, y2, a + (Math.random() - .5) * .4, len * .6, w * .8); };
  for (let i = 0; i < 70; i++) fern(Math.random() * GW, Math.random() * GH, Math.random() * 6.3, 14 + Math.random() * 22, 1.1); }
let fAcc = 0, frostSum = 0;
const edgeOf = (x, y) => Math.pow(Math.max(Math.abs((x + .5) / FW * 2 - 1), Math.abs((y + .5) / FH * 2 - 1)), 2);
function frostDrive() { const chill = ambientC() - st.v * .12; return chill > -1 ? 0 : Math.min(1.3, (-chill - 1) / 22) * (1 + weather.snow * .4); }   // 0 above freezing .. ~1 at -25 °C
function resetFrost() { const d = frostDrive(); for (let y = 0; y < FH; y++) for (let x = 0; x < FW; x++) frost[y * FW + x] = Math.min(1, d * .6 * (.25 + .75 * edgeOf(x, y)) * fjit[y * FW + x]); frostSum = frost.reduce((a, b) => a + b, 0); fAcc = 1; }
function frostStep(dt) {
  const drive = frostDrive(), amb = ambientC(), thaw = amb > 1 ? .05 * Math.min(1, amb / 10) : 0, he = st.heatEff * CFG.FROST_MELT; let sum = 0;
  for (let y = 0; y < FH; y++) for (let x = 0; x < FW; x++) {
    const i = y * FW + x, vent = Math.max(0, 1 - Math.hypot(((x + .5) / FW * 2 - 1) * .9, (1 - (y + .5) / FH) * 1.1) / 1.8);
    const v = frost[i] + (CFG.FROST_RATE * drive * (.3 + .7 * edgeOf(x, y)) * fjit[i] - he * (.45 + .55 * vent) - thaw) * dt;
    sum += frost[i] = v < 0 ? 0 : v > 1 ? 1 : v;
  }
  frostSum = sum;
}
function frostCompose() {
  fctx.globalCompositeOperation = 'source-over'; fctx.clearRect(0, 0, GW, GH);
  const cw = GW / FW, ch = GH / FH;
  for (let y = 0; y < FH; y++) for (let x = 0; x < FW; x++) { const v = frost[y * FW + x]; if (v < .06) continue; fctx.globalAlpha = Math.min(1, (v - .04) * 1.7); fctx.drawImage(blob, (x + .5) * cw - cw * 1.8, (y + .5) * ch - ch * 1.8, cw * 3.6, ch * 3.6); }
  fctx.globalAlpha = 1; fctx.globalCompositeOperation = 'source-in'; fctx.drawImage(ftex, 0, 0);
  if (dn.k > .02) { fctx.globalCompositeOperation = 'source-atop'; fctx.fillStyle = `rgba(6,10,20,${.78 * dn.k})`; fctx.fillRect(0, 0, GW, GH); }
  fctx.globalCompositeOperation = 'source-over';
}
/* snowflakes: points in camera space (x right, y up, z ahead, metres) streaking out of the vanishing point; the truck's speed sets the streak length */
const flakes = [];
function flakeAt(f, far) { f.x = (Math.random() - .5) * 28; f.y = (Math.random() - .35) * 8; f.z = far ? 28 + Math.random() * 20 : .8 + Math.random() * 46; f.ph = Math.random() * 6.3; f.fall = .7 + Math.random() * .9; return f; }
function drawSnow(dt, u) {
  const { W, H } = view, want = Math.round(CFG.SNOW_FLAKES * weather.snow), f = H * .87, vx = W / 2, vy = H * .36, dim = 1 - .45 * dn.k;
  while (flakes.length < want) flakes.push(flakeAt({}, false));
  if (flakes.length > want) flakes.length = want;
  ctx.lineCap = 'round';
  for (const q of flakes) {
    q.ph += dt * 1.3; q.z -= st.v * dt; q.y -= q.fall * dt; q.x += Math.sin(q.ph) * .5 * dt - .35 * dt;
    if (q.z < .8 || q.y < -3.6) { flakeAt(q, true); continue; }
    const sx = vx + f * q.x / q.z, sy = vy - f * q.y / q.z; if (sx < -20 || sx > W + 20 || sy > H * .7) continue;
    const r = Math.min(4.5 * u / 3, Math.max(.45, f * .02 / q.z)), a = Math.max(.12, Math.min(.9, 1.05 - q.z / 50)) * dim, z2 = q.z + st.v * .045;
    ctx.fillStyle = ctx.strokeStyle = `rgba(250,252,255,${a})`;
    if (st.v > 3) { ctx.lineWidth = r * 1.7; ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(vx + f * q.x / z2, vy - f * q.y / z2); ctx.stroke(); }
    else { ctx.beginPath(); ctx.arc(sx, sy, r, 0, 7); ctx.fill(); }
  }
}
// washer fluid soaks the WHOLE screen: every wipe pass while it's wet clears a big share of the dust, bugs and water over the entire glass (not just the blade arcs)
function washAll() {
  gctx.save(); gctx.globalCompositeOperation = 'destination-out'; gctx.fillStyle = 'rgba(0,0,0,.45)'; gctx.fillRect(0, 0, GW, GH); gctx.restore();
  for (let i = st.bugs.length - 1; i >= 0; i--) if (Math.random() < .5) st.bugs.splice(i, 1);
  for (const d of drops) d.run = true;   // the water runs off down the glass
}
export function cycleWipers() { wip.mode = (wip.mode + 1) % 3; toast('Wipers: ' + ['off', 'slow', 'fast'][wip.mode], 900); }
/* bug splat: lobed body + darker core + radial splash streaks + a few flung droplets, all from the bug's seed `n` (stable between frames). `sm` 0..1 = smeared by a dry wiper pass (stretched, paler) */
export function drawBug(b, u) {
  const { W, H } = view, x = W * b.x, y = H * .06 + b.y * H * .45, r = Math.max(b.r * W, .5 * u), sm = b.sm || 0, f = k => rnd(b.n + k * 7.31);
  ctx.save(); ctx.translate(x, y); ctx.rotate(b.a); ctx.scale(1 + sm * 1.6, 1 - sm * .35); ctx.globalAlpha = .8 - sm * .4; ctx.lineCap = 'round';
  ctx.strokeStyle = b.c; ctx.lineWidth = Math.max(.6, r * .16);
  const rays = 7 + Math.floor(f(1) * 5);
  for (let i = 0; i < rays; i++) { const a = i / rays * 6.283 + f(i + 2) * .5, l0 = r * (.9 + f(i + 20) * .4), l1 = r * (1.9 + f(i + 40) * 2.2); ctx.beginPath(); ctx.moveTo(Math.cos(a) * l0, Math.sin(a) * l0); ctx.lineTo(Math.cos(a) * l1, Math.sin(a) * l1); ctx.stroke(); }
  ctx.fillStyle = b.c; ctx.beginPath();
  for (let i = 0; i <= 12; i++) { const a = i / 12 * 6.283, q = r * (.8 + f(i % 12 + 60) * .55); i ? ctx.lineTo(Math.cos(a) * q * 1.2, Math.sin(a) * q) : ctx.moveTo(Math.cos(a) * q * 1.2, Math.sin(a) * q); }
  ctx.fill();
  for (let i = 0; i < 4; i++) { const a = f(i + 80) * 6.283, d = r * (2.2 + f(i + 90) * 2.6); ctx.beginPath(); ctx.arc(Math.cos(a) * d, Math.sin(a) * d, r * (.12 + f(i + 100) * .2), 0, 7); ctx.fill(); }
  ctx.fillStyle = 'rgba(60,45,20,.7)'; ctx.beginPath(); ctx.ellipse(r * .1, 0, r * .4, r * .28, 0, 0, 7); ctx.fill();   // body
  ctx.restore();
}
const bugXY = b => { const { W, H } = view; return [W * b.x, H * .06 + b.y * H * .45]; };
const inSector = (px, py, L, a0, a1, x, y) => { const dx = x - px, dy = y - py, d = Math.hypot(dx, dy); if (d > L || d < L * .12) return false; const f = Math.atan2(-dy, dx); return f >= Math.min(a0, a1) - .03 && f <= Math.max(a0, a1) + .03; };

/* exhaust smoke from the two chrome stacks: amount follows rpm and throttle, black under load, a thick puff at start-up */
const exh = []; let exhAcc = 0, exhLast = performance.now();
export function drawExhaust(u, xs, ty) {
  const now = performance.now(), dt = Math.min(.05, (now - exhLast) / 1000); exhLast = now;
  if (st.mode === 'drive') {
    const rp = clamp(st.rpm / 3000, 0, 1.1), load = .4 + .6 * st.gas;
    const rate = (st.engineOn ? 3 + 28 * Math.pow(rp, 1.5) * load : st.ign && st.ign.t >= 1 ? 6 : 0) + st.rumble * 45;
    const dark = (st.gas > .6 && st.rpm > 1500) || st.rumble > .3;
    exhAcc += rate * dt;
    while (exhAcc >= 1) { exhAcc--; const k = Math.random() < .5 ? 0 : 1; exh.push({ x: xs[k] + (Math.random() - .5) * u, y: ty, vx: (k ? 1 : -1) * (1 + Math.random() * 2) * u, vy: -(7 + rp * 10 + Math.random() * 4) * u, life: 0, max: .9 + Math.random() * .6, r: (.5 + Math.random() * .5) * u, dark, a: Math.min(.9, (.25 + .35 * rp) * 2.5) }); }
  }
  for (let i = exh.length - 1; i >= 0; i--) {
    const q = exh[i]; q.life += dt; if (q.life > q.max) { exh.splice(i, 1); continue; }
    q.x += q.vx * dt; q.y += q.vy * dt; q.r += 3 * u * dt; q.vy *= 1 - dt * .8;
    const f = 1 - q.life / q.max;
    ctx.fillStyle = q.dark ? `rgba(20,20,20,${q.a * f})` : `rgba(215,215,215,${q.a * .8 * f})`; ctx.beginPath(); ctx.arc(q.x, q.y, q.r, 0, 7); ctx.fill();
  }
}
export function drawScreenLayers(u, cx, hy, py) {
  const { W, H } = view;
  const now = performance.now(), dt = Math.min(.05, (now - wip.last) / 1000); wip.last = now;
  const live = st.mode === 'drive', gh = H * .65, L = 40 * u, pivots = [cx - 30 * u, cx + 6 * u], nozzles = [cx - 24 * u, cx + 16 * u];
  if (live) {
    // dust builds up with speed
    wip.acc += st.v * 2 * dt; while (wip.acc >= 1) { wip.acc--; speck(); }
    // snowfall sticks to the glass (the wipers clear it)
    if (weather.snow > 0) { wip.snowAcc = (wip.snowAcc || 0) + weather.snow * (1.2 + st.v * .35) * dt; while (wip.snowAcc >= 1) { wip.snowAcc--; snowSpeck(); } }
    frostStep(dt);
    // washer jets
    wip.wet = Math.max(0, wip.wet - dt * .12);
    if (st.washing) {
      wip.wet = Math.min(1, wip.wet + dt * 4); wip.burst = 2.2;
      for (let i = 0; i < 2; i++) { drops.push({ x: W * (.12 + Math.random() * .76), y: H * .07 + Math.random() * (py - H * .07), r: (.25 + Math.random() * .5) * u, age: 0 }); if (drops.length > 320) drops.shift(); }   // water reaches the whole screen
      for (const nx of nozzles) for (let i = 0; i < 3; i++) spray.push({ x: nx, y: py, vx: (Math.random() - .5) * 16 * u, vy: -(38 + Math.random() * 28) * u, life: 0 });
    } else wip.burst = Math.max(0, wip.burst - dt);
    for (let i = spray.length - 1; i >= 0; i--) {
      const q = spray[i]; q.vy += 60 * u * dt; q.x += q.vx * dt; q.y += q.vy * dt; q.life += dt;
      if (q.vy > -4 * u || q.life > .7) { if (Math.random() < .5) { drops.push({ x: q.x, y: q.y, r: (.25 + Math.random() * .5) * u, age: 0 }); if (drops.length > 220) drops.shift(); } spray.splice(i, 1); }
    }
    for (let i = drops.length - 1; i >= 0; i--) { const d = drops[i]; d.age += dt; if (d.r > .55 * u) d.y += d.r * 2.2 * dt; if (d.run) d.y += 9 * u * dt; if (d.age > 14 || d.y > py + 2 * u) drops.splice(i, 1); }
    // wiper motion: finishes its cycle and parks when switched off
    const active = wip.mode > 0 || wip.burst > 0, pp = wip.phase;
    if (active || wip.phase > 0) { wip.phase += dt / ((wip.mode === 2 || wip.burst > 0) ? 1.1 : 2.2); if (wip.phase >= 1) wip.phase = active ? wip.phase - 1 : 0; }
    if (pp < .5 && wip.phase >= .5 && wip.wet > .3) washAll();   // one "iteration" per sweep while wet
    const phi = PHI_MAX * (.5 - .5 * Math.cos(Math.PI * 2 * wip.phase)), prev = wip.phi;
    if (Math.abs(phi - prev) > 1e-4) {
      const a = .25 + .75 * Math.min(1, wip.wet * 1.5);   // dry blades only smear the dust, wet ones clean it
      gctx.save(); gctx.globalCompositeOperation = 'destination-out'; gctx.fillStyle = gctx.strokeStyle = `rgba(0,0,0,${a})`; gctx.lineWidth = 2;
      for (const px of pivots) {
        const pts = [[px, py], [px + Math.cos(prev) * L, py - Math.sin(prev) * L], [px + Math.cos(phi) * L, py - Math.sin(phi) * L]].map(([x, y]) => [x * GW / W, y * GH / gh]);
        gctx.beginPath(); pts.forEach(([x, y], i) => gctx[i ? 'lineTo' : 'moveTo'](x, y)); gctx.closePath(); gctx.fill(); gctx.stroke();
        for (let i = drops.length - 1; i >= 0; i--) if (inSector(px, py, L, prev, phi, drops[i].x, drops[i].y)) drops.splice(i, 1);
        for (let i = st.bugs.length - 1; i >= 0; i--) { const b = st.bugs[i], [bx, by] = bugXY(b); if (inSector(px, py, L, prev, phi, bx, by)) { b.sm = (b.sm || 0) + (wip.wet > .3 ? 1 : .5); if (b.sm >= 1) st.bugs.splice(i, 1); } }   // wet blade wipes it off, a dry one smears it (2 passes)
      }
      gctx.restore();
    }
    wip.phi = phi;
  }
  // snow in the air (outside the glass), then dust, water drops, jets
  if (weather.snow > 0 && st.mode !== 'paused') drawSnow(dt, u);
  ctx.drawImage(grime, 0, 0, GW, GH, 0, 0, W, gh);
  for (const d of drops) {
    const a = Math.max(0, 1 - d.age / 14);
    ctx.fillStyle = `rgba(190,220,245,${.28 * a})`; ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, 7); ctx.fill();
    ctx.strokeStyle = `rgba(255,255,255,${.5 * a})`; ctx.lineWidth = .15 * u; ctx.stroke();
    ctx.fillStyle = `rgba(255,255,255,${.6 * a})`; ctx.beginPath(); ctx.arc(d.x - d.r * .3, d.y - d.r * .3, d.r * .3, 0, 7); ctx.fill();
  }
  ctx.fillStyle = 'rgba(205,232,255,.7)'; for (const q of spray) { ctx.beginPath(); ctx.arc(q.x, q.y, .35 * u, 0, 7); ctx.fill(); }
  if (frostSum > .5) { if ((fAcc += dt) > .1) { fAcc = 0; frostCompose(); } ctx.drawImage(fcv, 0, 0, GW, GH, 0, 0, W, gh); }   // frost on the glass (re-composed at 10 Hz)
  drawGlassFX(u, cx, hy);
  // wiper arms + blades
  ctx.lineCap = 'round';
  for (const px of pivots) {
    const ex = px + Math.cos(wip.phi) * L, ey = py - Math.sin(wip.phi) * L, bx = px + Math.cos(wip.phi) * L * .3, by = py - Math.sin(wip.phi) * L * .3;
    ctx.strokeStyle = '#141414'; ctx.lineWidth = .7 * u; ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(ex, ey); ctx.stroke();
    ctx.strokeStyle = '#050505'; ctx.lineWidth = 1.2 * u; ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(ex, ey); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,.14)'; ctx.lineWidth = .2 * u; ctx.beginPath(); ctx.moveTo(bx, by - .3 * u); ctx.lineTo(ex, ey - .3 * u); ctx.stroke();
    ctx.fillStyle = '#2a2a2a'; ctx.beginPath(); ctx.arc(px, py, 1.1 * u, 0, 7); ctx.fill();
  }
}
