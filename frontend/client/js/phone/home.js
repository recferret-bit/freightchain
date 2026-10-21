import { dn } from '../state.js';
import { MONO } from '../util.js';
import { phone } from '../phone.js';
import { MG_GRID } from '../../shared/minigame-kinds.js';
import { paintGlyph } from './icons.js';
import { appById } from './catalog.js';

/* Launcher: 4 columns × 3 rows (12 slots) plus the dock. A personal order from the open minigame replaces the grid.
   Empty slots stay empty. Nothing on this screen auto-opens Maps. */

export const DOCK_IDS = Object.freeze(['calls', 'web', 'music']);

export function homeLayout(X, Y, W, H, thumb, order) {
  const cols = 4, u = W / 100, s = 18 * u, gap = (100 - cols * 18) / (cols + 1) * u, rowH = s + (thumb ? 5 : 13) * u;
  const y0 = Y + H * (thumb ? .18 : .22);
  const ids = order?.length === 12 ? order : (phone.iconOrder?.length === 12 ? phone.iconOrder : MG_GRID);
  const icons = [];
  ids.forEach((id, i) => {
    if (!id || !appById(id)) return;
    icons.push({ id, x: X + gap + (i % cols) * (s + gap), y: y0 + Math.floor(i / cols) * rowH, s, i, dock: false });
  });
  DOCK_IDS.forEach((id, i) => {
    if (!appById(id)) return;
    icons.push({ id, x: X + W / 2 + (i - 1) * (s + gap) - s / 2, y: Y + H - s - (thumb ? 4 : 7) * u, s, i: 20 + i, dock: true });
  });
  return { u, icons, dockY: Y + H - s - (thumb ? 6 : 9) * u, dockH: s + (thumb ? 4 : 6) * u };
}

export function paintLauncher(g, X, Y, W, H, t, thumb, focus = -1) {
  const L = homeLayout(X, Y, W, H, thumb), u = L.u, wake = 1 - (1 - Math.min(1, Math.max(0, t / 350))) ** 3;
  g.save(); g.beginPath(); g.rect(X, Y, W, H); g.clip();
  g.fillStyle = '#05060b'; g.fillRect(X, Y, W, H);
  const bg = g.createLinearGradient(0, Y, 0, Y + H); bg.addColorStop(0, '#12141c'); bg.addColorStop(.55, '#1a2433'); bg.addColorStop(1, '#101816');
  g.fillStyle = bg; g.fillRect(X, Y, W, H);
  const hh = Math.floor(dn.t) % 24, mm = Math.floor((dn.t % 1) * 60);
  const clock = String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
  g.globalAlpha = wake; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#e8edf3';
  g.font = `300 ${Math.max(8, (thumb ? 9 : 16) * u)}px ${MONO}`; g.fillText(clock, X + W / 2, Y + H * (thumb ? .1 : .12));
  if (phone.notice && !thumb) {
    g.fillStyle = 'rgba(8,10,14,.72)'; g.beginPath(); g.roundRect(X + 8, Y + 28, W - 16, 32, 8); g.fill();
    g.fillStyle = '#f2f5f8'; g.font = `600 ${Math.max(9, 3.1 * u)}px ${MONO}`; g.fillText(phone.notice, X + W / 2, Y + 44);
  }
  g.fillStyle = 'rgba(255,255,255,.08)'; g.beginPath(); g.roundRect(X + 3 * u, L.dockY, W - 6 * u, L.dockH, 8 * u); g.fill();
  L.icons.forEach((ic, n) => {
    const meta = appById(ic.id); if (!meta) return;
    const pop = 1 - (1 - Math.min(1, Math.max(0, (t - 80 - ic.i * 40) / 320))) ** 3;
    g.save(); g.globalAlpha = wake * pop;
    g.translate(ic.x, ic.y);
    if (focus === n && !thumb) { g.strokeStyle = '#f4f7fb'; g.lineWidth = 2; g.beginPath(); g.roundRect(-3, -3, ic.s + 6, ic.s + 6, ic.s * .28); g.stroke(); }
    g.fillStyle = meta.color; g.beginPath(); g.roundRect(0, 0, ic.s, ic.s, ic.s * .24); g.fill();
    g.save(); g.translate(ic.s / 2, ic.s / 2); g.scale(ic.s / 40, ic.s / 40); paintGlyph(g, ic.id); g.restore();
    if (phone.badge?.id === ic.id) {
      g.fillStyle = '#e23b2f'; g.beginPath(); g.arc(ic.s - 1, 2, ic.s * .16, 0, 7); g.fill();
      g.fillStyle = '#fff'; g.font = `700 ${Math.max(8, ic.s * .22)}px ${MONO}`; g.textAlign = 'center'; g.fillText(String(phone.badge.n || 1), ic.s - 1, 3);
    }
    if (!thumb && !ic.dock) {
      g.fillStyle = '#e8edf3'; g.font = `600 ${Math.max(8, 2.6 * u)}px ${MONO}`; g.textAlign = 'center';
      g.fillText(meta.label, ic.s / 2, ic.s + 5.2 * u);
    }
    g.restore();
  });
  g.restore();
}
