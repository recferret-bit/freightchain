import { ctx, view } from './canvas.js';
import { uiBtns } from './common.js';
import { guide, BANNER_MS } from '../guide.js';
import { MONO } from '../util.js';

/* The tutorial's and the assist's highlights (guide.js), drawn on top of the dash: a pulsing green frame round every control / indicator named in `guide.tips`
   and a tip bubble beside it ([KEY] + a short sentence). A dash button is found in `uiBtns`, an indicator in `guide.rects` (both rebuilt this frame by the dash).
   Green like the dash's own lit switches (the replay's input borders are yellow). Nothing is drawn when there are no tips (every ride without the tutorial / assist). */
const CY = '124,214,106', MAX_TIPS = 3;

function wrap(text, maxW) {   // greedy word wrap with the current font
  const lines = []; let line = '';
  for (const w of text.split(' ')) { const t = line ? `${line} ${w}` : w; if (line && ctx.measureText(t).width > maxW) { lines.push(line); line = w; } else line = t; }
  if (line) lines.push(line); return lines;
}
const rectsOf = id => [...uiBtns.filter(b => b.id === id), ...guide.rects.filter(r => r.id === id)];

/* the success banner: a green plate that slides in from above, holds, fades – under the dialog, clear of the stall banner (H·.3) */
function drawBanner(u, W, H, now) {
  const b = guide.banner; if (!b) return;
  const t = now - b.at; if (t > BANNER_MS) { guide.banner = null; return; }
  const a = Math.min(1, t / 250, (BANNER_MS - t) / 500), lift = (1 - Math.min(1, t / 250)) * -2 * u, y = H * .275 + lift;
  ctx.save(); ctx.globalAlpha = Math.max(0, a); ctx.font = `bold ${3.3 * u}px ${MONO}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const txt = `✓  ${b.text}`, w = ctx.measureText(txt).width + 9 * u;
  ctx.shadowColor = `rgba(${CY},.6)`; ctx.shadowBlur = 3 * u; ctx.fillStyle = '#1f7a35'; ctx.beginPath(); ctx.roundRect(W / 2 - w / 2, y - 3.4 * u, w, 6.8 * u, 1.4 * u); ctx.fill();
  ctx.shadowBlur = 0; ctx.strokeStyle = '#b6ff9e'; ctx.lineWidth = .35 * u; ctx.stroke(); ctx.fillStyle = '#f2ffe9'; ctx.fillText(txt, W / 2, y + .1 * u); ctx.restore();
}

export function drawGuide() {
  if (guide.banner) { const { W, H, DPR } = view; ctx.save(); ctx.setTransform(DPR, 0, 0, DPR, 0, 0); drawBanner(Math.min(H / 100, W / 150), W, H, performance.now()); ctx.restore(); }
  if (!guide.tips.length) return;
  const { W, H, DPR } = view, u = Math.min(H / 100, W / 150), now = performance.now(), pulse = .65 + .35 * Math.sin(now / 170);
  ctx.save(); ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  const placed = [];
  for (const tip of guide.tips.slice(0, MAX_TIPS)) {
    const rs = rectsOf(tip.id); if (!rs.length) continue;
    for (const r of rs) {   // the frame (a button can be drawn twice, e.g. the CAB switch and the dome lamp)
      ctx.save(); ctx.globalAlpha = pulse; ctx.shadowColor = `rgb(${CY})`; ctx.shadowBlur = 2.6 * u; ctx.strokeStyle = `rgb(${CY})`; ctx.lineWidth = .6 * u;
      ctx.beginPath(); ctx.roundRect(r.x - .8 * u, r.y - .8 * u, r.w + 1.6 * u, r.h + 1.6 * u, 1.2 * u); ctx.stroke(); ctx.restore();
    }
    const r = rs[0], fs = 2.3 * u; ctx.font = `bold ${fs}px ${MONO}`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    const keyW = tip.key ? ctx.measureText(tip.key).width + 2 * u : 0, lines = wrap(tip.text, 30 * u - keyW);
    const bw = Math.min(34 * u, Math.max(...lines.map(l => ctx.measureText(l).width)) + keyW + 4 * u), lh = fs * 1.25, bh = lines.length * lh + 2.4 * u;
    let bx = Math.max(1.5 * u, Math.min(W - bw - 1.5 * u, r.x + r.w / 2 - bw / 2)), by = r.y - bh - 2.2 * u, below = false;   // above the thing, below it when there is no room
    if (by < 1.5 * u) { by = r.y + r.h + 2.2 * u; below = true; }
    for (const p of placed) if (bx < p.x + p.w + u && bx + bw + u > p.x && by < p.y + p.h + u && by + bh + u > p.y) by = below ? p.y + p.h + u : p.y - bh - u;   // two bubbles never overlap
    by = Math.max(1.5 * u, Math.min(H - bh - 1.5 * u, by)); placed.push({ x: bx, y: by, w: bw, h: bh });
    ctx.fillStyle = 'rgba(10,18,10,.92)'; ctx.strokeStyle = `rgb(${CY})`; ctx.lineWidth = .35 * u; ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, 1.2 * u); ctx.fill(); ctx.stroke();
    const ax = Math.max(bx + 2 * u, Math.min(bx + bw - 2 * u, r.x + r.w / 2)), ay = below ? by : by + bh;   // the pointer to the thing
    ctx.fillStyle = `rgb(${CY})`; ctx.beginPath(); ctx.moveTo(ax - 1.1 * u, ay); ctx.lineTo(ax + 1.1 * u, ay); ctx.lineTo(ax, ay + (below ? -1.6 : 1.6) * u); ctx.closePath(); ctx.fill();
    let tx = bx + 1.6 * u; if (tip.key) {   // the key cap
      ctx.fillStyle = `rgb(${CY})`; ctx.beginPath(); ctx.roundRect(tx, by + 1 * u, keyW, 3.2 * u, .7 * u); ctx.fill();
      ctx.fillStyle = '#07140a'; ctx.textAlign = 'center'; ctx.fillText(tip.key, tx + keyW / 2, by + 2.6 * u); ctx.textAlign = 'left'; tx += keyW + 1 * u;
    }
    ctx.fillStyle = '#effae9'; lines.forEach((l, i) => ctx.fillText(l, tx, by + 1.2 * u + lh * (i + .5) + (tip.key && i === 0 ? .4 * u : 0)));
  }
  ctx.restore();
}
