import { ctx, view } from './canvas.js';
import { DASH_WIDGET_BTNS } from './common.js';
import { drawScreenLayers, drawBug, drawExhaust } from './windscreen.js';
import { wsPath, drawCabShell, drawMirrors, drawGlassTint, drawHood, drawStacks } from './exterior.js';
import { drawOverhead } from './overhead.js';
import { drawDice } from './dice.js';
import { drawPhoneMount } from './phone-mount.js';
import { drawDashTop, drawBinnacle } from './binnacle.js';
import { drawLeftPanel, drawRightPanel } from './panels.js';
import { drawWheel } from './wheel.js';
import { drawShifter } from './shifter.js';
import { st, powered } from '../state.js';
import { SHAKE_MOVING, engineVib } from '../sim/shake.js';
import { look } from '../cosmetics.js';

/* Conventional long-hood semi cab orchestrator: composes each cabin component in order. */

export const RIG_BTNS = {
  ...DASH_WIDGET_BTNS,
  map:   { id: 'map' },
  cab:   { id: 'cab', label: 'CAB' },
  wiper: { id: 'wiper', label: 'WIPER' },
  wash:  { id: 'wash', label: 'WASH' },
  park:  { id: 'park', label: 'PARK' },
  head:  { id: 'head', label: 'HEAD' },
  share: { id: "share-x", label: 'POST' },
};

export function drawCockpitRig() {
  const { W, H, DPR } = view;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0); ctx.clearRect(0, 0, W, H);
  const u = Math.min(H / 100, W / 150), cx = W / 2, driving = st.mode === 'drive', off = st.off;
  const paint = look('truck_color'), wl = look('wheel'), gb = look('gearbox'), dc = look('dice');
  const vib = driving ? (Math.random() - .5) * (st.v * .012 * SHAKE_MOVING + (off ? .7 : 0) + st.jolt * 1.5 + engineVib()) * u * .4 : 0;
  ctx.save(); ctx.translate(0, vib);
  const top = 4 * u, edgeY = 62 * u, ctrlY = 58 * u;
  drawCabShell(W, H, cx, u, top, edgeY, ctrlY, paint);
  drawMirrors(W, u);
  ctx.save(); ctx.beginPath(); wsPath(W, cx, top, edgeY, ctrlY); ctx.clip();
  drawGlassTint(W, H, u, top);
  drawHood(cx, u, paint);
  drawStacks(W, u);
  drawExhaust(u, [W * .115, W * .885], 20 * u);
  for (const b of st.bugs) drawBug(b, u);
  drawScreenLayers(u, cx, 47 * u, 59 * u);
  ctx.restore();
  drawOverhead(cx, u, top, RIG_BTNS);
  drawDice(cx, u, vib, dc);
  drawDashTop(W, H, cx, u, edgeY, ctrlY, paint);
  const pw = powered();
  drawPhoneMount(cx + 39.75 * u, 45 * u, 8.1 * u, 17 * u, u, RIG_BTNS);
  drawBinnacle(cx, u, pw);
  drawLeftPanel(cx, u, off, pw);
  drawRightPanel(cx, u, pw, RIG_BTNS);
  drawWheel(cx, u, wl);
  drawShifter(cx + 50 * u, u, gb);
  ctx.restore();
}
