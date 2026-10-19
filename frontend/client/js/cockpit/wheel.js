import { ctx } from './canvas.js';
import { chromeGrad } from './primitives.js';
import { st } from '../state.js';
import { CFG } from '../config.js';
import { MONO } from '../util.js';
import { hint } from '../guide.js';

/* Steering column and 4-spoke steering wheel component. */

export function drawWheel(cx, u, wl) {
  ctx.fillStyle = '#12100e'; ctx.beginPath(); ctx.moveTo(cx - 6 * u, 88 * u); ctx.lineTo(cx + 6 * u, 88 * u); ctx.lineTo(cx + 9 * u, 112 * u); ctx.lineTo(cx - 9 * u, 112 * u); ctx.fill();
  ctx.save(); ctx.translate(cx, 106 * u); ctx.scale(1, .62); ctx.rotate(st.steer * CFG.TRUCK.WHEEL_TURNS * 2 * Math.PI);
  const R = 27 * u; ctx.lineCap = 'round'; hint('WHEEL', cx - 28 * u, 89 * u, 56 * u, 11 * u);
  ctx.strokeStyle = wl.rim; ctx.lineWidth = 5.4 * u; ctx.beginPath(); ctx.arc(0, 0, R, 0, 7); ctx.stroke();
  ctx.strokeStyle = wl.sheen; ctx.lineWidth = 2.6 * u; ctx.stroke();
  ctx.strokeStyle = wl.spoke; ctx.lineWidth = 3 * u; for (let i = 0; i < 4; i++) { const an = Math.PI / 4 + i * Math.PI / 2; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(an) * R, Math.sin(an) * R); ctx.stroke(); }
  ctx.fillStyle = wl.hub; ctx.beginPath(); ctx.arc(0, 0, 7.5 * u, 0, 7); ctx.fill(); ctx.strokeStyle = chromeGrad(-7 * u, 7 * u); ctx.lineWidth = .6 * u; ctx.stroke();
  ctx.fillStyle = wl.mark; ctx.font = `bold ${5 * u}px ${MONO}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('FC', 0, 0);
  ctx.fillStyle = wl.mark; ctx.beginPath(); ctx.arc(0, -R, 1.2 * u, 0, 7); ctx.fill();   // 12-o'clock marker
  ctx.restore();
}
