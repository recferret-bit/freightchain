import { look } from '../cosmetics.js';
import { ctx } from './canvas.js';
import { st, powered, bulbCheck } from '../state.js';
import { clamp, approach, MONO } from '../util.js';
import { radio } from '../sim/radio.js';
import { CFG } from '../config.js';

/* Shared 2D dash widgets. */

/* Backlit instrument areas (screen px, before the shake translate – like uiBtns), rebuilt every frame; nightGrade() keeps them out of the night veil while the cab light is on. */
export const litShapes = [];
export const litRect = (x, y, w, h) => litShapes.push({ x, y, w, h });
const litCircle = (x, y, r) => litShapes.push({ x, y, r });

export function gauge(cx, cy, r, val, max, step, redFrom, label, u) {
  litCircle(cx, cy, r + .5 * u);
  const a0 = Math.PI * 0.75, sw = Math.PI * 1.5;
  const bg = ctx.createRadialGradient(cx, cy - r * .3, r * .1, cx, cy, r); bg.addColorStop(0, '#26231f'); bg.addColorStop(1, '#0b0a09');
  ctx.fillStyle = bg; ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7); ctx.fill();
  ctx.lineWidth = u * .6; ctx.strokeStyle = '#555049'; ctx.stroke();
  ctx.font = `${r * .17}px ui-monospace,Menlo,monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const n = Math.round(max / step);
  for (let i = 0; i <= n; i++) {
    const v = i * step, an = a0 + sw * v / max, red = redFrom && v >= redFrom;
    ctx.strokeStyle = red ? '#ff4a3a' : '#e8e2cf'; ctx.lineWidth = u * .35;
    ctx.beginPath(); ctx.moveTo(cx + Math.cos(an) * r * .78, cy + Math.sin(an) * r * .78); ctx.lineTo(cx + Math.cos(an) * r * .92, cy + Math.sin(an) * r * .92); ctx.stroke();
    ctx.fillStyle = red ? '#ff6a58' : '#e8e2cf'; ctx.fillText(label === 'RPM×100' ? v / 100 : v, cx + Math.cos(an) * r * .62, cy + Math.sin(an) * r * .62);
  }
  ctx.fillStyle = '#9d957f'; if (label === 'RPM×100') { ctx.font = `${r * .12}px ui-monospace,Menlo,monospace`; ctx.fillText(label, cx, cy + r * .5); } else ctx.fillText(label, cx, cy + r * .45);
  const isRpm = label === 'RPM×100', pw = powered();
  let k = 0;   // 0..1 how deep into the max-rev zone: the needle trembles instead of sitting on the stop
  if (isRpm && redFrom) {
    k = clamp((val - CFG.STRAIN_RPM * redFrom) / ((1 - CFG.STRAIN_RPM) * redFrom), 0, 1);
    const t = performance.now() / 1000;
    val += k * CFG.RPM_JITTER * (.5 * Math.sin(t * 47) + .3 * Math.sin(t * 83 + 1) + (Math.random() - .5) * 1.1);
  }
  if (isRpm && redFrom && pw) {   // red band over the redline zone, glowing as the needle enters it
    ctx.save(); ctx.lineCap = 'butt'; ctx.lineWidth = r * .07; ctx.strokeStyle = `rgba(255,74,58,${.55 + .45 * k})`;
    if (k > 0) { ctx.shadowColor = '#ff3a2a'; ctx.shadowBlur = r * .5 * k; }
    ctx.beginPath(); ctx.arc(cx, cy, r * .96, a0 + sw * redFrom / max, a0 + sw); ctx.stroke(); ctx.restore();
  }
  const an = a0 + sw * clamp(val / max, 0, 1.03);
  ctx.save(); ctx.lineCap = 'round';
  if (isRpm) { ctx.shadowColor = k > 0 ? '#ff4a2a' : 'rgba(0,0,0,.6)'; ctx.shadowBlur = k > 0 ? r * (.2 + .3 * k) : r * .08; ctx.shadowOffsetY = k > 0 ? 0 : r * .03; }
  ctx.strokeStyle = k > .3 ? '#ff5a3a' : look('needle').color; ctx.lineWidth = u * .55;   // (the over-rev warning stays red whatever the needle colour)
  ctx.beginPath(); ctx.moveTo(cx - Math.cos(an) * r * .12, cy - Math.sin(an) * r * .12); ctx.lineTo(cx + Math.cos(an) * r * .8, cy + Math.sin(an) * r * .8); ctx.stroke(); ctx.restore();
  ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(cx, cy, r * .09, 0, 7); ctx.fill();
}
/* STALL lamp: blinks while the engine is lugging and just after a stall, steady while it is off */
export function stallLamp() { const b = Math.floor(performance.now() / 130) % 2 === 0; return st.stall > .05 ? b : st.engineOn ? st.lug > .15 && b : true; }
export function lamp(x, y, text, on, col, u, w = 13) {
  on = (on && powered()) || bulbCheck();   // dead with the key OFF; bulb check at key-on
  litRect(x - .2 * u, y - .2 * u, (w + .4) * u, 4.6 * u);
  ctx.fillStyle = on ? col : '#2a2622'; ctx.fillRect(x, y, w * u, 4.2 * u);
  ctx.fillStyle = on ? '#fff' : '#5c564b'; ctx.font = `${2.4 * u}px ui-monospace,Menlo,monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, x + w / 2 * u, y + 2.2 * u);
}
/* STRAIN lamp: dim amber while charging, red and blinking as the engine nears failure */
export function strainLamp(x, y, u, w) { const k = st.strain; lamp(x, y, 'STRAIN', k > .15 && (k < .6 || Math.floor(st.t * 6) % 2 === 0), k < .6 ? '#e80' : '#d22', u, w); }
/* BRAKES lamp: amber as the brakes heat up, red and blinking once they fade badly */
export function brakeLamp(x, y, u, w) { const k = st.brakeT; lamp(x, y, 'BRAKES', k > .25 && (k < .6 || Math.floor(st.t * 6) % 2 === 0), k < .6 ? '#e80' : '#d22', u, w); }
export function chromeGrad(x0, x1) { const g = ctx.createLinearGradient(x0, 0, x1, 0); g.addColorStop(0, '#6d737a'); g.addColorStop(.3, '#f2f5f7'); g.addColorStop(.55, '#9aa1a8'); g.addColorStop(1, '#4a4f55'); return g; }
export function miniGauge(x, y, r, f, f2, label, lo, hi, u, red) {
  litCircle(x, y, r + .4 * u);
  const bg = ctx.createRadialGradient(x, y - r * .3, r * .1, x, y, r); bg.addColorStop(0, '#25221e'); bg.addColorStop(1, '#080706');
  ctx.fillStyle = bg; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
  ctx.strokeStyle = chromeGrad(x - r, x + r); ctx.lineWidth = u * .45; ctx.stroke();
  const a0 = Math.PI * .75, sw = Math.PI * 1.5;
  for (let i = 0; i <= 4; i++) { const an = a0 + sw * i / 4; ctx.strokeStyle = (red && i / 4 >= red) ? '#ff5040' : '#e8e2cf'; ctx.lineWidth = u * .25; ctx.beginPath(); ctx.moveTo(x + Math.cos(an) * r * .7, y + Math.sin(an) * r * .7); ctx.lineTo(x + Math.cos(an) * r * .9, y + Math.sin(an) * r * .9); ctx.stroke(); }
  ctx.fillStyle = '#bdb59d'; ctx.font = `${r * .34}px ${MONO}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(lo, x - r * .55, y + r * .72); ctx.fillText(hi, x + r * .55, y + r * .72); ctx.fillText(label, x, y + r * .36);
  const needle = (ff, col) => { const an = a0 + sw * clamp(ff, 0, 1); ctx.strokeStyle = col; ctx.lineWidth = u * .35; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(an) * r * .78, y + Math.sin(an) * r * .78); ctx.stroke(); };
  if (f2 != null) needle(f2, '#e8e2cf'); needle(f, look('needle').color);
  ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(x, y, r * .12, 0, 7); ctx.fill();
}
export function ledBar(x, y, w, h, val, col, label, u) {
  const n = 10, sh = h / n; litRect(x - .3 * u, y, w + .6 * u, h + 3 * u);   // + the label
  for (let i = 0; i < n; i++) { ctx.fillStyle = val > (i + .5) / n ? col : '#1c1915'; ctx.fillRect(x, y + h - (i + 1) * sh + .3 * u, w, sh - .6 * u); }
  ctx.fillStyle = '#9d957f'; ctx.font = `${1.7 * u}px ${MONO}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(label, x + w / 2, y + h + 1.8 * u);
}
/* heater switch: lit while on, and a small bar under the label shows how warm the air actually is (it follows the engine temperature) */
export function heatButton(x, y, w, h, u) {
  uiButton('heat', 'HEAT', x, y, w, h, u, st.heater && powered());
  if (st.heater && powered()) { ctx.fillStyle = '#1a1713'; ctx.fillRect(x + .8 * u, y + h - 1.1 * u, w - 1.6 * u, .6 * u); ctx.fillStyle = st.heatEff > .5 ? '#ff9a3a' : st.heatEff > .12 ? '#d8b04a' : '#4a8fd8'; ctx.fillRect(x + .8 * u, y + h - 1.1 * u, Math.max(.4 * u, (w - 1.6 * u) * st.heatEff), .6 * u); }
}
/* clickable dash buttons: rebuilt every frame by uiButton(), hit-tested in ui/input.js */
export const uiBtns = [];
export function uiButton(id, label, x, y, w, h, u, on) {
  uiBtns.push({ id, x, y, w, h }); litRect(x - .2 * u, y - .2 * u, w + .4 * u, h + .4 * u);
  ctx.fillStyle = on ? '#2d3a2a' : '#1d1b18'; ctx.beginPath(); ctx.roundRect(x, y, w, h, .8 * u); ctx.fill();
  ctx.strokeStyle = on ? '#7cd66a' : '#4a453b'; ctx.lineWidth = .3 * u; ctx.stroke();
  ctx.fillStyle = on ? '#9dff8a' : '#bdb59d'; ctx.font = `${1.9 * u}px ${MONO}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(label, x + w / 2, y + h / 2);
}
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

/* Dash radio (inside the panel rig.js draws at rx, 64u): LCD with frequency + scrolling song title, ‹ PWR › buttons. */
export function radioPanel(rx, u, pw) {
  const on = radio.on && pw, S = radio.station;
  ctx.fillStyle = pw ? '#0d2410' : '#0a170c'; ctx.fillRect(rx + 1.5 * u, 65.2 * u, 19 * u, 4.6 * u); litRect(rx + 1.5 * u, 65.2 * u, 19 * u, 4.6 * u);
  if (pw) {
    ctx.fillStyle = on ? '#7cff7c' : '#2f6a2f'; ctx.font = `${1.7 * u}px ${MONO}`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(on ? S.freq.toFixed(1) + ' ' + S.short : 'RADIO OFF', rx + 2 * u, 66.5 * u);
    if (on) { const t = (radio.nowPlaying() || '') + '   ♪   ', n = 17, o = Math.floor(performance.now() / 260) % t.length, w = (t + t).slice(o, o + n); ctx.fillText(w, rx + 2 * u, 68.5 * u); }
    ctx.textAlign = 'center';
  }
  uiButton('r-prev', '‹', rx + 1.5 * u, 70.4 * u, 5.6 * u, 3.2 * u, u, false);
  uiButton('r-pwr', 'PWR', rx + 7.7 * u, 70.4 * u, 6.6 * u, 3.2 * u, u, on);
  uiButton('r-next', '›', rx + 14.9 * u, 70.4 * u, 5.6 * u, 3.2 * u, u, false);
}

/* Tweened gear-lever position. H gate: leave the gear's row, slide across the neutral channel (row 0), then enter the new row. */
export const lever = { col: 0, row: 0, t: 0 }, LEVER_RATE = 28;   // gate units / s
export function leverPos(tcol, trow) {
  const now = performance.now(), dt = clamp((now - lever.t) / 1000, 0, .1); lever.t = now;
  if (Math.abs(lever.col - tcol) > .005) { if (Math.abs(lever.row) > .005) lever.row = approach(lever.row, 0, LEVER_RATE, dt); else lever.col = approach(lever.col, tcol, LEVER_RATE, dt); }
  else { lever.col = tcol; lever.row = approach(lever.row, trow, LEVER_RATE, dt); }
  return lever;
}
