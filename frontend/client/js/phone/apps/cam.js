import { fmt } from '../../util.js';
import { st } from '../../state.js';
import { t } from '../../minigames/i18n/index.js';
import { PhoneApp } from '../app.js';
import { TOP, FOOT, fill, wrap } from '../kit.js';

/* Dashcam chrome. The frame is a viewfinder, not a live picture of the road. */

export class CamApp extends PhoneApp {
  constructor() { super({ id: 'cam', label: 'CAMERA', color: '#3c4043' }); }

  paint(g, W, H) {
    fill(g, W, H, '#0a0c0e', '#050607');
    const x = 12, y = TOP, w = W - 24, h = H - TOP - FOOT - 36;
    g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = 2;
    g.strokeRect(x, y, w, h);
    g.fillStyle = '#1a2430'; g.fillRect(x + 1, y + 1, w - 2, h * .46);
    g.fillStyle = '#24302a'; g.fillRect(x + 1, y + h * .46, w - 2, h * .54);
    g.fillStyle = '#4a524c';
    g.beginPath();
    g.moveTo(x + w * .46, y + h * .46); g.lineTo(x + w * .54, y + h * .46);
    g.lineTo(x + w - 18, y + h - 8); g.lineTo(x + 18, y + h - 8); g.fill();
    g.strokeStyle = '#e4ebe6'; g.lineWidth = 2; g.setLineDash([7, 12]);
    g.beginPath(); g.moveTo(x + w / 2, y + h * .52); g.lineTo(x + w / 2, y + h - 18); g.stroke();
    g.setLineDash([]);
    g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 1;
    g.beginPath();
    g.moveTo(x + w / 3, y); g.lineTo(x + w / 3, y + h);
    g.moveTo(x + 2 * w / 3, y); g.lineTo(x + 2 * w / 3, y + h);
    g.moveTo(x, y + h / 3); g.lineTo(x + w, y + h / 3);
    g.moveTo(x, y + 2 * h / 3); g.lineTo(x + w, y + 2 * h / 3);
    g.stroke();
    g.fillStyle = '#e23b2f'; g.beginPath(); g.arc(x + 16, y + 16, 5, 0, 7); g.fill();
    g.fillStyle = '#f4f7fb'; g.font = `700 12px ui-monospace,Menlo,monospace`; g.textAlign = 'left'; g.textBaseline = 'middle';
    g.fillText('REC  ' + fmt(st.t), x + 28, y + 16);
    g.font = `600 12px ui-monospace,Menlo,monospace`; g.fillStyle = '#c5ced8'; g.textAlign = 'center';
    wrap(g, t('app.cam'), W - 40).forEach((line, i) => g.fillText(line, W / 2, y + h + 18 + i * 16));
  }
}
