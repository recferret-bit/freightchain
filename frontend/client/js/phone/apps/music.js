import { MONO } from '../../util.js';
import { t } from '../../minigames/i18n/index.js';
import { PhoneApp } from '../app.js';
import { INSET, TOP, fill, title, card, clip } from '../kit.js';

/* Cab tapes. A cassette deck, not the dash radio, and nothing here starts playback. */

const TAPES = ['Night mile', 'Dock lights', 'Empty trailer'];

export class MusicApp extends PhoneApp {
  constructor() { super({ id: 'music', label: 'MUSIC', color: '#c4513e', dock: true }); }

  paint(g, W, H) {
    fill(g, W, H, '#2a1614', '#120c0b');
    title(g, t('app.music'));
    const x = INSET, y = TOP + 22, w = W - 32, h = 128;
    card(g, x, y, w, h, '#6b3d30', 18);
    g.fillStyle = '#1a0e0c'; g.beginPath(); g.roundRect(x + 16, y + 16, w - 32, 62, 8); g.fill();
    g.strokeStyle = '#e7b2a4'; g.lineWidth = 1.5; g.stroke();
    g.fillStyle = '#e7b2a4';
    [[18, 18], [w - 22, 18], [18, h - 22], [w - 22, h - 22]].forEach(([sx, sy]) => { g.beginPath(); g.arc(x + sx, y + sy, 2.2, 0, 7); g.fill(); });
    g.strokeStyle = '#e7b2a4'; g.lineWidth = 2; g.fillStyle = '#e7b2a4';
    const reelY = y + 47;
    g.beginPath(); g.arc(x + 52, reelY, 20, 0, 7); g.stroke();
    g.beginPath(); g.arc(x + w - 52, reelY, 20, 0, 7); g.stroke();
    g.beginPath(); g.arc(x + 52, reelY, 5, 0, 7); g.fill();
    g.beginPath(); g.arc(x + w - 52, reelY, 5, 0, 7); g.fill();
    g.beginPath(); g.moveTo(x + 72, reelY - 3); g.lineTo(x + w - 72, reelY - 3); g.moveTo(x + 72, reelY + 4); g.lineTo(x + w - 72, reelY + 4); g.stroke();
    g.fillStyle = '#f3d2c6'; g.font = `700 12px ${MONO}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(TAPES[0], x + w / 2, y + h - 18);
    TAPES.forEach((name, i) => {
      const ry = y + h + 18 + i * 52;
      card(g, INSET, ry, W - 32, 44, 'rgba(255,255,255,.06)', 12);
      g.fillStyle = i === 0 ? '#c4513e' : '#6b3a32'; g.beginPath(); g.arc(INSET + 22, ry + 22, 8, 0, 7); g.fill();
      g.fillStyle = '#f4f7fb'; g.font = `600 13px ${MONO}`; g.textAlign = 'left';
      g.fillText(clip(g, name, W - 90), INSET + 40, ry + 22);
    });
  }
}
