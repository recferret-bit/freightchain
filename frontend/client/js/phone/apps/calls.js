import { MONO } from '../../util.js';
import { t } from '../../minigames/i18n/index.js';
import { PhoneApp } from '../app.js';
import { TOP, FOOT, fill, title, wrap } from '../kit.js';

/* Handset keypad. The letters are the familiar groups; nothing here places a call. The CB stays on the dash. */

const KEYS = [
  ['1', ''], ['2', 'ABC'], ['3', 'DEF'],
  ['4', 'GHI'], ['5', 'JKL'], ['6', 'MNO'],
  ['7', 'PQRS'], ['8', 'TUV'], ['9', 'WXYZ'],
  ['*', ''], ['0', '+'], ['#', ''],
];

export class CallsApp extends PhoneApp {
  constructor() { super({ id: 'calls', label: 'CALLS', color: '#188038', dock: true }); }

  paint(g, W, H) {
    fill(g, W, H, '#101412', '#070908');
    title(g, 'CALLS');
    g.font = `600 12px ${MONO}`; g.fillStyle = '#9fb8a8'; g.textAlign = 'center'; g.textBaseline = 'middle';
    const lines = wrap(g, t('app.calls'), W - 48);
    lines.forEach((line, i) => g.fillText(line, W / 2, TOP + 28 + i * 16));
    const s = Math.min(64, (W - 64) / 3), gap = 14, step = s * .92 + gap;
    const x0 = (W - (3 * s + 2 * gap)) / 2, y0 = H - FOOT - 8 - 4 * step;
    KEYS.forEach((key, i) => {
      const c = i % 3, r = Math.floor(i / 3);
      const x = x0 + c * (s + gap) + s / 2, y = y0 + r * step + s / 2;
      g.fillStyle = 'rgba(255,255,255,.08)'; g.beginPath(); g.arc(x, y, s / 2, 0, 7); g.fill();
      g.strokeStyle = 'rgba(255,255,255,.16)'; g.lineWidth = 1; g.stroke();
      g.fillStyle = '#f4f7fb'; g.font = `500 ${key[0] === '*' || key[0] === '#' ? 22 : 26}px ${MONO}`;
      g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(key[0], x, y - (key[1] ? 4 : 0));
      if (key[1]) { g.font = `600 8px ${MONO}`; g.fillStyle = '#9fb8a8'; g.fillText(key[1], x, y + 12); }
    });
  }
}
