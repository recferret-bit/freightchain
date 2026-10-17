import { uiBtns, litShapes } from './common.js';
import { drawCockpitRig } from './rig.js';
import { nightGrade, cabGlow, blindEffect, drawStallBanner, drawDispatchBanner, drawImpactFlash } from './effects.js';
import { st } from '../state.js';
import { drawInputs } from './inputs.js';
import { drawGuide } from './guide.js';
import { guide } from '../guide.js';

/* Cockpit frame orchestrator: renders the semi-truck cabin, lighting grades, guide/input overlays, status banners, and impact flash. */

export function drawCockpit() {
  uiBtns.length = 0; litShapes.length = 0; guide.rects.length = 0;
  drawCockpitRig();
  nightGrade(); cabGlow(); blindEffect();
  if (!st.watch && st.mode === 'drive') drawGuide();   // the free ride's tutorial / assist highlights (no-op without tips)
  drawInputs();   // a replay: the driver's keys and clicks as flashing yellow borders (no-op elsewhere)
  drawStallBanner();
  drawDispatchBanner();
  drawImpactFlash();
}
