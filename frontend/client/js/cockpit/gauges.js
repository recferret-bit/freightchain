import { look } from '../cosmetics.js';
import { ctx } from './canvas.js';
import { powered } from '../state.js';
import { clamp, MONO } from '../util.js';
import { CFG } from '../config.js';
import { hint } from '../guide.js';
import { litRect, litCircle, chromeGrad } from './primitives.js';

/* Primary dial (speedometer / tachometer), auxiliary mini-gauges, and vertical LED bar meters. */

export function gauge(cx, cy, r, val, max, step, redFrom, label, u) {
  litCircle(cx, cy, r + .5 * u); hint(label, cx - r, cy - r, 2 * r, 2 * r);
  const a0 = Math.PI * 0.75, sw = Math.PI * 1.5;
  const bg = ctx.createRadialGradient(cx, cy - r * .3, r * .1, cx, cy, r); bg.addColorStop(0, '#26231f'); bg.addColorStop(1, '#0b0a09');
  ctx.fillStyle = bg; ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7); ctx.fill();
  ctx.lineWidth = u * .6; ctx.strokeStyle = '#555049'; ctx.stroke();
  ctx.font = `${r * .17}px ui-monospace,Menlo,monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const n = Math.round(max / step);
  for (let i = 0; i <= n; i++) {
    const v = i * step, an = a0 + sw * v / max, red = redFrom && v >= redFrom;
    ctx.strokeStyle = red ? '#ff4a3a' : '#e8e2cf'; ctx.lineWidth = u * .35;
    ctx.beginPath(); ctx.moveTo(cx + Math.cos(an) * r * .78, cy + Math.sin(an) * r * .78); ctx.lineTo(cx + Math.cos(an) * r * .92, cy + Math.sin(an) * r * .92); ctx.stroke();
    ctx.fillStyle = red ? '#ff6a58' : '#e8e2cf'; ctx.fillText(label === 'RPM×100' ? v / 100 : v, cx + Math.cos(an) * r * .62, cy + Math.sin(an) * r * .62);
  }
  ctx.fillStyle = '#9d957f'; if (label === 'RPM×100') { ctx.font = `${r * .12}px ui-monospace,Menlo,monospace`; ctx.fillText(label, cx, cy + r * .5); } else ctx.fillText(label, cx, cy + r * .45);
  const isRpm = label === 'RPM×100', pw = powered();
  let k = 0;   // 0..1 how deep into the max-rev zone: the needle trembles instead of sitting on the stop
  if (isRpm && redFrom) {
    k = clamp((val - CFG.STRAIN_RPM * redFrom) / ((1 - CFG.STRAIN_RPM) * redFrom), 0, 1);
    const t = performance.now() / 1000;
    val += k * CFG.RPM_JITTER * (.5 * Math.sin(t * 47) + .3 * Math.sin(t * 83 + 1) + (Math.random() - .5) * 1.1);
  }
  if (isRpm && redFrom && pw) {   // red band over the redline zone, glowing as the needle enters it
    ctx.save(); ctx.lineCap = 'butt'; ctx.lineWidth = r * .07; ctx.strokeStyle = `rgba(255,74,58,${.55 + .45 * k})`;
    if (k > 0) { ctx.shadowColor = '#ff3a2a'; ctx.shadowBlur = r * .5 * k; }
    ctx.beginPath(); ctx.arc(cx, cy, r * .96, a0 + sw * redFrom / max, a0 + sw); ctx.stroke(); ctx.restore();
  }
  const an = a0 + sw * clamp(val / max, 0, 1.03);
  ctx.save(); ctx.lineCap = 'round';
  if (isRpm) { ctx.shadowColor = k > 0 ? '#ff4a2a' : 'rgba(0,0,0,.6)'; ctx.shadowBlur = k > 0 ? r * (.2 + .3 * k) : r * .08; ctx.shadowOffsetY = k > 0 ? 0 : r * .03; }
  ctx.strokeStyle = k > .3 ? '#ff5a3a' : look('needle').color; ctx.lineWidth = u * .55;   // (the over-rev warning stays red whatever the needle colour)
  ctx.beginPath(); ctx.moveTo(cx - Math.cos(an) * r * .12, cy - Math.sin(an) * r * .12); ctx.lineTo(cx + Math.cos(an) * r * .8, cy + Math.sin(an) * r * .8); ctx.stroke(); ctx.restore();
  ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(cx, cy, r * .09, 0, 7); ctx.fill();
}

export function miniGauge(x, y, r, f, f2, label, lo, hi, u, red) {
  litCircle(x, y, r + .4 * u); hint(label, x - r, y - r, 2 * r, 2 * r);
  const bg = ctx.createRadialGradient(x, y - r * .3, r * .1, x, y, r); bg.addColorStop(0, '#25221e'); bg.addColorStop(1, '#080706');
  ctx.fillStyle = bg; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
  ctx.strokeStyle = chromeGrad(x - r, x + r); ctx.lineWidth = u * .45; ctx.stroke();
  const a0 = Math.PI * .75, sw = Math.PI * 1.5;
  for (let i = 0; i <= 4; i++) { const an = a0 + sw * i / 4; ctx.strokeStyle = (red && i / 4 >= red) ? '#ff5040' : '#e8e2cf'; ctx.lineWidth = u * .25; ctx.beginPath(); ctx.moveTo(x + Math.cos(an) * r * .7, y + Math.sin(an) * r * .7); ctx.lineTo(x + Math.cos(an) * r * .9, y + Math.sin(an) * r * .9); ctx.stroke(); }
  ctx.fillStyle = '#bdb59d'; ctx.font = `${r * .34}px ${MONO}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(lo, x - r * .55, y + r * .72); ctx.fillText(hi, x + r * .55, y + r * .72); ctx.fillText(label, x, y + r * .36);
  const needle = (ff, col) => { const an = a0 + sw * clamp(ff, 0, 1); ctx.strokeStyle = col; ctx.lineWidth = u * .35; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(an) * r * .78, y + Math.sin(an) * r * .78); ctx.stroke(); };
  if (f2 != null) needle(f2, '#e8e2cf'); needle(f, look('needle').color);
  ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(x, y, r * .12, 0, 7); ctx.fill();
}

export function ledBar(x, y, w, h, val, col, label, u) {
  const n = 10, sh = h / n; litRect(x - .3 * u, y, w + .6 * u, h + 3 * u); hint(label, x - .3 * u, y, w + .6 * u, h + 3 * u);   // + the label
  for (let i = 0; i < n; i++) { ctx.fillStyle = val > (i + .5) / n ? col : '#1c1915'; ctx.fillRect(x, y + h - (i + 1) * sh + .3 * u, w, sh - .6 * u); }
  ctx.fillStyle = '#9d957f'; ctx.font = `${1.7 * u}px ${MONO}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(label, x + w / 2, y + h + 1.8 * u);
}
