import { ctx, mirrorRects } from './canvas.js';
import { chromeGrad } from './primitives.js';
import { ornamentPath, drawOrnament } from './ornament.js';
import { dn } from '../state.js';
import { CFG } from '../config.js';
import { loadout } from '../cosmetics.js';

/* Exterior & structural cab components visible from the driver's seat: cab shell, west-coast mirrors, glass tint, long hood, and chrome exhaust stacks. */

export function wsPath(W, cx, top, edgeY, ctrlY) {
  ctx.moveTo(W * .11, top); ctx.lineTo(W * .89, top); ctx.lineTo(W * .92, edgeY); ctx.quadraticCurveTo(cx, ctrlY, W * .08, edgeY); ctx.closePath();
}

export function drawCabShell(W, H, cx, u, top, edgeY, ctrlY, paint) {
  const fg = ctx.createLinearGradient(0, 0, 0, H); fg.addColorStop(0, '#26221d'); fg.addColorStop(1, '#0c0a08');
  ctx.fillStyle = fg; ctx.beginPath(); ctx.rect(-20, -20, W + 40, H + 40); wsPath(W, cx, top, edgeY, ctrlY); ctx.fill('evenodd');
  ctx.beginPath(); wsPath(W, cx, top, edgeY, ctrlY); ctx.strokeStyle = paint.frame; ctx.lineWidth = .9 * u; ctx.stroke();
}

export function drawMirrors(W, u) {
  for (const m of mirrorRects()) {
    const { x: mx, y: my, w: mw, h: mh, side } = m;
    ctx.strokeStyle = '#15130f'; ctx.lineWidth = 1.2 * u; ctx.beginPath(); ctx.moveTo(side < 0 ? mx + mw : mx, my + mh * .6); ctx.lineTo(side < 0 ? W * .085 : W * .915, 40 * u); ctx.stroke();
    ctx.fillStyle = '#0b0a09'; ctx.beginPath(); ctx.roundRect(mx - .6 * u, my - .6 * u, mw + 1.2 * u, mh + 1.2 * u, 1.5 * u); ctx.fill();
    ctx.save(); ctx.globalCompositeOperation = 'destination-out'; ctx.beginPath(); ctx.roundRect(mx, my, mw, mh, 1.2 * u); ctx.fill(); ctx.restore();   // live rear view shows through
    const gg = ctx.createLinearGradient(mx, my, mx + mw, my + mh); gg.addColorStop(0, 'rgba(255,255,255,.2)'); gg.addColorStop(.4, 'rgba(255,255,255,0)');
    ctx.fillStyle = gg; ctx.beginPath(); ctx.roundRect(mx, my, mw, mh, 1.2 * u); ctx.fill();
  }
}

export function drawGlassTint(W, H, u, top) {
  const gl = ctx.createLinearGradient(0, 0, W, H * .6); gl.addColorStop(0, 'rgba(255,255,255,.07)'); gl.addColorStop(.4, 'rgba(255,255,255,0)'); gl.addColorStop(.6, 'rgba(255,255,255,.04)'); gl.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gl; ctx.fillRect(0, 0, W, H);
  const vg = ctx.createLinearGradient(0, top, 0, top + 10 * u); vg.addColorStop(0, 'rgba(10,30,26,.7)'); vg.addColorStop(1, 'rgba(10,30,26,0)'); ctx.fillStyle = vg; ctx.fillRect(0, top, W, 10 * u);   // tinted sun band
}

export function drawHood(cx, u, paint) {
  const hy = 47 * u, hb = 64 * u;
  ctx.fillStyle = paint.fender; ctx.beginPath(); ctx.moveTo(cx - 12 * u, hy + 2 * u); ctx.lineTo(cx - 36 * u, hb); ctx.lineTo(cx + 36 * u, hb); ctx.lineTo(cx + 12 * u, hy + 2 * u); ctx.closePath(); ctx.fill();     // fenders
  const hg = ctx.createLinearGradient(0, hy, 0, hb); hg.addColorStop(0, paint.top); hg.addColorStop(1, paint.bottom);
  ctx.fillStyle = hg; ctx.beginPath(); ctx.moveTo(cx - 9 * u, hy); ctx.lineTo(cx - 23 * u, hb); ctx.lineTo(cx + 23 * u, hb); ctx.lineTo(cx + 9 * u, hy); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = paint.line; ctx.lineWidth = .5 * u; ctx.beginPath(); ctx.moveTo(cx, hy); ctx.lineTo(cx, hb); ctx.stroke();
  ctx.strokeStyle = chromeGrad(cx - 23 * u, cx + 23 * u); ctx.lineWidth = .7 * u; ctx.beginPath(); ctx.moveTo(cx - 9 * u, hy); ctx.lineTo(cx - 23 * u, hb); ctx.moveTo(cx + 9 * u, hy); ctx.lineTo(cx + 23 * u, hb); ctx.stroke();
  drawOrnament(cx, hy, u, loadout.ornament);
  const hd = CFG.HOOD_DARK * dn.k * (dn.cab ? 0 : 1 - dn.hood);   // night: the bonnet nearly vanishes unless the cab light / an outside lamp lights it. Drawn HERE (hood + fenders only, before the dash is painted over it)
  if (hd > .01) {
    ctx.fillStyle = `rgba(3,5,12,${hd})`;   // exactly the fender + hood polygons above (one path, so where they overlap it is darkened once)
    ctx.beginPath(); ctx.moveTo(cx - 12 * u, hy + 2 * u); ctx.lineTo(cx - 36 * u, hb); ctx.lineTo(cx + 36 * u, hb); ctx.lineTo(cx + 12 * u, hy + 2 * u); ctx.closePath();
    ctx.moveTo(cx - 9 * u, hy); ctx.lineTo(cx - 23 * u, hb); ctx.lineTo(cx + 23 * u, hb); ctx.lineTo(cx + 9 * u, hy); ctx.closePath(); ctx.fill();
    ornamentPath(cx, hy, u, loadout.ornament); ctx.fill();
  }
}

export function drawStacks(W, u) {
  for (const sx of [W * .115, W * .885]) {
    ctx.fillStyle = chromeGrad(sx - 1.4 * u, sx + 1.4 * u); ctx.fillRect(sx - 1.4 * u, 20 * u, 2.8 * u, 42 * u);
    ctx.fillStyle = '#c9ced3'; ctx.fillRect(sx - 1.8 * u, 30 * u, 3.6 * u, .8 * u); ctx.fillRect(sx - 1.8 * u, 46 * u, 3.6 * u, .8 * u);
    ctx.fillStyle = '#20252a'; ctx.beginPath(); ctx.ellipse(sx, 20 * u, 1.4 * u, .6 * u, 0, 0, 7); ctx.fill();
  }
}
