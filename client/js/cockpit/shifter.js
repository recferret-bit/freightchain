import { ctx } from './canvas.js';
import { st } from '../state.js';
import { clamp, approach, gearName, MONO } from '../util.js';
import { hint } from '../guide.js';
import { chromeGrad } from './primitives.js';

/* Tweened gear-lever position + floor shifter component (H pattern, 4 columns: 1/2, 3/4, 5/6, 7/R). */
export const lever = { col: 0, row: 0, t: 0 }, LEVER_RATE = 28;   // gate units / s

export function leverPos(tcol, trow) {
  const now = performance.now(), dt = clamp((now - lever.t) / 1000, 0, .1); lever.t = now;
  if (Math.abs(lever.col - tcol) > .005) { if (Math.abs(lever.row) > .005) lever.row = approach(lever.row, 0, LEVER_RATE, dt); else lever.col = approach(lever.col, tcol, LEVER_RATE, dt); }
  else { lever.col = tcol; lever.row = approach(lever.row, trow, LEVER_RATE, dt); }
  return lever;
}

export function drawShifter(rx, u, gb) {
  const bx = rx + 16.25 * u, g = st.gear;   // centred under WASH
  const col = g === 0 ? 0 : g < 0 ? 1.5 : [-1.5, -1.5, -.5, -.5, .5, .5, 1.5][g - 1], row = g === 0 ? 0 : g < 0 ? 1 : [-1, 1, -1, 1, -1, 1, -1][g - 1];   // R: right, back
  hint('SHIFTER', bx - 7 * u, 81 * u, 14 * u, 19 * u);
  const lv = leverPos(col, row), kx = bx + lv.col * 2.6 * u, ky = 86 * u + lv.row * 2.6 * u;   // tweened through the neutral channel
  ctx.fillStyle = gb.boot; ctx.beginPath(); ctx.ellipse(bx, 100 * u, 6 * u, 2.6 * u, 0, 0, 7); ctx.fill();
  ctx.strokeStyle = gb.lever ?? chromeGrad(bx - 1 * u, bx + 1 * u); ctx.lineWidth = 1.4 * u; ctx.beginPath(); ctx.moveTo(bx, 100 * u); ctx.lineTo(kx, ky); ctx.stroke();
  ctx.fillStyle = gb.knob; ctx.beginPath(); ctx.arc(kx, ky, 2.8 * u, 0, 7); ctx.fill(); ctx.strokeStyle = gb.rim; ctx.lineWidth = .3 * u; ctx.stroke();
  ctx.fillStyle = gb.text; ctx.font = `bold ${2.6 * u}px ${MONO}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(gearName(g), kx, ky);
}
