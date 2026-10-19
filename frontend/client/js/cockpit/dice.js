import { ctx } from './canvas.js';
import { st } from '../state.js';
import { clamp } from '../util.js';
import { pose } from '../cosmetics.js';

/* Hanging fuzzy dice cab cosmetic component (sways with steering, vibration, and TEN4 cab pose). */

export function drawDice(cx, u, vib, dc) {
  const sw = -st.steer * .35 * clamp(st.v / 12, 0, 1) + Math.sin(performance.now() / 700) * .03 + vib * .02 + pose.dice;
  ctx.save(); ctx.translate(cx - 34 * u, 1 * u); ctx.rotate(sw);
  ctx.strokeStyle = '#ddd'; ctx.lineWidth = .25 * u; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, 9 * u); ctx.stroke();
  ctx.translate(0, 9 * u); ctx.fillStyle = dc.body; ctx.beginPath(); ctx.roundRect(-3.2 * u, 0, 3 * u, 3 * u, .5 * u); ctx.roundRect(.2 * u, 1 * u, 3 * u, 3 * u, .5 * u); ctx.fill();
  ctx.fillStyle = dc.pip; for (const [dx, dy] of [[-2.7, .5], [-.7, 2.5], [.7, 1.5], [2.7, 3.5]]) { ctx.beginPath(); ctx.arc(dx * u, dy * u, .35 * u, 0, 7); ctx.fill(); }
  ctx.restore();
}
