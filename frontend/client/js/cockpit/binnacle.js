import { ctx } from './canvas.js';
import { chromeGrad, litRect } from './primitives.js';
import { gauge, miniGauge } from './gauges.js';
import { st, disp } from '../state.js';
import { ambientC } from '../sim/climate.js';
import { CFG } from '../config.js';
import { fmt, gearName, MONO } from '../util.js';
import { look, loadout } from '../cosmetics.js';
import { hint } from '../guide.js';

/* Dashboard fascia and center instrument binnacle (speedometer, tachometer, 6 auxiliary gauges, gear display, trip LCD). */

export function drawDashTop(W, H, cx, u, edgeY, ctrlY, paint) {
  const dg = ctx.createLinearGradient(0, 58 * u, 0, H);
  if (loadout.dash === 'stock') { dg.addColorStop(0, '#4b473f'); dg.addColorStop(.1, '#27241f'); dg.addColorStop(.3, '#14120f'); dg.addColorStop(1, '#0a0908'); }
  else { const fascia = look('dash'); dg.addColorStop(0, fascia.top); dg.addColorStop(1, fascia.bottom); }
  ctx.fillStyle = dg; ctx.beginPath(); ctx.moveTo(-20, 66 * u); ctx.lineTo(W * .08, edgeY); ctx.quadraticCurveTo(cx, ctrlY, W * .92, edgeY); ctx.lineTo(W + 20, 66 * u); ctx.lineTo(W + 20, H + 20); ctx.lineTo(-20, H + 20); ctx.fill();
  ctx.strokeStyle = paint.dashEdge; ctx.lineWidth = .5 * u; ctx.beginPath(); ctx.moveTo(W * .08, edgeY); ctx.quadraticCurveTo(cx, ctrlY, W * .92, edgeY); ctx.stroke();
}

export function drawBinnacle(cx, u, pw) {
  ctx.fillStyle = '#0b0a08'; ctx.beginPath(); ctx.roundRect(cx - 47 * u, 63.5 * u, 94 * u, 25 * u, 3 * u); ctx.fill();
  ctx.strokeStyle = '#34302a'; ctx.lineWidth = .6 * u; ctx.stroke();
  gauge(cx - 14 * u, 76 * u, 11 * u, disp.v, 120, 20, 0, 'km/h', u);
  gauge(cx + 14 * u, 76 * u, 11 * u, disp.rpm, 3000, 500, 2800, 'RPM×100', u);
  for (const gx of [cx - 14 * u, cx + 14 * u]) { ctx.strokeStyle = chromeGrad(gx - 11 * u, gx + 11 * u); ctx.lineWidth = .6 * u; ctx.beginPath(); ctx.arc(gx, 76 * u, 11 * u, 0, 7); ctx.stroke(); }
  miniGauge(cx - 31 * u, 72 * u, 4.4 * u, disp.air, null, 'AIR', '', '', u, 0);
  miniGauge(cx - 41 * u, 72 * u, 4.4 * u, disp.oil, null, 'OIL', '', '', u, 0);
  miniGauge(cx - 31 * u, 82 * u, 4.4 * u, disp.temp, null, 'TEMP', '', '', u, .8);
  miniGauge(cx - 41 * u, 82 * u, 4.4 * u, disp.h2o, null, 'H2O', '', '', u, 0);
  miniGauge(cx + 31 * u, 72 * u, 4.4 * u, disp.fuel, null, 'FUEL', '', '', u, 0);
  miniGauge(cx + 41 * u, 72 * u, 4.4 * u, disp.volt, null, 'VOLT', '', '', u, 0);
  ctx.fillStyle = !pw ? '#1d1409' : st.engineOn ? '#ffb03a' : '#5a3a14'; ctx.font = `bold ${6 * u}px ${MONO}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(gearName(st.gear), cx, 77 * u);
  ctx.fillStyle = '#9d957f'; ctx.font = `${1.5 * u}px ${MONO}`; ctx.fillText('GEAR', cx, 73.2 * u); hint('GEAR', cx - 6 * u, 71 * u, 12 * u, 9.5 * u);
  // trip LCD
  ctx.fillStyle = pw ? '#0d2410' : '#0a170c'; ctx.fillRect(cx + 27 * u, 78 * u, 18 * u, 8 * u); litRect(cx + 27 * u, 78 * u, 18 * u, 8 * u); hint('TRIP', cx + 27 * u, 78 * u, 18 * u, 8 * u);
  ctx.fillStyle = pw ? '#7cff7c' : 'rgba(0,0,0,0)'; ctx.font = `${2.1 * u}px ${MONO}`;
  ctx.fillText('TRIP ' + (st.s / 1000).toFixed(1) + ' km', cx + 36 * u, 79.3 * u);
  ctx.fillText(fmt(st.t) + '/' + fmt(CFG.RIDE_MIN_SECONDS), cx + 36 * u, 81.8 * u);
  ctx.fillText('OUT ' + Math.round(ambientC()) + '°C', cx + 36 * u, 84.3 * u);
}
