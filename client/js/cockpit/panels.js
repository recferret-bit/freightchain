import { ctx } from './canvas.js';
import { litRect, uiBtns, uiButton } from './primitives.js';
import { ledBar } from './gauges.js';
import { lamp, strainLamp, brakeLamp, batLamp, stallLamp, heatButton, coldButton } from './lamps.js';
import { ignitionPanel } from './ignition.js';
import { radioPanel } from './radio-panel.js';
import { wip } from './windscreen.js';
import { st, dn, coldK } from '../state.js';
import { MONO } from '../util.js';
import { online } from '../online.js';

/* Left warning/LED panel, park brake valve, share button, 2x2 switch grid, and right control panel components. */

export function drawLeftPanel(cx, u, off, pw) {
  const lx = cx - 72 * u;
  lamp(lx, 64 * u, 'STALL', stallLamp(), '#d22', u); lamp(lx + 13.5 * u, 64 * u, 'COLD', coldK() > .2, '#3a8fe0', u, 9.5);
  strainLamp(lx + 13.5 * u, 68.8 * u, u, 9.5); lamp(lx, 68.8 * u, 'OFF ROAD', off, '#e80', u);
  brakeLamp(lx + 13.5 * u, 73.6 * u, u, 9.5); lamp(lx, 73.6 * u, 'OVER-REV', st.overrev, '#d22', u);
  lamp(lx, 78.4 * u, 'GRIND', st.grind > 0, '#e80', u); batLamp(lx + 13.5 * u, 78.4 * u, u, 9.5);
  ledBar(lx + .5 * u, 84 * u, 3.2 * u, 12 * u, pw ? st.clutch : 0, '#4a8fd8', 'CLU', u);
  ledBar(lx + 5 * u, 84 * u, 3.2 * u, 12 * u, pw ? st.brake : 0, '#e0503f', 'BRK', u);
  ledBar(lx + 9.5 * u, 84 * u, 3.2 * u, 12 * u, pw ? st.gas : 0, '#6ecf5a', 'GAS', u);
  ledBar(lx + 14 * u, 84 * u, 3.2 * u, 12 * u, pw ? st.hull / 100 : 0, st.hull > 50 ? '#6ecf5a' : st.hull > 25 ? '#e0a03f' : '#e0503f', 'HUL', u);
}

export function drawParkValve(px, vy, u, btn) {
  uiBtns.push({ id: btn?.id || 'park', x: px - 3.6 * u, y: vy - 3.6 * u, w: 7.2 * u, h: 10.4 * u });
  ctx.fillStyle = st.park ? '#ff3a2a' : '#6b1f1a'; ctx.beginPath();
  for (let i = 0; i < 8; i++) { const an = Math.PI / 8 + i * Math.PI / 4; ctx.lineTo(px + Math.cos(an) * 3.4 * u, vy + Math.sin(an) * 3.4 * u); }
  ctx.closePath(); ctx.fill(); ctx.strokeStyle = '#222'; ctx.lineWidth = .3 * u; ctx.stroke();
  ctx.fillStyle = st.park ? '#ffe9e4' : '#c9a29c'; ctx.font = `bold ${4.4 * u}px ${MONO}`;
  const tb = ctx.textBaseline; ctx.textBaseline = 'middle'; ctx.fillText('P', px, vy + .2 * u); ctx.textBaseline = tb;
  ctx.fillStyle = st.park ? '#ff8a7a' : '#9d957f'; ctx.font = `${1.5 * u}px ${MONO}`; ctx.fillText('PARK', px, vy + 5.2 * u);
}

export function drawShareButton(px, u, btn) {
  if (!online.ride && !st.watch) return;   // a replay shows it too: the driver's click on it lights up
  const sx = px - 3.6 * u, sy = 94.5 * u, sw = 7.2 * u, sh = 4.6 * u;
  uiBtns.push({ id: btn?.id || 'share-x', x: sx, y: sy, w: sw, h: sh });
  litRect(sx - .2 * u, sy - .2 * u, sw + .4 * u, sh + .4 * u);
  ctx.fillStyle = '#0c0b09'; ctx.beginPath(); ctx.roundRect(sx, sy, sw, sh, .8 * u); ctx.fill();
  const sg = ctx.createLinearGradient(sx, sy, sx + sw, sy + sh);
  sg.addColorStop(0, '#9945FF'); sg.addColorStop(1, '#14F195');
  ctx.strokeStyle = sg; ctx.lineWidth = .35 * u; ctx.stroke();
  const tb = ctx.textBaseline; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#fff'; ctx.font = `bold ${1.9 * u}px sans-serif,${MONO}`; ctx.textAlign = 'center';
  ctx.fillText('𝕏', sx + sw / 2, sy + 1.6 * u);
  ctx.fillStyle = '#14F195'; ctx.font = `bold ${1.0 * u}px ${MONO}`;
  ctx.fillText(btn?.label || 'POST', sx + sw / 2, sy + 3.4 * u);
  ctx.textBaseline = tb;
}

export function drawSwitchGrid(cx, u, btns) {
  const bw = 8.4 * u, bh = 4 * u, gx = cx - 48 * u, gy = 90.8 * u, gap = .8 * u;   // 2x2 switch grid left of the wheel
  uiButton(btns?.head?.id || 'head', btns?.head?.label || 'HEAD', gx, gy, bw, bh, u, dn.head);
  uiButton(btns?.cab?.id || 'cab', btns?.cab?.label || 'CAB', gx + bw + gap, gy, bw, bh, u, dn.cab);
  heatButton(gx, gy + bh + gap, bw, bh, u, btns?.heat);
  coldButton(gx + bw + gap, gy + bh + gap, bw, bh, u, btns?.cold);
}

export function drawRightPanel(cx, u, pw, btns) {
  const rx = cx + 50 * u, px = rx + 6.25 * u;
  ctx.fillStyle = '#161513'; ctx.beginPath(); ctx.roundRect(rx, 64 * u, 22 * u, 10 * u, 1 * u); ctx.fill(); ctx.strokeStyle = '#3a362f'; ctx.lineWidth = .3 * u; ctx.stroke();
  radioPanel(rx, u, pw, btns);
  uiButton(btns?.wiper?.id || 'wiper', wip.mode ? 'WIPER ' + wip.mode : (btns?.wiper?.label || 'WIPER'), rx + 1.5 * u, 76 * u, 9.5 * u, 5 * u, u, wip.mode > 0);
  uiButton(btns?.wash?.id || 'wash', btns?.wash?.label || 'WASH', rx + 11.5 * u, 76 * u, 9.5 * u, 5 * u, u, st.washing);
  drawParkValve(px, 86.5 * u, u, btns?.park);
  drawShareButton(px, u, btns?.share);
  ignitionPanel(cx + 37 * u, 96.2 * u, u * .78);   // scaled down so the ON zone stays inside the dash panel border
  drawSwitchGrid(cx, u, btns);
}
