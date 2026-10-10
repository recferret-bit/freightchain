import { ctx, view, mirrorRects } from './canvas.js';
import { chromeGrad, litRect, uiBtns, gauge, miniGauge, ledBar, lamp, strainLamp, brakeLamp, stallLamp, uiButton, heatButton, coldButton, ignitionPanel, radioPanel, leverPos } from './common.js';
import { drawScreenLayers, drawBug, drawExhaust, wip } from './windscreen.js';
import { st, disp, dn, powered, coldK } from '../state.js';
import { ambientC } from '../sim/climate.js';
import { CFG } from '../config.js';
import { clamp, fmt, gearName, MONO } from '../util.js';
import { SHAKE_MOVING, engineVib } from '../sim/shake.js';
import { look, pose } from '../cosmetics.js';
import { hint } from '../guide.js';
import { phone } from '../phone.js';

/* Style 2 (default): conventional long-hood semi cab – hood, chrome stacks, mirrors, air gauges, CB, brake valves. */

/* the PHONE on its dash mount, right of the bonnet (the map – ui/map.js): its screen shows the live map; a click (or N) takes it in hand */
let thumbBroke = false;
function drawPhoneMount(x, y, w, h, u) {
  uiBtns.push({ id: 'map', x: x - u, y: y - 3 * u, w: w + 2 * u, h: h + 4 * u });   // the phone + its caption above it
  ctx.fillStyle = '#121110'; ctx.fillRect(x + w / 2 - 1.2 * u, y + h - .5 * u, 2.4 * u, 3.5 * u);   // the mount's stem into the dash
  ctx.fillStyle = '#1b1a18'; ctx.beginPath(); ctx.roundRect(x - .9 * u, y + h * .3, 1.4 * u, h * .4, .5 * u); ctx.roundRect(x + w - .5 * u, y + h * .3, 1.4 * u, h * .4, .5 * u); ctx.fill();   // the clamp's arms
  ctx.fillStyle = '#0d0d0f'; ctx.beginPath(); ctx.roundRect(x, y, w, h, 1.4 * u); ctx.fill();
  ctx.strokeStyle = phone.open ? '#4285f4' : '#3b3d42'; ctx.lineWidth = .35 * u; ctx.stroke();
  const sx = x + .6 * u, sy = y + 1.4 * u, sw = w - 1.2 * u, sh = h - 2.6 * u;
  if (phone.open) { ctx.fillStyle = '#05070a'; ctx.fillRect(sx, sy, sw, sh); }   // it is in your hand: the mount is empty-ish (the screen dark)
  else if (phone.thumb && !thumbBroke) {
    ctx.save();
    try { phone.thumb(ctx, sx, sy, sw, sh); } catch (e) { thumbBroke = true; console.warn('phone map:', e); }   // a map bug must not take the rest of the cockpit with it (it then shows the still picture)
    ctx.restore();
  } else { ctx.fillStyle = '#e8e4da'; ctx.fillRect(sx, sy, sw, sh); ctx.strokeStyle = '#4285f4'; ctx.lineWidth = .8 * u; ctx.beginPath(); ctx.moveTo(sx + sw * .5, sy + sh); ctx.quadraticCurveTo(sx + sw * .2, sy + sh * .5, sx + sw * .6, sy); ctx.stroke(); }
  ctx.fillStyle = '#0d0d0f'; ctx.beginPath(); ctx.roundRect(x + w / 2 - 1.6 * u, y + .45 * u, 3.2 * u, .6 * u, .3 * u); ctx.fill();   // the speaker slot
  if (dn.k > .3 && !phone.open && phone.power > 0) { ctx.fillStyle = `rgba(120,170,255,${.06 * dn.k})`; ctx.beginPath(); ctx.arc(x + w / 2, y + h / 2, w * 1.1, 0, 7); ctx.fill(); }   // the screen's glow in the dark cab
}

export function drawCockpitRig() {
  const { W, H, DPR } = view;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0); ctx.clearRect(0, 0, W, H);
  const u = Math.min(H / 100, W / 150), cx = W / 2, driving = st.mode === 'drive', off = st.off, paint = look('truck_color'), wl = look('wheel'), gb = look('gearbox'), dc = look('dice');   // the worn cosmetics' colours (js/cosmetics.js): the defaults draw exactly what was always drawn
  const vib = driving ? (Math.random() - .5) * (st.v * .012 * SHAKE_MOVING + (off ? .7 : 0) + st.jolt * 1.5 + engineVib()) * u * .4 : 0;
  ctx.save(); ctx.translate(0, vib);
  const top = 4 * u, edgeY = 62 * u, ctrlY = 58 * u;
  const wsPath = () => { ctx.moveTo(W * .11, top); ctx.lineTo(W * .89, top); ctx.lineTo(W * .92, edgeY); ctx.quadraticCurveTo(cx, ctrlY, W * .08, edgeY); ctx.closePath(); };
  // cab interior (everything except the glass)
  const fg = ctx.createLinearGradient(0, 0, 0, H); fg.addColorStop(0, '#26221d'); fg.addColorStop(1, '#0c0a08');
  ctx.fillStyle = fg; ctx.beginPath(); ctx.rect(-20, -20, W + 40, H + 40); wsPath(); ctx.fill('evenodd');
  ctx.beginPath(); wsPath(); ctx.strokeStyle = paint.frame; ctx.lineWidth = .9 * u; ctx.stroke();
  // big west-coast mirrors
  for (const m of mirrorRects()) {
    const { x: mx, y: my, w: mw, h: mh, side } = m;
    ctx.strokeStyle = '#15130f'; ctx.lineWidth = 1.2 * u; ctx.beginPath(); ctx.moveTo(side < 0 ? mx + mw : mx, my + mh * .6); ctx.lineTo(side < 0 ? W * .085 : W * .915, 40 * u); ctx.stroke();
    ctx.fillStyle = '#0b0a09'; ctx.beginPath(); ctx.roundRect(mx - .6 * u, my - .6 * u, mw + 1.2 * u, mh + 1.2 * u, 1.5 * u); ctx.fill();
    ctx.save(); ctx.globalCompositeOperation = 'destination-out'; ctx.beginPath(); ctx.roundRect(mx, my, mw, mh, 1.2 * u); ctx.fill(); ctx.restore();   // live rear view shows through
    const gg = ctx.createLinearGradient(mx, my, mx + mw, my + mh); gg.addColorStop(0, 'rgba(255,255,255,.2)'); gg.addColorStop(.4, 'rgba(255,255,255,0)');
    ctx.fillStyle = gg; ctx.beginPath(); ctx.roundRect(mx, my, mw, mh, 1.2 * u); ctx.fill();
  }
  // glass layer
  ctx.save(); ctx.beginPath(); wsPath(); ctx.clip();
  const gl = ctx.createLinearGradient(0, 0, W, H * .6); gl.addColorStop(0, 'rgba(255,255,255,.07)'); gl.addColorStop(.4, 'rgba(255,255,255,0)'); gl.addColorStop(.6, 'rgba(255,255,255,.04)'); gl.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gl; ctx.fillRect(0, 0, W, H);
  const vg = ctx.createLinearGradient(0, top, 0, top + 10 * u); vg.addColorStop(0, 'rgba(10,30,26,.7)'); vg.addColorStop(1, 'rgba(10,30,26,0)'); ctx.fillStyle = vg; ctx.fillRect(0, top, W, 10 * u);   // tinted sun band
  // long hood
  const hy = 47 * u, hb = 64 * u;
  ctx.fillStyle = paint.fender; ctx.beginPath(); ctx.moveTo(cx - 12 * u, hy + 2 * u); ctx.lineTo(cx - 36 * u, hb); ctx.lineTo(cx + 36 * u, hb); ctx.lineTo(cx + 12 * u, hy + 2 * u); ctx.closePath(); ctx.fill();     // fenders
  const hg = ctx.createLinearGradient(0, hy, 0, hb); hg.addColorStop(0, paint.top); hg.addColorStop(1, paint.bottom);
  ctx.fillStyle = hg; ctx.beginPath(); ctx.moveTo(cx - 9 * u, hy); ctx.lineTo(cx - 23 * u, hb); ctx.lineTo(cx + 23 * u, hb); ctx.lineTo(cx + 9 * u, hy); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = paint.line; ctx.lineWidth = .5 * u; ctx.beginPath(); ctx.moveTo(cx, hy); ctx.lineTo(cx, hb); ctx.stroke();
  ctx.strokeStyle = chromeGrad(cx - 23 * u, cx + 23 * u); ctx.lineWidth = .7 * u; ctx.beginPath(); ctx.moveTo(cx - 9 * u, hy); ctx.lineTo(cx - 23 * u, hb); ctx.moveTo(cx + 9 * u, hy); ctx.lineTo(cx + 23 * u, hb); ctx.stroke();
  ctx.fillStyle = '#e8ecef'; ctx.beginPath(); ctx.moveTo(cx, hy - 2.5 * u); ctx.lineTo(cx + 1.2 * u, hy + .5 * u); ctx.lineTo(cx - 1.2 * u, hy + .5 * u); ctx.fill();  // ornament
  { const hd = CFG.HOOD_DARK * dn.k * (dn.cab ? 0 : 1 - dn.hood);   // night: the bonnet nearly vanishes unless the cab light / an outside lamp lights it. Drawn HERE (hood + fenders only, before the dash is painted over it), not as a later overlay: that one darkened a wedge of the cowl/dash around the bonnet
    if (hd > .01) { ctx.fillStyle = `rgba(3,5,12,${hd})`;   // exactly the fender + hood polygons above (one path, so where they overlap it is darkened once) – anything bigger would dim the glass above the hood
      ctx.beginPath(); ctx.moveTo(cx - 12 * u, hy + 2 * u); ctx.lineTo(cx - 36 * u, hb); ctx.lineTo(cx + 36 * u, hb); ctx.lineTo(cx + 12 * u, hy + 2 * u); ctx.closePath();
      ctx.moveTo(cx - 9 * u, hy); ctx.lineTo(cx - 23 * u, hb); ctx.lineTo(cx + 23 * u, hb); ctx.lineTo(cx + 9 * u, hy); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(cx, hy - 2.5 * u); ctx.lineTo(cx + 1.2 * u, hy + .5 * u); ctx.lineTo(cx - 1.2 * u, hy + .5 * u); ctx.fill(); } }
  // chrome exhaust stacks
  for (const sx of [W * .115, W * .885]) {
    ctx.fillStyle = chromeGrad(sx - 1.4 * u, sx + 1.4 * u); ctx.fillRect(sx - 1.4 * u, 20 * u, 2.8 * u, 42 * u);
    ctx.fillStyle = '#c9ced3'; ctx.fillRect(sx - 1.8 * u, 30 * u, 3.6 * u, .8 * u); ctx.fillRect(sx - 1.8 * u, 46 * u, 3.6 * u, .8 * u);
    ctx.fillStyle = '#20252a'; ctx.beginPath(); ctx.ellipse(sx, 20 * u, 1.4 * u, .6 * u, 0, 0, 7); ctx.fill();
  }
  drawExhaust(u, [W * .115, W * .885], 20 * u);
  // bugs
  for (const b of st.bugs) drawBug(b, u);
  drawScreenLayers(u, cx, 47 * u, 59 * u);
  ctx.restore();
  // overhead console + hanging dice
  { const LW = 16 * u, PW = LW * 1.2;   // the console is just the dome lamp now: lens 16u wide (was 8u), housing = lens + 20 %
    ctx.fillStyle = '#16130f'; ctx.beginPath(); ctx.roundRect(cx - PW / 2, top - 1 * u, PW, 6.5 * u, [0, 0, 2 * u, 2 * u]); ctx.fill(); }
  { const lx = cx, ly = top + 2.3 * u; uiBtns.push({ id: 'cab', x: cx - 9.6 * u, y: top - 1 * u, w: 19.2 * u, h: 6.5 * u });   // the whole lamp housing is the cab-light switch   // dome lamp lens (C): glows whenever the cab light is on, day or night
    if (dn.cab) { const g = ctx.createRadialGradient(lx, ly, .5 * u, lx, ly, 14 * u); g.addColorStop(0, 'rgba(255,225,170,.55)'); g.addColorStop(1, 'rgba(255,200,130,0)'); ctx.fillStyle = g; ctx.fillRect(lx - 14 * u, ly - 14 * u, 28 * u, 28 * u); }
    ctx.fillStyle = dn.cab ? '#fff1cf' : '#3a352d'; ctx.beginPath(); ctx.roundRect(lx - 8 * u, ly - 1.7 * u, 16 * u, 3.4 * u, 1.2 * u); ctx.fill(); if (dn.cab) litRect(lx - 8 * u, ly - 1.7 * u, 16 * u, 3.4 * u); }
  { const sw = -st.steer * .35 * clamp(st.v / 12, 0, 1) + Math.sin(performance.now() / 700) * .03 + vib * .02 + pose.dice;
    ctx.save(); ctx.translate(cx - 34 * u, 1 * u); ctx.rotate(sw); ctx.strokeStyle = '#ddd'; ctx.lineWidth = .25 * u; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, 9 * u); ctx.stroke();
    ctx.translate(0, 9 * u); ctx.fillStyle = dc.body; ctx.beginPath(); ctx.roundRect(-3.2 * u, 0, 3 * u, 3 * u, .5 * u); ctx.roundRect(.2 * u, 1 * u, 3 * u, 3 * u, .5 * u); ctx.fill();
    ctx.fillStyle = dc.pip; for (const [dx, dy] of [[-2.7, .5], [-.7, 2.5], [.7, 1.5], [2.7, 3.5]]) { ctx.beginPath(); ctx.arc(dx * u, dy * u, .35 * u, 0, 7); ctx.fill(); } ctx.restore(); }

  // dashboard top
  const dg = ctx.createLinearGradient(0, 58 * u, 0, H); dg.addColorStop(0, '#4b473f'); dg.addColorStop(.1, '#27241f'); dg.addColorStop(.3, '#14120f'); dg.addColorStop(1, '#0a0908');
  ctx.fillStyle = dg; ctx.beginPath(); ctx.moveTo(-20, 66 * u); ctx.lineTo(W * .08, edgeY); ctx.quadraticCurveTo(cx, ctrlY, W * .92, edgeY); ctx.lineTo(W + 20, 66 * u); ctx.lineTo(W + 20, H + 20); ctx.lineTo(-20, H + 20); ctx.fill();
  ctx.strokeStyle = paint.dashEdge; ctx.lineWidth = .5 * u; ctx.beginPath(); ctx.moveTo(W * .08, edgeY); ctx.quadraticCurveTo(cx, ctrlY, W * .92, edgeY); ctx.stroke();
  const pw = powered();
  drawPhoneMount(cx + 39 * u, 45 * u, 9.6 * u, 17 * u, u);
  // instrument binnacle
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
  ctx.fillStyle = pw ? '#7cff7c' : 'rgba(0,0,0,0)'; ctx.font = `${2.1 * u}px ${MONO}`; ctx.fillText('TRIP ' + (st.s / 1000).toFixed(1) + ' km', cx + 36 * u, 79.3 * u); ctx.fillText(fmt(st.t) + '/' + fmt(CFG.RIDE_MIN_SECONDS), cx + 36 * u, 81.8 * u); ctx.fillText('OUT ' + Math.round(ambientC()) + '°C', cx + 36 * u, 84.3 * u);
  // left: warning lamps + pedal LEDs
  const lx = cx - 72 * u;
  lamp(lx, 64 * u, 'STALL', stallLamp(), '#d22', u); lamp(lx + 13.5 * u, 64 * u, 'COLD', coldK() > .2, '#3a8fe0', u, 9.5); strainLamp(lx + 13.5 * u, 68.8 * u, u, 9.5); lamp(lx, 68.8 * u, 'OFF ROAD', off, '#e80', u);
  brakeLamp(lx + 13.5 * u, 73.6 * u, u, 9.5); lamp(lx, 73.6 * u, 'OVER-REV', st.overrev, '#d22', u); lamp(lx, 78.4 * u, 'GRIND', st.grind > 0, '#e80', u); lamp(lx + 13.5 * u, 78.4 * u, 'BAT', powered() && st.batt < CFG.BATT.LOW && (st.batt > CFG.BATT.LOW / 2 || Math.floor(st.t * 6) % 2 === 0), st.batt < CFG.BATT.LOW / 2 ? '#d22' : '#e80', u, 9.5);
  ledBar(lx + .5 * u, 84 * u, 3.2 * u, 12 * u, pw ? st.clutch : 0, '#4a8fd8', 'CLU', u); ledBar(lx + 5 * u, 84 * u, 3.2 * u, 12 * u, pw ? st.brake : 0, '#e0503f', 'BRK', u); ledBar(lx + 9.5 * u, 84 * u, 3.2 * u, 12 * u, pw ? st.gas : 0, '#6ecf5a', 'GAS', u); ledBar(lx + 14 * u, 84 * u, 3.2 * u, 12 * u, pw ? st.hull / 100 : 0, st.hull > 50 ? '#6ecf5a' : st.hull > 25 ? '#e0a03f' : '#e0503f', 'HUL', u);
  // right: CB radio, air-brake valves, switches
  const rx = cx + 50 * u;
  ctx.fillStyle = '#161513'; ctx.beginPath(); ctx.roundRect(rx, 64 * u, 22 * u, 10 * u, 1 * u); ctx.fill(); ctx.strokeStyle = '#3a362f'; ctx.lineWidth = .3 * u; ctx.stroke();
  radioPanel(rx, u, pw);
  uiButton('wiper', wip.mode ? 'WIPER ' + wip.mode : 'WIPER', rx + 1.5 * u, 76 * u, 9.5 * u, 5 * u, u, wip.mode > 0);
  uiButton('wash', 'WASH', rx + 11.5 * u, 76 * u, 9.5 * u, 5 * u, u, st.washing);
  { const vy = 86.5 * u, px = rx + 6.25 * u;   // centred under the WIPER button
    uiBtns.push({ id: 'park', x: px - 3.6 * u, y: vy - 3.6 * u, w: 7.2 * u, h: 10.4 * u }); ctx.fillStyle = st.park ? '#ff3a2a' : '#6b1f1a'; ctx.beginPath(); for (let i = 0; i < 8; i++) { const an = Math.PI / 8 + i * Math.PI / 4; ctx.lineTo(px + Math.cos(an) * 3.4 * u, vy + Math.sin(an) * 3.4 * u); } ctx.closePath(); ctx.fill(); ctx.strokeStyle = '#222'; ctx.lineWidth = .3 * u; ctx.stroke();
    ctx.fillStyle = st.park ? '#ffe9e4' : '#c9a29c'; ctx.font = `bold ${4.4 * u}px ${MONO}`; const tb = ctx.textBaseline; ctx.textBaseline = 'middle'; ctx.fillText('P', px, vy + .2 * u); ctx.textBaseline = tb;
    ctx.fillStyle = st.park ? '#ff8a7a' : '#9d957f'; ctx.font = `${1.5 * u}px ${MONO}`; ctx.fillText('PARK', px, vy + 5.2 * u); }
  ignitionPanel(cx + 37 * u, 96.2 * u, u * .78);   // scaled down so the ON zone stays inside the dash panel border
  { const bw = 8.4 * u, bh = 4 * u, gx = cx - 48 * u, gy = 90.8 * u, gap = .8 * u;   // 2x2 switch grid left of the wheel
    uiButton('head', 'HEAD', gx, gy, bw, bh, u, dn.head); uiButton('cab', 'CAB', gx + bw + gap, gy, bw, bh, u, dn.cab);
    heatButton(gx, gy + bh + gap, bw, bh, u); coldButton(gx + bw + gap, gy + bh + gap, bw, bh, u); }   // HEAT | COLD share the old wide heater slot (the cab light has no button: click the dome lamp, or press C)
  // steering column + big wheel
  ctx.fillStyle = '#12100e'; ctx.beginPath(); ctx.moveTo(cx - 6 * u, 88 * u); ctx.lineTo(cx + 6 * u, 88 * u); ctx.lineTo(cx + 9 * u, 112 * u); ctx.lineTo(cx - 9 * u, 112 * u); ctx.fill();
  ctx.save(); ctx.translate(cx, 106 * u); ctx.scale(1, .62); ctx.rotate(st.steer * CFG.TRUCK.WHEEL_TURNS * 2 * Math.PI);
  const R = 27 * u; ctx.lineCap = 'round'; hint('WHEEL', cx - 28 * u, 89 * u, 56 * u, 11 * u);
  ctx.strokeStyle = wl.rim; ctx.lineWidth = 5.4 * u; ctx.beginPath(); ctx.arc(0, 0, R, 0, 7); ctx.stroke();
  ctx.strokeStyle = wl.sheen; ctx.lineWidth = 2.6 * u; ctx.stroke();
  ctx.strokeStyle = wl.spoke; ctx.lineWidth = 3 * u; for (let i = 0; i < 4; i++) { const an = Math.PI / 4 + i * Math.PI / 2; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(an) * R, Math.sin(an) * R); ctx.stroke(); }
  ctx.fillStyle = wl.hub; ctx.beginPath(); ctx.arc(0, 0, 7.5 * u, 0, 7); ctx.fill(); ctx.strokeStyle = chromeGrad(-7 * u, 7 * u); ctx.lineWidth = .6 * u; ctx.stroke();
  ctx.fillStyle = wl.mark; ctx.font = `bold ${5 * u}px ${MONO}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('FC', 0, 0);
  ctx.fillStyle = wl.mark; ctx.beginPath(); ctx.arc(0, -R, 1.2 * u, 0, 7); ctx.fill();   // 12-o'clock marker
  ctx.restore();
  // floor shifter (H pattern, 4 columns: 1/2, 3/4, 5/6, 7/R)
  { const bx = rx + 16.25 * u, g = st.gear;   // centred under WASH
    const col = g === 0 ? 0 : g < 0 ? 1.5 : [-1.5, -1.5, -.5, -.5, .5, .5, 1.5][g - 1], row = g === 0 ? 0 : g < 0 ? 1 : [-1, 1, -1, 1, -1, 1, -1][g - 1];   // R: right, back
    hint('SHIFTER', bx - 7 * u, 81 * u, 14 * u, 19 * u);
    const lv = leverPos(col, row), kx = bx + lv.col * 2.6 * u, ky = 86 * u + lv.row * 2.6 * u;   // tweened through the neutral channel
    ctx.fillStyle = gb.boot; ctx.beginPath(); ctx.ellipse(bx, 100 * u, 6 * u, 2.6 * u, 0, 0, 7); ctx.fill();
    ctx.strokeStyle = gb.lever ?? chromeGrad(bx - 1 * u, bx + 1 * u); ctx.lineWidth = 1.4 * u; ctx.beginPath(); ctx.moveTo(bx, 100 * u); ctx.lineTo(kx, ky); ctx.stroke();
    ctx.fillStyle = gb.knob; ctx.beginPath(); ctx.arc(kx, ky, 2.8 * u, 0, 7); ctx.fill(); ctx.strokeStyle = gb.rim; ctx.lineWidth = .3 * u; ctx.stroke();
    ctx.fillStyle = gb.text; ctx.font = `bold ${2.6 * u}px ${MONO}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(gearName(g), kx, ky); }
  ctx.restore();
}
