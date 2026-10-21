import { MONO } from '../../util.js';
import { t } from '../../minigames/i18n/index.js';
import { PhoneApp } from '../app.js';
import { TOP, fill, card, wrap } from '../kit.js';

/* Mobile browser chrome. The page is the offline state, not a site. */

export class WebApp extends PhoneApp {
  constructor() { super({ id: 'web', label: 'WEB', color: '#1a73e8', dock: true }); }

  paint(g, W, H) {
    fill(g, W, H, '#1c1f24', '#1c1f24');
    g.fillStyle = '#e7e9ee'; g.fillRect(0, TOP + 28, W, H);
    card(g, 16, TOP - 8, W - 32, 28, '#2a2e34', 14);
    g.fillStyle = '#c5ced8'; g.font = `600 12px ${MONO}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('offline', W / 2, TOP + 6);
    const cx = W / 2, cy = TOP + 120;
    g.strokeStyle = '#5c6b7a'; g.lineWidth = 3; g.lineCap = 'round';
    g.beginPath(); g.moveTo(cx, cy + 28); g.lineTo(cx, cy + 8); g.stroke();
    g.beginPath(); g.arc(cx, cy - 8, 16, Math.PI * 1.15, Math.PI * 1.85); g.stroke();
    g.beginPath(); g.arc(cx, cy - 8, 28, Math.PI * 1.2, Math.PI * 1.8); g.stroke();
    g.beginPath(); g.moveTo(cx - 22, cy + 6); g.lineTo(cx + 22, cy - 28); g.stroke();
    g.fillStyle = '#3c4652'; g.font = `600 13px ${MONO}`; g.textAlign = 'center';
    wrap(g, t('app.web'), W - 48).forEach((line, i) => g.fillText(line, W / 2, cy + 64 + i * 18));
  }
}
