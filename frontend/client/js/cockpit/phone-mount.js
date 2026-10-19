import { ctx } from './canvas.js';
import { uiBtns } from './primitives.js';
import { dn } from '../state.js';
import { look, loadout } from '../cosmetics.js';
import { phone } from '../phone.js';

/* Dash phone mount component, right of the bonnet (the map – ui/map.js): its screen shows the live map; a click (or N) takes it in hand. */
let thumbBroke = false;

export function drawPhoneMount(x, y, w, h, u, btns) {
  uiBtns.push({ id: btns?.map.id || 'map', x: x - u, y: y - 3 * u, w: w + 2 * u, h: h + 4 * u });   // the phone + its caption above it
  ctx.fillStyle = '#121110'; ctx.fillRect(x + w / 2 - 1.2 * u, y + h - .5 * u, 2.4 * u, 3.5 * u);   // the mount's stem into the dash
  ctx.fillStyle = '#1b1a18'; ctx.beginPath(); ctx.roundRect(x - .9 * u, y + h * .3, 1.4 * u, h * .4, .5 * u); ctx.roundRect(x + w - .5 * u, y + h * .3, 1.4 * u, h * .4, .5 * u); ctx.fill();   // the clamp's arms
  /* the same phone as the one in your hand (ui/map.js + css #phone): a dark metal frame, a rounded screen, the camera island with its lens.
     black keeps that gradient and stroke; any other phone only recolors the frame. The screen, camera and click target stay. */
  if (loadout.phone === 'black') {
    const fr = ctx.createLinearGradient(x, y, x + w, y + h); fr.addColorStop(0, '#2b2d31'); fr.addColorStop(.6, '#0d0e10');
    ctx.fillStyle = fr; ctx.beginPath(); ctx.roundRect(x, y, w, h, w * .15); ctx.fill();
    ctx.strokeStyle = phone.open ? '#4285f4' : '#45484e'; ctx.lineWidth = .3 * u; ctx.stroke();
  } else {
    const ph = look('phone');
    ctx.fillStyle = ph.frame; ctx.beginPath(); ctx.roundRect(x, y, w, h, w * .15); ctx.fill();
    ctx.strokeStyle = phone.open ? '#4285f4' : ph.edge; ctx.lineWidth = .3 * u; ctx.stroke();
  }
  const ins = w * .05, sx = x + ins, sy = y + ins, sw = w - 2 * ins, sh = h - 2 * ins;
  ctx.save(); ctx.beginPath(); ctx.roundRect(sx, sy, sw, sh, w * .11); ctx.clip();
  if (phone.open) { ctx.fillStyle = '#05070a'; ctx.fillRect(sx, sy, sw, sh); }   // it is in your hand: the mount is empty-ish (the screen dark)
  else if (phone.thumb && !thumbBroke) {
    try { phone.thumb(ctx, sx, sy, sw, sh); } catch (e) { thumbBroke = true; console.warn('phone map:', e); }   // a map bug must not take the rest of the cockpit with it (it then shows the still picture)
  } else { ctx.fillStyle = '#e8e4da'; ctx.fillRect(sx, sy, sw, sh); ctx.strokeStyle = '#4285f4'; ctx.lineWidth = .8 * u; ctx.beginPath(); ctx.moveTo(sx + sw * .5, sy + sh); ctx.quadraticCurveTo(sx + sw * .2, sy + sh * .5, sx + sw * .6, sy); ctx.stroke(); }
  ctx.restore();
  const iw = sw * .34, ih = Math.max(.75 * u, sh * .036), ix = x + w / 2 - iw / 2, iy = sy + sh * .012;   // the camera island: slot, sensor, main lens (blue glass + a glint)
  ctx.fillStyle = '#000'; ctx.beginPath(); ctx.roundRect(ix, iy, iw, ih, ih / 2); ctx.fill();
  ctx.fillStyle = '#23252b'; ctx.beginPath(); ctx.roundRect(ix + iw * .14, iy + ih * .4, iw * .26, ih * .2, ih * .1); ctx.fill();
  ctx.fillStyle = '#27324d'; ctx.beginPath(); ctx.arc(ix + iw * .6, iy + ih / 2, ih * .15, 0, 7); ctx.fill();
  const lx = ix + iw * .82, ly = iy + ih / 2; ctx.fillStyle = '#3a3f4d'; ctx.beginPath(); ctx.arc(lx, ly, ih * .4, 0, 7); ctx.fill();
  ctx.fillStyle = '#1f4fb0'; ctx.beginPath(); ctx.arc(lx, ly, ih * .3, 0, 7); ctx.fill(); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(lx - ih * .08, ly - ih * .09, ih * .07, 0, 7); ctx.fill();
  if (dn.k > .3 && !phone.open && phone.power > 0) { ctx.fillStyle = `rgba(120,170,255,${.06 * dn.k})`; ctx.beginPath(); ctx.arc(x + w / 2, y + h / 2, w * 1.1, 0, 7); ctx.fill(); }   // the screen's glow in the dark cab
}
