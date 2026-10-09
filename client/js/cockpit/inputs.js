import { ctx, view } from './canvas.js';
import { uiBtns } from './common.js';
import { MONO } from '../util.js';
import { CONTROLS, DASH, CAP, CLUSTER, inputLights } from '../input-bits.js';

/* A replay's input display (the watch page only – inputLights.on): every control the driver used lights up with a FLASHING YELLOW BORDER.
   A dash control (HEAD, WIPER, the key, PARK, the radio…) is outlined where it sits – a click also gets a pointer + a ring; a keyboard control gets a key cap
   in the corner of the windscreen: the driving cluster (Q W E / A S D / ⇧) is always there, dim until pressed; the other keys appear while they glow.
   The lights come from input-bits.js (watch.js feeds them from the recording); positions from uiBtns, rebuilt by this frame's dash. */
const YELLOW = '255,214,10', IDX = Object.fromEntries(CONTROLS.map((c, i) => [c, i]));
const OTHER = CONTROLS.filter(c => !CLUSTER.includes(c) && CAP[c]);   // the keys shown only while lit, in this order
const alphaOf = (lit, now) => (lit >= 1 ? (Math.floor(now / 110) % 2 ? .45 : 1) : lit);   // held = flashing, released = fading out

function border(x, y, w, h, r, a, u) {
  ctx.save(); ctx.globalAlpha = a; ctx.shadowColor = `rgb(${YELLOW})`; ctx.shadowBlur = 2.2 * u;
  ctx.strokeStyle = `rgb(${YELLOW})`; ctx.lineWidth = .55 * u; ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.stroke(); ctx.restore();
}
function cap(label, x, y, w, h, lit, now, u) {
  ctx.fillStyle = lit > 0 ? `rgba(${YELLOW},${.18 * lit})` : 'rgba(10,9,8,.55)'; ctx.beginPath(); ctx.roundRect(x, y, w, h, .7 * u); ctx.fill();
  ctx.strokeStyle = 'rgba(189,181,157,.45)'; ctx.lineWidth = .2 * u; ctx.stroke();
  ctx.fillStyle = lit > 0 ? `rgb(${YELLOW})` : 'rgba(189,181,157,.7)'; ctx.font = `bold ${1.9 * u}px ${MONO}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(label, x + w / 2, y + h / 2 + .1 * u);
  if (lit > 0) border(x - .3 * u, y - .3 * u, w + .6 * u, h + .6 * u, .9 * u, alphaOf(lit, now), u);
}
function pointer(x, y, a, ring, u) {   // a click: an arrow cursor on the button + a ring spreading from it
  ctx.save(); ctx.globalAlpha = a; ctx.translate(x, y); ctx.fillStyle = `rgb(${YELLOW})`; ctx.strokeStyle = '#111'; ctx.lineWidth = .25 * u;
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, 3.6 * u); ctx.lineTo(.95 * u, 2.7 * u); ctx.lineTo(1.7 * u, 4.2 * u); ctx.lineTo(2.3 * u, 3.9 * u); ctx.lineTo(1.6 * u, 2.45 * u); ctx.lineTo(2.8 * u, 2.4 * u); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.strokeStyle = `rgb(${YELLOW})`; ctx.lineWidth = .35 * u; ctx.globalAlpha = a * ring; ctx.beginPath(); ctx.arc(0, 0, (1 + (1 - ring) * 3.5) * u, 0, 7); ctx.stroke(); ctx.restore();
}

export function drawInputs(L = inputLights) {
  if (!L.on) return;
  const { W, H, DPR } = view, u = Math.min(H / 100, W / 150), now = performance.now();
  ctx.save(); ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  for (const c of CONTROLS) {   // dash controls: outlined where they are
    const i = IDX[c], lit = Math.max(L.key[i], L.mouse[i]); if (lit <= 0 || !DASH[c].length) continue;
    for (const b of uiBtns) if (DASH[c].includes(b.id)) {
      border(b.x - .6 * u, b.y - .6 * u, b.w + 1.2 * u, b.h + 1.2 * u, 1.1 * u, alphaOf(lit, now), u);
      if (L.mouse[i] > 0) pointer(b.x + b.w * .62, b.y + b.h * .55, alphaOf(L.mouse[i], now), L.mouse[i], u);
    }
  }
  const s = 4.4 * u, g = .7 * u, x0 = W * .12 + 2 * u, y0 = 44 * u;   // the key caps: lower left of the windscreen, clear of the mirror and the hood
  CLUSTER.slice(0, 6).forEach((c, k) => cap(CAP[c], x0 + (k % 3) * (s + g), y0 + Math.floor(k / 3) * (s + g), s, s, L.key[IDX[c]], now, u));
  cap('⇧ CLUTCH', x0, y0 + 2 * (s + g), 3 * s + 2 * g, s, L.key[IDX.clutch], now, u);
  let x = x0 + 3 * (s + g) + g;
  for (const c of OTHER) { const lit = L.key[IDX[c]]; if (lit <= 0) continue; const w = CAP[c].length > 1 ? s * 1.6 : s; cap(CAP[c], x, y0 + 2 * (s + g), w, s, lit, now, u); x += w + g; }
  ctx.restore();
}
