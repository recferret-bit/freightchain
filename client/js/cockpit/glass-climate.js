import { ctx } from './canvas.js';
import { st, dn, weather } from '../state.js';
import { CFG } from '../config.js';
import { ambientC, fogDrive } from '../sim/climate.js';
import { rnd } from '../util.js';

/* Frost (cold) and fog (warm) on the windscreen glass.
   Each is a coarse grid (FW×FH cells) of thickness 0..1. Frost grows from the edges below freezing (wind chill, snow) and is melted by the cab heater
   from the defrost vents (bottom centre) outwards, as warm as the engine is (st.heatEff). Fog grows the same way on a warm route while cooling is off,
   and the cooler clears it the same way once the compressor is spinning (st.coolEff). The glass starts clear in the warm and partly frosted below freezing.
   Wipers and the washer do not touch either. Drawn through offscreen canvases: blobs = the thickness mask, filled with a crystal texture (frost) or a milky
   haze (fog), darkened at night so neither glows on a dark world. */
export const GW = 512, GH = 256;
const FW = 48, FH = 24, frost = new Float32Array(FW * FH), fog = new Float32Array(FW * FH), fjit = Float32Array.from(frost, (_, i) => .8 + .4 * rnd(i * 1.7));
const fcv = document.createElement('canvas'); fcv.width = GW; fcv.height = GH; const fctx = fcv.getContext('2d');
const gcv = document.createElement('canvas'); gcv.width = GW; gcv.height = GH; const gctx2 = gcv.getContext('2d');
const blob = document.createElement('canvas'); blob.width = blob.height = 32;
{ const b = blob.getContext('2d'), g = b.createRadialGradient(16, 16, 0, 16, 16, 16); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(.55, 'rgba(255,255,255,.7)'); g.addColorStop(1, 'rgba(255,255,255,0)'); b.fillStyle = g; b.fillRect(0, 0, 32, 32); }
const ftex = document.createElement('canvas'); ftex.width = GW; ftex.height = GH;
{ const t = ftex.getContext('2d'); t.fillStyle = 'rgba(214,230,244,.82)'; t.fillRect(0, 0, GW, GH);
  for (let i = 0; i < 1400; i++) { t.fillStyle = `rgba(255,255,255,${.08 + Math.random() * .22})`; t.beginPath(); t.arc(Math.random() * GW, Math.random() * GH, .6 + Math.random() * 2.4, 0, 7); t.fill(); }
  t.lineCap = 'round'; t.strokeStyle = 'rgba(255,255,255,.75)';
  const fern = (x, y, a, len, w) => { if (len < 3) return; const x2 = x + Math.cos(a) * len, y2 = y + Math.sin(a) * len; t.lineWidth = w; t.beginPath(); t.moveTo(x, y); t.lineTo(x2, y2); t.stroke(); for (const k of [-1, 1]) fern(x + Math.cos(a) * len * .55, y + Math.sin(a) * len * .55, a + k * (.7 + Math.random() * .3), len * .45, w * .7); fern(x2, y2, a + (Math.random() - .5) * .4, len * .6, w * .8); };
  for (let i = 0; i < 70; i++) fern(Math.random() * GW, Math.random() * GH, Math.random() * 6.3, 14 + Math.random() * 22, 1.1); }
const fogTex = document.createElement('canvas'); fogTex.width = GW; fogTex.height = GH;
{ const t = fogTex.getContext('2d'); t.fillStyle = 'rgba(236,240,244,.8)'; t.fillRect(0, 0, GW, GH);   // milky condensation, not ice. rnd() so this does not consume Math.random (the headless trace's seed)
  for (let i = 0; i < 70; i++) { const x = rnd(i * 3.1) * GW, y = rnd(i * 5.7) * GH, r = 28 + rnd(i * 9.2) * 80, g = t.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, `rgba(255,255,255,${.12 + rnd(i * 1.3) * .22})`); g.addColorStop(1, 'rgba(255,255,255,0)'); t.fillStyle = g; t.beginPath(); t.arc(x, y, r, 0, 7); t.fill(); } }

let fAcc = 0, gAcc = 0, frostSum = 0, fogSum = 0;
const edgeOf = (x, y) => Math.pow(Math.max(Math.abs((x + .5) / FW * 2 - 1), Math.abs((y + .5) / FH * 2 - 1)), 2);
const ventOf = (x, y) => Math.max(0, 1 - Math.hypot(((x + .5) / FW * 2 - 1) * .9, (1 - (y + .5) / FH) * 1.1) / 1.8);
function frostDrive() { const chill = ambientC() - st.v * .12; return chill > -1 ? 0 : Math.min(1.3, (-chill - 1) / 22) * (1 + weather.snow * .4); }   // 0 above freezing .. ~1 at -25 °C

function glassStep(grid, dt, grow, clear, extra = 0) {
  let sum = 0;
  for (let y = 0; y < FH; y++) for (let x = 0; x < FW; x++) {
    const i = y * FW + x;
    const v = grid[i] + (grow * (.3 + .7 * edgeOf(x, y)) * fjit[i] - clear * (.45 + .55 * ventOf(x, y)) - extra) * dt;
    sum += grid[i] = v < 0 ? 0 : v > 1 ? 1 : v;
  }
  return sum;
}

export function resetGlass() {
  const d = frostDrive();
  for (let y = 0; y < FH; y++) for (let x = 0; x < FW; x++) frost[y * FW + x] = Math.min(1, d * .6 * (.25 + .75 * edgeOf(x, y)) * fjit[y * FW + x]);
  frostSum = frost.reduce((a, b) => a + b, 0); fog.fill(0); fogSum = 0; fAcc = 1; gAcc = 1;
}

export function frostStep(dt) {
  const amb = ambientC(), thaw = amb > 1 ? CFG.FROST_THAW * Math.min(1, amb / 10) : 0;
  frostSum = glassStep(frost, dt, CFG.FROST_RATE * frostDrive(), st.heatEff * CFG.FROST_MELT, thaw);
}

export function fogStep(dt) { fogSum = glassStep(fog, dt, CFG.FOG_RATE * fogDrive(), st.coolEff * CFG.FOG_CLEAR); }

function composeGlass(cx, grid, tex) {
  cx.globalCompositeOperation = 'source-over'; cx.clearRect(0, 0, GW, GH);
  const cw = GW / FW, ch = GH / FH;
  for (let y = 0; y < FH; y++) for (let x = 0; x < FW; x++) { const v = grid[y * FW + x]; if (v < .06) continue; cx.globalAlpha = Math.min(1, (v - .04) * 1.7); cx.drawImage(blob, (x + .5) * cw - cw * 1.8, (y + .5) * ch - ch * 1.8, cw * 3.6, ch * 3.6); }
  cx.globalAlpha = 1; cx.globalCompositeOperation = 'source-in'; cx.drawImage(tex, 0, 0);
  if (dn.k > .02) { cx.globalCompositeOperation = 'source-atop'; cx.fillStyle = `rgba(6,10,20,${.78 * dn.k})`; cx.fillRect(0, 0, GW, GH); }
  cx.globalCompositeOperation = 'source-over';
}

export function drawGlassClimate(dt, W, gh) {
  if (fogSum > .5) { if ((gAcc += dt) > .1) { gAcc = 0; composeGlass(gctx2, fog, fogTex); } const a = ctx.globalAlpha; ctx.globalAlpha = CFG.FOG_HAZE; ctx.drawImage(gcv, 0, 0, GW, GH, 0, 0, W, gh); ctx.globalAlpha = a; }   // warm-route fog, half as milky (re-composed at 10 Hz)
  if (frostSum > .5) { if ((fAcc += dt) > .1) { fAcc = 0; composeGlass(fctx, frost, ftex); } ctx.drawImage(fcv, 0, 0, GW, GH, 0, 0, W, gh); }   // frost on the glass (re-composed at 10 Hz)
}

/** mean thickness 0..1 of the two grids, for the headless check and the console */
export const screenClimate = () => ({ frost: frostSum / frost.length, fog: fogSum / fog.length });
