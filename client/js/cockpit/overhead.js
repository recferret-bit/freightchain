import { ctx } from './canvas.js';
import { uiBtns, litRect } from './primitives.js';
import { dn } from '../state.js';

/* Overhead console component (dome lamp + cab light switch). */

export function drawOverhead(cx, u, top, btns) {
  const LW = 16 * u, PW = LW * 1.2;   // the console is just the dome lamp now: lens 16u wide (was 8u), housing = lens + 20 %
  ctx.fillStyle = '#16130f'; ctx.beginPath(); ctx.roundRect(cx - PW / 2, top - 1 * u, PW, 6.5 * u, [0, 0, 2 * u, 2 * u]); ctx.fill();
  const lx = cx, ly = top + 2.3 * u;
  uiBtns.push({ id: btns?.cab?.id || 'cab', x: cx - 9.6 * u, y: top - 1 * u, w: 19.2 * u, h: 6.5 * u });   // the whole lamp housing is the cab-light switch
  if (dn.cab) { const g = ctx.createRadialGradient(lx, ly, .5 * u, lx, ly, 14 * u); g.addColorStop(0, 'rgba(255,225,170,.55)'); g.addColorStop(1, 'rgba(255,200,130,0)'); ctx.fillStyle = g; ctx.fillRect(lx - 14 * u, ly - 14 * u, 28 * u, 28 * u); }
  ctx.fillStyle = dn.cab ? '#fff1cf' : '#3a352d'; ctx.beginPath(); ctx.roundRect(lx - 8 * u, ly - 1.7 * u, 16 * u, 3.4 * u, 1.2 * u); ctx.fill();
  if (dn.cab) litRect(lx - 8 * u, ly - 1.7 * u, 16 * u, 3.4 * u);
}
