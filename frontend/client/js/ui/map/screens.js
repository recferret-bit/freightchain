import { st, dn } from '../../state.js';
import { CFG } from '../../config.js';
import { clamp, MONO } from '../../util.js';
import { view } from './state.js';
import { ease, lerp } from './power-fsm.js';
import { paintMap } from './canvas-map.js';
import { paintGlyph } from '../../phone/icons.js';

/* Phone OS screen components: boot animation, home screen launcher + app icons, and status bar icons. */

const { BOOT, HOME, LAUNCH_AT } = CFG.PHONE;
const APPS = [['maps', 'MAPS', '#34a853'], ['wallet', 'WALLET', '#7c4dff'], ['radio', 'RADIO', '#e8710a'], ['weather', 'WEATHER', '#1a8fe3'], ['truck', 'TRUCK', '#5f6368'], ['chat', 'CHAT', '#14b8a6'], ['cam', 'CAMERA', '#3c4043'], ['cog', 'SETTINGS', '#80868b']];
const DOCK = [['calls', '#34a853'], ['web', '#1a73e8'], ['music', '#ea4335']];

export function statusIcons(g, x, y, P) {   // signal bars, the network, the battery (⚡ while the engine charges it)
  g.save(); g.fillStyle = P.text; g.strokeStyle = P.text; g.lineWidth = 1.2;
  g.beginPath(); g.roundRect(x - 24, y - 5, 22, 10, 3); g.stroke(); g.beginPath(); g.roundRect(x - 22, y - 3, 14, 6, 1.5); g.fill(); g.fillRect(x - 1, y - 2, 2, 4);
  if (st.engineOn) { g.fillStyle = P.go; g.beginPath(); g.moveTo(x - 11, y - 4); g.lineTo(x - 16, y + .5); g.lineTo(x - 12.5, y + .5); g.lineTo(x - 14, y + 4); g.lineTo(x - 8, y - 1); g.lineTo(x - 11.5, y - 1); g.closePath(); g.fill(); }
  g.fillStyle = P.text; for (let i = 0; i < 4; i++) g.fillRect(x - 58 + i * 5, y + 5 - 3 - i * 2.4, 3.2, 3 + i * 2.4);
  g.restore();
}

export function paintBoot(g, X, Y, W, H, sc, thumb) {
  const t = sc.boot ?? 0, out = ease((t - (BOOT - 450)) / 450), a = 1 - out;
  g.save(); g.beginPath(); g.rect(X, Y, W, H); g.clip();
  g.fillStyle = '#05060b'; g.fillRect(X, Y, W, H);
  if (sc.off) { g.restore(); return; }
  const u = Math.min(W, H * .62) / 100, cx = X + W / 2, cy = Y + H * .42, pulse = .5 + .5 * Math.sin(t / 360);
  g.globalAlpha = a;
  for (const [col, dx] of [['153,69,255', -12], ['20,241,149', 12]]) { const r = 60 * u, gr = g.createRadialGradient(cx + dx * u, cy, 0, cx + dx * u, cy, r); gr.addColorStop(0, `rgba(${col},${.2 + .1 * pulse})`); gr.addColorStop(1, `rgba(${col},0)`); g.fillStyle = gr; g.fillRect(X, Y, W, H); }
  const bars = [[52, 0], [38, 1], [24, 2]], bh = 8.5 * u, gap = 4 * u, full = 52 * u, x0 = cx - full / 2, y0 = cy - (3 * bh + 2 * gap) / 2;
  const grad = g.createLinearGradient(x0, 0, x0 + full, 0); grad.addColorStop(0, '#9945ff'); grad.addColorStop(1, '#14f195');
  const pop = 1 + .35 * out;
  g.save(); g.translate(cx, cy); g.scale(pop, pop); g.translate(-cx, -cy);
  bars.forEach(([wd, i]) => {
    const e = ease((t - 150 - i * 230) / 650), w = wd * u, x = cx - w / 2 + (i % 2 ? 1 : -1) * (1 - e) * 40 * u, y = y0 + i * (bh + gap);
    g.globalAlpha = a * e; g.fillStyle = grad; g.beginPath(); g.roundRect(x, y, w, bh, bh / 2); g.fill();
    const sh = (t - 1100) / 1000;
    if (sh > 0 && sh < 1.3) { const gx = x + (sh * 1.4 - .2) * w, sg = g.createLinearGradient(gx - 8 * u, 0, gx + 8 * u, 0); sg.addColorStop(0, 'rgba(255,255,255,0)'); sg.addColorStop(.5, 'rgba(255,255,255,.55)'); sg.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = sg; g.beginPath(); g.roundRect(x, y, w, bh, bh / 2); g.fill(); }
  });
  g.restore(); g.globalAlpha = a;
  if (!thumb) {
    g.globalAlpha = a * ease((t - 1300) / 600); g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = '#e8edf3'; g.font = `700 ${Math.max(9, 6.2 * u)}px ${MONO}`; g.fillText('FREIGHT CHAIN', cx, y0 + 3 * bh + 2 * gap + 12 * u);
    g.fillStyle = '#7d8594'; g.font = `600 ${Math.max(7, 3.4 * u)}px ${MONO}`; g.fillText('ON SOLANA DEVNET', cx, y0 + 3 * bh + 2 * gap + 19 * u);
  }
  g.globalAlpha = a;
  const bw = 46 * u, by = Y + H * .8, pg = clamp(t / BOOT, 0, 1), bt = Math.max(2, 1.3 * u); g.fillStyle = 'rgba(255,255,255,.12)'; g.beginPath(); g.roundRect(cx - bw / 2, by, bw, bt, 2); g.fill();
  const pb = g.createLinearGradient(cx - bw / 2, 0, cx + bw / 2, 0); pb.addColorStop(0, '#9945ff'); pb.addColorStop(1, '#14f195'); g.fillStyle = pb; g.beginPath(); g.roundRect(cx - bw / 2, by, Math.max(2, bw * (1 - (1 - pg) ** 2)), bt, 2); g.fill();
  g.restore();
}

export function homeLayout(X, Y, W, H, thumb) {
  const u = W / 100, s = 18 * u, gap = (100 - 4 * 18) / 5 * u, rowH = s + (thumb ? 5 : 11) * u, y0 = Y + H * (thumb ? .22 : .27), icons = [];
  APPS.forEach(([id, label, col], i) => icons.push({ id, label, col, x: X + gap + (i % 4) * (s + gap), y: y0 + Math.floor(i / 4) * rowH, s, i }));
  DOCK.forEach(([id, col], i) => icons.push({ id, label: '', col, x: X + W / 2 + (i - 1) * (s + gap) - s / 2, y: Y + H - s - 5 * u, s, i: 8 + i, dock: true }));
  return { u, icons, dockY: Y + H - s - 8 * u, dockH: s + 6 * u };
}

function appGlyph(g, id, x, y, s) {
  g.save(); g.translate(x + s / 2, y + s / 2); g.scale(s / 40, s / 40); paintGlyph(g, id); g.restore();
}

export function paintHome(g, X, Y, W, H, t, thumb, o) {
  const L = homeLayout(X, Y, W, H, thumb), u = L.u, wake = ease(t / 350), launch = ease((t - LAUNCH_AT) / (HOME - LAUNCH_AT)), press = clamp((t - (LAUNCH_AT - 110)) / 110, 0, 1);
  g.save(); g.beginPath(); g.rect(X, Y, W, H); g.clip();
  g.fillStyle = '#05060b'; g.fillRect(X, Y, W, H); g.globalAlpha = wake;
  const bg = g.createLinearGradient(0, Y, 0, Y + H); bg.addColorStop(0, '#0d1024'); bg.addColorStop(.6, '#1c1346'); bg.addColorStop(1, '#0e3b3a'); g.fillStyle = bg; g.fillRect(X, Y, W, H);
  for (const [col, fx, fy] of [['153,69,255', .2, .9], ['20,241,149', .85, 1]]) { const gr = g.createRadialGradient(X + W * fx, Y + H * fy, 0, X + W * fx, Y + H * fy, 70 * u); gr.addColorStop(0, `rgba(${col},.28)`); gr.addColorStop(1, `rgba(${col},0)`); g.fillStyle = gr; g.fillRect(X, Y, W, H); }
  const rest = 1 - launch * .85, hh = Math.floor(dn.t) % 24, mm = Math.floor((dn.t % 1) * 60), clock = String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
  g.globalAlpha = wake * rest; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#e8edf3';
  if (!thumb) { g.font = `600 ${Math.max(9, 3.6 * u)}px ${MONO}`; g.textAlign = 'left'; g.fillText(clock, X + 20, Y + 18); statusIcons(g, X + W - 18, Y + 18, { text: '#e8edf3', go: '#5ee08f' }); g.textAlign = 'center'; }
  g.font = `300 ${Math.max(8, (thumb ? 9 : 13) * u)}px ${MONO}`; g.fillText(clock, X + W / 2, Y + H * (thumb ? .12 : .13));
  g.globalAlpha = wake * rest; g.fillStyle = 'rgba(255,255,255,.1)'; g.beginPath(); g.roundRect(X + 3 * u, L.dockY, W - 6 * u, L.dockH, 6 * u); g.fill();
  let maps = null;
  for (const ic of L.icons) {
    const pop = ease((t - 120 - ic.i * 70) / 380), bounce = view.bounce?.id === ic.id ? Math.sin(clamp((performance.now() - view.bounce.at) / 320, 0, 1) * Math.PI) : 0;
    let sc = (.5 + .5 * pop) * (1 - .1 * bounce) * (1 - launch * .06), alpha = wake * pop * rest;
    if (ic.id === 'maps') { maps = ic; sc *= 1 - .12 * Math.sin(press * Math.PI * .5); alpha = wake * pop; }
    if (alpha <= 0) continue;
    g.save(); g.globalAlpha = alpha; g.translate(ic.x + ic.s / 2, ic.y + ic.s / 2); g.scale(sc, sc); g.translate(-ic.s / 2, -ic.s / 2);
    g.shadowColor = 'rgba(0,0,0,.35)'; g.shadowBlur = 6 * u; g.fillStyle = ic.col; g.beginPath(); g.roundRect(0, 0, ic.s, ic.s, ic.s * .24); g.fill(); g.shadowBlur = 0;
    if (ic.id === 'maps') { const lg = g.createLinearGradient(0, 0, 0, ic.s); lg.addColorStop(0, 'rgba(255,255,255,.25)'); lg.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = lg; g.beginPath(); g.roundRect(0, 0, ic.s, ic.s, ic.s * .24); g.fill(); if (press > 0 && launch === 0) { g.fillStyle = `rgba(255,255,255,${.25 * press})`; g.beginPath(); g.roundRect(0, 0, ic.s, ic.s, ic.s * .24); g.fill(); } }
    appGlyph(g, ic.id, 0, 0, ic.s);
    if (ic.label && !thumb) { g.fillStyle = '#e8edf3'; g.font = `600 ${Math.max(7, 2.7 * u)}px ${MONO}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(ic.label, ic.s / 2, ic.s + 4.5 * u); }
    g.restore();
  }
  g.restore();
  if (launch > 0 && maps) {
    const e = launch, rx = lerp(X + (W - maps.s) / 2, X, e), ry = lerp(Y + (H - maps.s) / 2, Y, e), rw = lerp(maps.s, W, e), rh = lerp(maps.s, H, e);
    g.save(); g.beginPath(); g.roundRect(rx, ry, rw, rh, lerp(maps.s * .24, 0, e)); g.clip();
    g.translate(rx, ry); g.scale(rw / W, rh / H); g.translate(-X, -Y); paintMap(g, X, Y, W, H, o); g.restore();
  }
}
