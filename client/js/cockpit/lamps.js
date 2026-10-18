import { look } from '../cosmetics.js';
import { ctx } from './canvas.js';
import { st, powered, bulbCheck } from '../state.js';
import { CFG } from '../config.js';
import { hint } from '../guide.js';
import { litRect, uiButton } from './primitives.js';

/* Warning indicator lamps and climate switches. */

/* STALL lamp: blinks while the engine is lugging and just after a stall, steady while it is off */
export function stallLamp() { const b = Math.floor(performance.now() / 130) % 2 === 0; return st.stall > .05 ? b : st.engineOn ? st.lug > .15 && b : true; }

export function lamp(x, y, text, on, col, u, w = 13) {
  on = (on && powered()) || bulbCheck();   // dead with the key OFF; bulb check at key-on
  const bezel = look('indicator').bezel;   // amber is #2a2622, the off housing the cab already drew – the lit colour and the blink stay
  litRect(x - .2 * u, y - .2 * u, (w + .4) * u, 4.6 * u); hint(text, x, y, w * u, 4.2 * u);
  ctx.fillStyle = on ? col : bezel; ctx.fillRect(x, y, w * u, 4.2 * u);
  ctx.fillStyle = on ? '#fff' : '#5c564b'; ctx.font = `${2.4 * u}px ui-monospace,Menlo,monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, x + w / 2 * u, y + 2.2 * u);
}

/* Two-stage warning lamp: steady amber above `warnAt`, blinking red at or above `critAt`. */
export function warnLamp(x, y, text, val, warnAt, critAt, u, w) {
  const crit = val >= critAt;
  lamp(x, y, text, val > warnAt && (!crit || Math.floor(st.t * 6) % 2 === 0), crit ? '#d22' : '#e80', u, w);
}
export const strainLamp = (x, y, u, w) => warnLamp(x, y, 'STRAIN', st.strain, .15, .6, u, w);
export const brakeLamp = (x, y, u, w) => warnLamp(x, y, 'BRAKES', st.brakeT, .25, .6, u, w);
export const batLamp = (x, y, u, w) => warnLamp(x, y, 'BAT', powered() ? 1 - st.batt / CFG.BATT.LOW : 0, 0, .5, u, w);

/* climate switch: lit while on, and a small bar under the label shows how strong the air actually is (heat follows the engine temperature, cold follows the compressor) */
function climateBar(x, y, w, h, u, eff, hot) {
  ctx.fillStyle = '#1a1713'; ctx.fillRect(x + .8 * u, y + h - 1.1 * u, w - 1.6 * u, .6 * u);
  ctx.fillStyle = hot ? (eff > .5 ? '#ff9a3a' : eff > .12 ? '#d8b04a' : '#4a8fd8') : (eff > .5 ? '#3aa0ff' : eff > .12 ? '#7ec8e8' : '#4a8fd8');
  ctx.fillRect(x + .8 * u, y + h - 1.1 * u, Math.max(.4 * u, (w - 1.6 * u) * eff), .6 * u);
}
export function climateButton(id, label, x, y, w, h, u, on, eff, hot) {
  const active = on && powered();
  uiButton(id, label, x, y, w, h, u, active);
  if (active) climateBar(x, y, w, h, u, eff, hot);
}
export const heatButton = (x, y, w, h, u, btn) => climateButton(btn?.id || 'heat', btn?.label || 'HEAT', x, y, w, h, u, st.heater, st.heatEff, true);
export const coldButton = (x, y, w, h, u, btn) => climateButton(btn?.id || 'cold', btn?.label || 'COLD', x, y, w, h, u, st.cooler, st.coolEff, false);
