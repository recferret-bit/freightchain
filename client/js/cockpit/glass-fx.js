import { ctx, view } from './canvas.js';
import { st, dn, weather } from '../state.js';
import { CFG } from '../config.js';
import { clamp, rnd } from '../util.js';
import { ObjectPool } from '../object-pool.js';

/* Windscreen particle & damage overlays: scratches, cracks, hood smoke, exhaust-stack smoke, bug splats, and falling snow. */

export const smoke = [], exh = [];
export const smokePool = new ObjectPool('smoke2d', () => ({ x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 1, r: 1, dark: false, a: 1 }), () => {});
export const flakePool = new ObjectPool('flake2d', () => ({ x: 0, y: 0, z: 1, ph: 0, fall: 1 }), () => {});
let smokeT = 0, fxLast = performance.now(), exhAcc = 0, exhLast = performance.now();

export function drawGlassFX(u, cx, hy) {
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
    while (smokeT >= 1) { smokeT--; smoke.push(Object.assign(smokePool.acquire(), { x: cx + (Math.random() - .5) * 10 * u, y: hy + 6 * u, vx: (Math.random() - .5) * 3 * u, vy: -(6 + Math.random() * 6) * u, life: 0, max: 1.5 + Math.random(), r: (2 + Math.random() * 2) * u, dark: st.hull < 18, a: 1 })); }
  }
  for (let i = smoke.length - 1; i >= 0; i--) {
    const q = smoke[i]; q.life += dt; if (q.life > q.max) { smokePool.release(q); smoke.splice(i, 1); continue; }
    q.x += q.vx * dt; q.y += q.vy * dt; q.r += 4 * u * dt;
    ctx.fillStyle = q.dark ? `rgba(25,25,25,${(1 - q.life / q.max) * .55})` : `rgba(225,225,225,${(1 - q.life / q.max) * .45})`; ctx.beginPath(); ctx.arc(q.x, q.y, q.r, 0, 7); ctx.fill();
  }
}

/* snowflakes: points in camera space (x right, y up, z ahead, metres) streaking out of the vanishing point; the truck's speed sets the streak length */
const flakes = [];
export function resetSnow() { while (flakes.length) flakePool.release(flakes.pop()); }
export function resetGlassFX() {
  while (smoke.length) smokePool.release(smoke.pop());
  while (exh.length) smokePool.release(exh.pop());
  resetSnow();
}
function flakeAt(f, far) { f.x = (Math.random() - .5) * 28; f.y = (Math.random() - .35) * 8; f.z = far ? 28 + Math.random() * 20 : .8 + Math.random() * 46; f.ph = Math.random() * 6.3; f.fall = .7 + Math.random() * .9; return f; }
export function drawSnow(dt, u) {
  const { W, H } = view, want = Math.round(CFG.SNOW_FLAKES * weather.snow), f = H * .87, vx = W / 2, vy = H * .36, dim = 1 - .45 * dn.k;
  while (flakes.length < want) flakes.push(flakeAt(flakePool.acquire(), false));
  while (flakes.length > want) flakePool.release(flakes.pop());
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
export const bugXY = b => { const { W, H } = view; return [W * b.x, H * .06 + b.y * H * .45]; };
export const inSector = (px, py, L, a0, a1, x, y) => { const dx = x - px, dy = y - py, d = Math.hypot(dx, dy); if (d > L || d < L * .12) return false; const f = Math.atan2(-dy, dx); return f >= Math.min(a0, a1) - .03 && f <= Math.max(a0, a1) + .03; };

/* exhaust smoke from the two chrome stacks: amount follows rpm and throttle, black under load, a thick puff at start-up */
export function drawExhaust(u, xs, ty) {
  const now = performance.now(), dt = Math.min(.05, (now - exhLast) / 1000); exhLast = now;
  if (st.mode === 'drive') {
    const rp = clamp(st.rpm / 3000, 0, 1.1), load = .4 + .6 * st.gas;
    const rate = (st.engineOn ? 3 + 28 * Math.pow(rp, 1.5) * load : st.ign && st.ign.t >= 1 ? 6 : 0) + st.rumble * 45;
    const dark = (st.gas > .6 && st.rpm > 1500) || st.rumble > .3;
    exhAcc += rate * dt;
    while (exhAcc >= 1) { exhAcc--; const k = Math.random() < .5 ? 0 : 1; exh.push(Object.assign(smokePool.acquire(), { x: xs[k] + (Math.random() - .5) * u, y: ty, vx: (k ? 1 : -1) * (1 + Math.random() * 2) * u, vy: -(7 + rp * 10 + Math.random() * 4) * u, life: 0, max: .9 + Math.random() * .6, r: (.5 + Math.random() * .5) * u, dark, a: Math.min(.9, (.25 + .35 * rp) * 2.5) })); }
  }
  for (let i = exh.length - 1; i >= 0; i--) {
    const q = exh[i]; q.life += dt; if (q.life > q.max) { smokePool.release(q); exh.splice(i, 1); continue; }
    q.x += q.vx * dt; q.y += q.vy * dt; q.r += 3 * u * dt; q.vy *= 1 - dt * .8;
    const f = 1 - q.life / q.max;
    ctx.fillStyle = q.dark ? `rgba(20,20,20,${q.a * f})` : `rgba(215,215,215,${q.a * .8 * f})`; ctx.beginPath(); ctx.arc(q.x, q.y, q.r, 0, 7); ctx.fill();
  }
}
