import { ctx } from './canvas.js';
import { look } from '../cosmetics.js';

/* Hood mascot component (spear, ball, star, gold, bird, flag). */
const ornamentEdge = u => Math.max(.6, .22 * u);

export function ornamentPath(cx, hy, u, id) {
  ctx.beginPath();
  if (id === 'spear') {
    ctx.moveTo(cx, hy - 2.5 * u); ctx.lineTo(cx + 1.2 * u, hy + .5 * u); ctx.lineTo(cx - 1.2 * u, hy + .5 * u);
    return;
  }
  const y = hy - 1.05 * u;
  if (id === 'ball') { ctx.arc(cx, y, 1.25 * u, 0, 7); return; }
  if (id === 'star') {
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + i * Math.PI * 2 / 5, b = a + Math.PI / 5;
      const ox = cx + Math.cos(a) * 1.7 * u, oy = y + Math.sin(a) * 1.7 * u, ix = cx + Math.cos(b) * .7 * u, iy = y + Math.sin(b) * .7 * u;
      if (i) ctx.lineTo(ox, oy); else ctx.moveTo(ox, oy);
      ctx.lineTo(ix, iy);
    }
    ctx.closePath(); return;
  }
  if (id === 'gold') { ctx.moveTo(cx, hy - 2.6 * u); ctx.lineTo(cx + 1.05 * u, y); ctx.lineTo(cx, hy + .45 * u); ctx.lineTo(cx - 1.05 * u, y); ctx.closePath(); return; }
  if (id === 'bird') {
    ctx.moveTo(cx, hy - 2.45 * u);
    ctx.quadraticCurveTo(cx + 2.4 * u, hy - 2.05 * u, cx + 2.05 * u, hy - .3 * u);
    ctx.quadraticCurveTo(cx + 1.15 * u, hy - 1.2 * u, cx, hy - .8 * u);
    ctx.quadraticCurveTo(cx - 1.15 * u, hy - 1.2 * u, cx - 2.05 * u, hy - .3 * u);
    ctx.quadraticCurveTo(cx - 2.4 * u, hy - 2.05 * u, cx, hy - 2.45 * u);
    ctx.closePath(); return;
  }
  ctx.rect(cx - .16 * u, hy - 2.55 * u, .32 * u, 3.05 * u);
  ctx.moveTo(cx + .16 * u, hy - 2.5 * u); ctx.lineTo(cx + 2.15 * u, hy - 1.75 * u); ctx.lineTo(cx + .16 * u, hy - 1.05 * u); ctx.closePath();
}

function strokeOrnament(u, color) { ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = ornamentEdge(u); ctx.lineJoin = 'round'; ctx.stroke(); ctx.restore(); }

export function drawOrnament(cx, hy, u, id) {
  if (id === 'spear') { ctx.fillStyle = '#e8ecef'; ornamentPath(cx, hy, u, id); ctx.fill(); return; }
  const o = look('ornament');
  ornamentPath(cx, hy, u, id); ctx.fillStyle = o.fill; ctx.fill(); strokeOrnament(u, o.edge);
}
