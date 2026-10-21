import { st, dn } from '../../state.js';
import { CFG } from '../../config.js';
import { env } from '../../world/environment.js';
import { trip } from '../../trips.js';
import { phone } from '../../phone.js';
import { os } from '../../phone/os.js';
import { paintLauncher, homeLayout as launcherLayout } from '../../phone/home.js';
import { noteFrame } from '../../minigames/runtime.js';
import { noteGulp } from './gulp-scan.js';
import { notePike } from './pike-scan.js';
import { clamp, fmt, MONO } from '../../util.js';
import { SB, view, palette, target } from './state.js';
import { stepPhonePower } from './power-fsm.js';
import { paintMap } from './canvas-map.js';
import { paintBoot, statusIcons } from './screens.js';
import { nextStep, distText, icon, fit } from './navigation.js';

/* Handheld phone screen compositor. Maps keeps the navigation chrome. Every other app is the phone OS.
   Home hits are CSS pixels divided by view.k. App hits are already in that logical space. */

export function drawMap(g, X, Y, W, H, o = {}) {
  noteFrame();
  noteGulp();
  notePike();
  const sc = stepPhonePower();
  const other = sc.on && phone.app && phone.app !== 'maps';
  if (sc.on && !other) paintMap(g, X, Y, W, H, o);
  else if (other && o.thumb) paintThumbApp(g, X, Y, W, H);
  else if (other) { g.fillStyle = '#10141b'; g.fillRect(X, Y, W, H); }
  else if (sc.home !== undefined) paintLauncher(g, X, Y, W, H, sc.home, !!o.thumb, o.thumb ? -1 : os.focus);
  else paintBoot(g, X, Y, W, H, sc, !!o.thumb);
  return sc;
}

function paintThumbApp(g, X, Y, W, H) {
  const meta = os.app();
  g.fillStyle = '#10141b'; g.fillRect(X, Y, W, H);
  g.fillStyle = meta?.color ?? '#334155'; g.fillRect(X, Y, W, Math.max(4, H * .08));
  g.fillStyle = '#e8edf3'; g.font = `700 ${Math.max(8, W / 14)}px ${MONO}`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(meta?.label ?? '', X + W / 2, Y + H / 2);
}

export function drawPhone() {
  const cv = view.cv, g = cv.getContext('2d'), dpr = Math.min(2, devicePixelRatio || 1), CW = cv.clientWidth, CH = cv.clientHeight;
  if (!CW || !CH) return;
  if (cv.width !== Math.round(CW * dpr) || cv.height !== Math.round(CH * dpr)) { cv.width = Math.round(CW * dpr); cv.height = Math.round(CH * dpr); }
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const sc = drawMap(g, 0, 0, CW, CH);
  const k = view.k = Math.min(1, CH / 600, CW / 300), W = CW / k, H = CH / k;
  g.setTransform(dpr * k, 0, 0, dpr * k, 0, 0);
  const P = palette(), T0 = target(), hits = view.hits; hits.length = 0;
  if (!sc.on) {
    g.textAlign = 'center'; g.textBaseline = 'middle';
    if (sc.off) { g.fillStyle = '#7d8594'; g.font = `600 13px ${MONO}`; g.fillText('PHONE OFF', W / 2, H * .46); g.font = `11px ${MONO}`; g.fillText('start the engine to switch it on', W / 2, H * .46 + 22); }
    const lay = sc.home !== undefined ? launcherLayout(0, 0, CW, CH, false) : null;
    if (lay) for (const ic of lay.icons) hits.push({ id: 'app:' + ic.id, x: ic.x / k, y: ic.y / k, w: ic.s / k, h: ic.s / k });
    const cy = lay ? lay.dockY / k - 42 : H - 52;
    g.fillStyle = 'rgba(255,255,255,.14)'; g.beginPath(); g.roundRect(W / 2 - 44, cy, 88, 32, 16); g.fill();
    g.fillStyle = '#c3ccd8'; g.font = `700 13px ${MONO}`; g.fillText('CLOSE', W / 2, cy + 17);
    hits.unshift({ id: 'exit', x: W / 2 - 44, y: cy, w: 88, h: 32 });
    return;
  }
  if (phone.app && phone.app !== 'maps') {
    os.paint(g, W, H);
    for (const h of os.hits(W, H)) hits.push(h);
    return;
  }
  const ui = sc.u;
  g.save(); g.globalAlpha = ui; g.translate(0, -(1 - ui) * 80);
  g.font = `600 12px ${MONO}`; g.textBaseline = 'middle';
  g.fillStyle = P.bar0; g.fillRect(0, 0, W, SB);
  const hh = Math.floor(dn.t) % 24, mm = Math.floor((dn.t % 1) * 60);
  g.fillStyle = P.text; g.textAlign = 'left'; g.fillText(String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0'), 20, 18);
  statusIcons(g, W - 18, 18, P);
  const n = nextStep(T0);
  g.fillStyle = P.nav; g.beginPath(); g.roundRect(8, SB + 6, W - 16, 74, 12); g.fill();
  icon(g, n.icon, 40, SB + 43, 1.1);
  g.fillStyle = '#fff'; g.textAlign = 'left'; g.font = `700 20px ${MONO}`; g.fillText(fit(g, distText(n.dist) || n.text, W - 86), 70, SB + 28);
  g.font = `600 13px ${MONO}`; g.fillText(fit(g, n.dist === null ? n.sub : n.text, W - 86), 70, SB + 50);
  g.font = `11px ${MONO}`; g.fillStyle = 'rgba(255,255,255,.82)'; g.fillText(fit(g, n.dist === null ? '' : n.sub, W - 86), 70, SB + 68);
  g.restore(); g.globalAlpha = ui;

  const sh = 120, sy = H - sh, bx = W - 46; let by = Math.max(SB + 88, Math.min(SB + 92, sy - 8 - 4 * 44));
  for (const id of ['north', 'in', 'out', ...(view.free ? ['home'] : [])]) {
    const cx = bx + 18, cy = by + 18;
    g.fillStyle = P.card; g.strokeStyle = dn.k > .5 ? 'rgba(255,255,255,.22)' : 'rgba(0,0,0,.2)'; g.lineWidth = 1; g.beginPath(); g.arc(cx, cy, 18, 0, 7); g.fill(); g.stroke();
    g.save(); g.translate(cx, cy); g.lineCap = 'round'; g.lineWidth = 2.6; g.strokeStyle = g.fillStyle = P.text;
    if (id === 'in' || id === 'out') { g.beginPath(); g.moveTo(-6.5, 0); g.lineTo(6.5, 0); if (id === 'in') { g.moveTo(0, -6.5); g.lineTo(0, 6.5); } g.stroke(); }
    else if (id === 'home') {
      g.strokeStyle = g.fillStyle = P.route; g.lineWidth = 2; g.beginPath(); g.arc(0, 0, 6.5, 0, 7); g.stroke();
      g.beginPath(); g.arc(0, 0, 2.6, 0, 7); g.fill(); g.beginPath(); for (const a of [0, 1, 2, 3]) { g.moveTo(Math.cos(a * Math.PI / 2) * 6.5, Math.sin(a * Math.PI / 2) * 6.5); g.lineTo(Math.cos(a * Math.PI / 2) * 10, Math.sin(a * Math.PI / 2) * 10); } g.stroke();
    } else {
      g.rotate(view.northUp ? 0 : -(view.rot ?? 0));
      g.beginPath(); g.moveTo(0, -10); g.lineTo(5.5, 3); g.lineTo(0, 0); g.lineTo(-5.5, 3); g.closePath(); g.fillStyle = '#ea4335'; g.fill();
      g.beginPath(); g.moveTo(0, 10); g.lineTo(5.5, 3); g.lineTo(0, 0); g.lineTo(-5.5, 3); g.closePath(); g.fillStyle = dn.k > .5 ? 'rgba(255,255,255,.55)' : 'rgba(0,0,0,.35)'; g.fill();
    }
    g.restore();
    hits.push({ id, x: bx, y: by, w: 36, h: 36 }); by += 44;
  }

  g.globalAlpha = 1; g.save(); g.translate(0, (1 - ui) * 150);
  g.fillStyle = P.card; g.shadowColor = 'rgba(0,0,0,.25)'; g.shadowBlur = 12; g.beginPath(); g.roundRect(0, sy, W, sh + 20, [16, 16, 0, 0]); g.fill(); g.shadowBlur = 0;
  g.fillStyle = 'rgba(0,0,0,.18)'; g.beginPath(); g.roundRect(W / 2 - 18, sy + 6, 36, 4, 2); g.fill();
  const goal = Math.max(1, CFG.COMPLETE_DIST), left = T0 !== null ? Math.max(0, T0 - st.s) : 0;
  const eta = left / Math.max(view.vAvg, 6), pd = clamp(st.s / goal, 0, 1);
  const big = st.complete ? 'DONE' : fmt(eta);
  g.textAlign = 'left'; g.fillStyle = P.go; g.font = `700 22px ${MONO}`; g.fillText(big, 16, sy + 30);
  const dw = g.measureText(big).width;
  g.fillStyle = P.sub; g.font = `600 14px ${MONO}`; g.fillText(fit(g, st.complete ? '· shift complete' : '· ' + distText(left), W - 100 - (24 + dw)), 24 + dw, sy + 31);
  g.font = `600 12px ${MONO}`; g.fillText(fit(g, `TIME ${fmt(st.t)}`, W - 120), 16, sy + 50);
  g.fillText(fit(g, `DIST ${(Math.min(st.s, goal) / 1000).toFixed(2)} / ${(goal / 1000).toFixed(2)} km`, W - 120), 16, sy + 76);
  g.fillStyle = P.bar; g.beginPath(); g.roundRect(16, sy + 84, W - 120, 6, 3); g.fill();
  g.fillStyle = P.go; g.beginPath(); g.roundRect(16, sy + 84, Math.max(6, (W - 120) * pd), 6, 3); g.fill();
  g.fillStyle = P.sub; g.font = `11px ${MONO}`; g.fillText(fit(g, (trip.name ?? 'SHIFT') + ' · ' + (env.theme?.name ?? '') + (trip.finish ? ' · ends at the line' : ''), W - 32), 16, sy + 104);
  g.fillStyle = '#ea4335'; g.beginPath(); g.roundRect(W - 92, sy + 20, 78, 40, 20); g.fill();
  g.fillStyle = '#fff'; g.font = `700 14px ${MONO}`; g.textAlign = 'center'; g.fillText('EXIT', W - 53, sy + 41);
  hits.unshift({ id: 'exit', x: W - 92, y: sy + 20, w: 78, h: 40 });
  g.restore(); if (ui < 1) hits.splice(1);
}
