import { ctx } from './canvas.js';
import { MONO } from '../util.js';

/* Backlit instrument areas (screen px, before the shake translate – like uiBtns), rebuilt every frame; nightGrade() keeps them out of the night veil while the cab light is on. */
export const litShapes = [];
export const litRect = (x, y, w, h) => litShapes.push({ x, y, w, h });
export const litCircle = (x, y, r) => litShapes.push({ x, y, r });

export function chromeGrad(x0, x1) {
  const g = ctx.createLinearGradient(x0, 0, x1, 0);
  g.addColorStop(0, '#6d737a'); g.addColorStop(.3, '#f2f5f7'); g.addColorStop(.55, '#9aa1a8'); g.addColorStop(1, '#4a4f55');
  return g;
}

/* clickable dash buttons: rebuilt every frame by uiButton(), hit-tested in ui/input.js */
export const uiBtns = [];
export function uiButton(id, label, x, y, w, h, u, on) {
  uiBtns.push({ id, x, y, w, h }); litRect(x - .2 * u, y - .2 * u, w + .4 * u, h + .4 * u);
  ctx.fillStyle = on ? '#2d3a2a' : '#1d1b18'; ctx.beginPath(); ctx.roundRect(x, y, w, h, .8 * u); ctx.fill();
  ctx.strokeStyle = on ? '#7cd66a' : '#4a453b'; ctx.lineWidth = .3 * u; ctx.stroke();
  ctx.fillStyle = on ? '#9dff8a' : '#bdb59d'; ctx.font = `${1.9 * u}px ${MONO}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(label, x + w / 2, y + h / 2);
}
