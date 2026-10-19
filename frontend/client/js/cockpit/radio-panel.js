import { ctx } from './canvas.js';
import { MONO } from '../util.js';
import { radio } from '../sim/radio.js';
import { litRect, uiButton } from './primitives.js';

/* Dash radio (inside the panel rig.js draws at rx, 64u): LCD with frequency + scrolling song title, ‹ PWR › buttons. */
export function radioPanel(rx, u, pw, btns) {
  const on = radio.on && pw, S = radio.station;
  ctx.fillStyle = pw ? '#0d2410' : '#0a170c'; ctx.fillRect(rx + 1.5 * u, 65.2 * u, 19 * u, 4.6 * u); litRect(rx + 1.5 * u, 65.2 * u, 19 * u, 4.6 * u);
  if (pw) {
    ctx.fillStyle = on ? '#7cff7c' : '#2f6a2f'; ctx.font = `${1.7 * u}px ${MONO}`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(on ? S.freq.toFixed(1) + ' ' + S.short : 'RADIO OFF', rx + 2 * u, 66.5 * u);
    if (on) { const t = (radio.nowPlaying() || '') + '   ♪   ', n = 17, o = Math.floor(performance.now() / 260) % t.length, w = (t + t).slice(o, o + n); ctx.fillText(w, rx + 2 * u, 68.5 * u); }
    ctx.textAlign = 'center';
  }
  uiButton(btns?.prev?.id || 'r-prev', btns?.prev?.label || '‹', rx + 1.5 * u, 70.4 * u, 5.6 * u, 3.2 * u, u, false);
  uiButton(btns?.pwr?.id || 'r-pwr', btns?.pwr?.label || 'PWR', rx + 7.7 * u, 70.4 * u, 6.6 * u, 3.2 * u, u, on);
  uiButton(btns?.next?.id || 'r-next', btns?.next?.label || '›', rx + 14.9 * u, 70.4 * u, 5.6 * u, 3.2 * u, u, false);
}
