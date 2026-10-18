import { ctx } from './canvas.js';
import { st } from '../state.js';
import { clamp, approach, MONO } from '../util.js';
import { chromeGrad, uiBtns } from './primitives.js';

/* Ignition: key switch (OFF / ON / START) + START button. The key follows the engine state (st.ign: 0-1 s key-on, 1-2.3 s cranking), a refused attempt (st.keyDeny) wiggles it. */
export const keyAnim = { pos: 0, t: 0 };   // pos 0 OFF, 1 ON, 2 START (sprung back to ON when the engine catches); exported so the landing's dash cards can keep one each

export function ignitionPanel(x, y, u) {
  const now = performance.now(), dt = clamp((now - keyAnim.t) / 1000, 0, .1); keyAnim.t = now; let keyPos = keyAnim.pos;
  const ign = st.ign, crank = !!ign && ign.t >= 1.0, target = ign ? (crank ? 2 : 1) : (st.engineOn || st.stalled || st.keyOn) ? 1 : 0;
  keyPos = keyAnim.pos = approach(keyPos, target, target > keyPos ? (target === 2 ? 9 : 3.5) : 7, dt);
  const deny = st.keyDeny || 0, ang = (keyPos - 1) * .9 + (crank ? Math.sin(now / 16) * .035 : 0) + Math.sin(deny * 28) * deny * .3;
  const bg = ctx.createRadialGradient(x, y - u, u, x, y, 4.6 * u); bg.addColorStop(0, '#2b2822'); bg.addColorStop(1, '#0a0908');
  ctx.fillStyle = bg; ctx.beginPath(); ctx.arc(x, y, 4.2 * u, 0, 7); ctx.fill(); ctx.strokeStyle = chromeGrad(x - 4 * u, x + 4 * u); ctx.lineWidth = .6 * u; ctx.stroke();
  ctx.font = `${1.3 * u}px ${MONO}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  [['OFF', 0, 'key-off'], ['ON', 1, 'key-on'], ['START', 2, 'key-start']].forEach(([t, i, id]) => {   // the three labels are the clickable zones
    const a = (i - 1) * .9, lx = x + Math.sin(a) * (i === 1 ? 7 : 9) * u, ly = y - Math.cos(a) * (i === 1 ? 7 : 9) * u + (i === 1 ? 0 : 1.2 * u), w = (t.length * .95 + 1.6) * u, h = 2.6 * u, act = Math.abs(keyPos - i) < .3;
    uiBtns.push({ id, x: lx - w / 2, y: ly - h / 2, w, h });
    ctx.fillStyle = act ? 'rgba(124,214,106,.12)' : 'rgba(255,255,255,.04)'; ctx.beginPath(); ctx.roundRect(lx - w / 2, ly - h / 2, w, h, .5 * u); ctx.fill(); ctx.strokeStyle = act ? '#7cd66a' : '#4a453b'; ctx.lineWidth = .2 * u; ctx.stroke();
    ctx.fillStyle = act ? (i ? '#9dff8a' : '#ffb03a') : '#a39b84'; ctx.fillText(t, lx, ly);
  });
  ctx.fillStyle = '#050403'; ctx.beginPath(); ctx.arc(x, y, 1.6 * u, 0, 7); ctx.fill();
  ctx.save(); ctx.translate(x, y); ctx.rotate(ang); ctx.scale(.62, .62);
  const rr = (x0, y0, w, h, r) => { ctx.beginPath(); ctx.roundRect(x0 * u, y0 * u, w * u, h * u, r * u); };
  ctx.save(); ctx.translate(.45 * u, .7 * u); ctx.globalAlpha = .45; ctx.fillStyle = '#000'; rr(-1.8, -7, 3.6, 4.2, 1); ctx.fill(); ctx.fillRect(-.6 * u, -3.4 * u, 1.2 * u, 3.4 * u); ctx.restore();   // drop shadow on the dash
  const bl = chromeGrad(-.7 * u, .7 * u); ctx.fillStyle = bl; ctx.fillRect(-.6 * u, -3.6 * u, 1.2 * u, 3.6 * u);   // blade
  ctx.strokeStyle = '#3a3a3a'; ctx.lineWidth = .12 * u; for (let i = 0; i < 4; i++) { const by = (-.5 - i * .75) * u; ctx.beginPath(); ctx.moveTo(-.6 * u, by); ctx.lineTo(i % 2 ? -.1 * u : .1 * u, by); ctx.stroke(); }   // cuts
  const col = ctx.createLinearGradient(0, -4.4 * u, 0, -3.3 * u); col.addColorStop(0, '#f4f6f8'); col.addColorStop(1, '#5a5f66'); ctx.fillStyle = col; rr(-1.2, -4.4, 2.4, 1.1, .4); ctx.fill();   // chrome collar
  ctx.fillStyle = '#050505'; rr(-1.7, -6.5, 3.4, 4, 1); ctx.fill();   // bow: thickness (dark rim offset down), then the lit face
  const face = ctx.createLinearGradient(-1.7 * u, -7 * u, 1.7 * u, -3 * u); face.addColorStop(0, '#5a564c'); face.addColorStop(.35, '#26241e'); face.addColorStop(1, '#0c0b09');
  ctx.fillStyle = face; rr(-1.7, -7, 3.4, 4, 1); ctx.fill(); ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = .15 * u; ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,.22)'; rr(-1.3, -6.7, 1.1, 2.6, .5); ctx.fill();   // specular streak
  const gl = ctx.createLinearGradient(0, -6.3 * u, 0, -5.6 * u); gl.addColorStop(0, '#ff6a5a'); gl.addColorStop(1, '#8a1410'); ctx.fillStyle = gl; rr(-1.1, -6.4, 2.2, .8, .3); ctx.fill();   // red inlay
  ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(0, -4.4 * u, .5 * u, 0, 7); ctx.fill(); ctx.strokeStyle = chromeGrad(-.6 * u, .6 * u); ctx.lineWidth = .18 * u; ctx.stroke();   // key-ring hole
  ctx.restore();
  ctx.fillStyle = st.engineOn ? '#6cbf55' : ign ? '#ffb03a' : '#3a2a14'; ctx.beginPath(); ctx.arc(x + 9.4 * u, y + 2.2 * u, .7 * u, 0, 7); ctx.fill();   // run lamp
}
