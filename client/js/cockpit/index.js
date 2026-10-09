import { cv, ctx, view } from './canvas.js';
import { uiBtns, litShapes } from './common.js';
import { drawCockpitRig } from './rig.js';
import { st, dn } from '../state.js';
import { CFG } from '../config.js';
import { promptView } from '../prompt.js';
import { drawInputs } from './inputs.js';

/* Night grade of the cab interior. 'source-atop' only paints where the cockpit is already opaque, so the windscreen and the mirror holes stay clear.
   The veil is built on an offscreen canvas so the cab light (dn.cab) can punch the backlit instruments (litShapes) out of it – overlapping shapes just merge –
   and then lifts + warms the rest of the interior from the overhead console. */
const veil = document.createElement('canvas'), vctx = veil.getContext('2d');
const shapePath = (c, list) => { c.beginPath(); for (const s of list) { if (s.r) { c.moveTo(s.x + s.r, s.y); c.arc(s.x, s.y, s.r, 0, 7); } else c.rect(s.x, s.y, s.w, s.h); } };
function nightGrade() {
  const k = dn.k; if (k < .01) return;
  const { W, H, DPR } = view, u = Math.min(H / 100, W / 150), cx = W / 2, a = CFG.CAB_DARK * k * (dn.cab ? .55 : 1);
  if (veil.width !== cv.width || veil.height !== cv.height) { veil.width = cv.width; veil.height = cv.height; }
  vctx.setTransform(DPR, 0, 0, DPR, 0, 0); vctx.globalCompositeOperation = 'source-over'; vctx.clearRect(0, 0, W, H);
  const g = vctx.createRadialGradient(cx, 76 * u, 6 * u, cx, 76 * u, 75 * u);
  g.addColorStop(0, `rgba(3,5,12,${a * .12})`); g.addColorStop(.45, `rgba(3,5,12,${a * .5})`); g.addColorStop(1, `rgba(3,5,12,${a})`);
  vctx.fillStyle = g; vctx.fillRect(0, 0, W, H);
  if (dn.cab) { vctx.globalCompositeOperation = 'destination-out'; shapePath(vctx, litShapes); vctx.fillStyle = '#000'; vctx.fill(); }
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalCompositeOperation = 'source-atop'; ctx.drawImage(veil, 0, 0);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.restore();
}
/* cab lamp wash from the overhead console: full strength at night, CFG.CAB_DAY of it in daylight (source-atop: only the opaque cab interior) */
function cabGlow() {
  if (!dn.cab) return;
  const { W, H, DPR } = view, u = Math.min(H / 100, W / 150), cx = W / 2, k = Math.max(dn.k, CFG.CAB_DAY);
  ctx.save(); ctx.setTransform(DPR, 0, 0, DPR, 0, 0); ctx.globalCompositeOperation = 'source-atop';
  const w = ctx.createRadialGradient(cx, 4 * u, 2 * u, cx, 4 * u, 70 * u); w.addColorStop(0, `rgba(255,205,140,${.62 * k})`); w.addColorStop(1, 'rgba(255,170,90,0)'); ctx.fillStyle = w; ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

/* Dazzle from an oncoming car: a bloom around its lamps (dn.bx/by) + a white veil over everything, fading slowly (dn.blind comes from world/daynight.js). */
function blindEffect() {
  const b = dn.blind; if (b < .02) return;
  const { W, H, DPR } = view, x = dn.bx * W, y = dn.by * H, r = H * (.3 + 1.1 * b);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  const g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, `rgba(255,252,235,${Math.min(1, b * 1.5)})`); g.addColorStop(.25, `rgba(255,240,200,${b * .55})`); g.addColorStop(1, 'rgba(255,230,180,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = `rgba(255,250,235,${b * b * .7})`; ctx.fillRect(0, 0, W, H);
}

/* Draws the semi-truck cockpit + the red impact flash. */

export function drawCockpit() {
  const { W, H, DPR } = view;
  uiBtns.length = 0; litShapes.length = 0;
  drawCockpitRig();
  nightGrade(); cabGlow(); blindEffect();
  drawInputs();   // a replay: the driver's keys and clicks as flashing yellow borders (no-op elsewhere)
  if (st.mode === 'drive') {   // stall / lugging banner
    const blink = Math.floor(performance.now() / 130) % 2 === 0, stalled = st.stalled && !st.engineOn && !st.ign, lug = st.engineOn && st.lug > .25;
    if (stalled || lug) {
      const u = Math.min(H / 100, W / 150), txt = stalled ? (st.stall > .05 ? 'ENGINE STALLED' : 'ENGINE OFF – hold SHIFT, press I') : 'ENGINE LUGGING – clutch in / downshift';
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0); ctx.font = `bold ${3.4 * u}px ui-monospace,Menlo,monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const w = ctx.measureText(txt).width + 6 * u, y = H * .3; ctx.globalAlpha = stalled && st.stall > .05 ? (blink ? 1 : .35) : lug ? (blink ? 1 : .5) : 1;
      ctx.fillStyle = stalled ? '#b3201a' : '#d98a14'; ctx.fillRect(W / 2 - w / 2, y - 3 * u, w, 6 * u); ctx.fillStyle = '#fff'; ctx.fillText(txt, W / 2, y); ctx.globalAlpha = 1;
    }
  }
  const pr = st.mode === 'drive' ? promptView() : null;   // dispatch prompt (online rides only – prompt.js): a banner the driver cannot miss, with the key and the seconds left
  if (pr) {
    const u = Math.min(H / 100, W / 150), y = H * .18, txt = pr.done ? `DISPATCH · ${pr.label} ✓` : `DISPATCH · ${pr.label} · PRESS ${pr.key}`;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0); ctx.font = `bold ${3.2 * u}px ui-monospace,Menlo,monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const w = ctx.measureText(txt).width + 8 * u, blink = !pr.done && pr.left < 5 && Math.floor(performance.now() / 160) % 2 === 0;
    ctx.globalAlpha = blink ? .55 : 1; ctx.fillStyle = pr.done ? '#2f8f4e' : '#d98a14'; ctx.fillRect(W / 2 - w / 2, y - 3.2 * u, w, 6.4 * u);
    if (!pr.done) { ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(W / 2 - w / 2, y + 2.4 * u, w * Math.min(1, pr.left / 18), .8 * u); }   // the time left
    ctx.fillStyle = '#fff'; ctx.fillText(txt, W / 2, y - .3 * u); ctx.globalAlpha = 1;
  }
  if (st.flash > .01) {   // red impact flash
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    const g = ctx.createRadialGradient(W / 2, H / 2, H * .3, W / 2, H / 2, H * .9); g.addColorStop(0, 'rgba(255,40,20,0)'); g.addColorStop(1, `rgba(255,40,20,${st.flash * .55})`);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
}
