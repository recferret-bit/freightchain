import { MONO } from '../../util.js';
import { PhoneApp } from '../app.js';
import { t } from '../../minigames/i18n/index.js';
import { hosts, paintJob } from '../../minigames/play.js';
import { INSET, TOP, fill, title, card, wrap, caption } from '../kit.js';
import { gulp } from '../gulp-state.js';
import { pike } from '../pike-state.js';

/* Empty inbox. A live dispatch covers this screen; nothing here invents a thread. */

function bubble(g, x, y) {
  g.fillStyle = '#148f77';
  g.beginPath(); g.roundRect(x - 28, y - 22, 56, 40, 16); g.fill();
  g.beginPath(); g.moveTo(x - 10, y + 16); g.lineTo(x - 18, y + 30); g.lineTo(x + 4, y + 16); g.fill();
  g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = 2; g.lineCap = 'round';
  g.beginPath(); g.moveTo(x - 12, y - 2); g.lineTo(x + 12, y - 2); g.moveTo(x - 12, y + 6); g.lineTo(x + 6, y + 6); g.stroke();
}

export class MessagesApp extends PhoneApp {
  constructor() { super({ id: 'chat', label: 'MESSAGES', color: '#148f77' }); }

  paint(g, W, H, os) {
    const job = os.job;
    if (job && hosts(this.id, job.kind)) { paintJob(g, W, H, job); return; }
    const pays = [];
    if (gulp.phase === 'code' && gulp.code) pays.push({ brand: 'GULP', color: '#f5c400', code: gulp.code, body: t('gulp.sms.body') });
    if (pike.phase === 'code' && pike.code) pays.push({ brand: 'PIKE', color: '#ff5a1f', code: pike.code, body: t('pike.sms.body') });
    if (pays.length) { this.paintPays(g, W, H, pays); return; }
    fill(g, W, H, '#101418', '#0b0e12');
    title(g, 'MESSAGES');
    card(g, INSET, TOP + 22, W - 32, 32, 'rgba(255,255,255,.08)', 16);
    g.strokeStyle = '#8b98a5'; g.lineWidth = 1.5; g.lineCap = 'round';
    g.beginPath(); g.arc(INSET + 22, TOP + 38, 6, 0, 7); g.stroke();
    g.beginPath(); g.moveTo(INSET + 27, TOP + 43); g.lineTo(INSET + 32, TOP + 48); g.stroke();
    const cy = (TOP + 70 + H - 44) / 2;
    bubble(g, W / 2, cy - 28);
    g.fillStyle = '#c5ced8'; g.font = `600 13px ${MONO}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    wrap(g, t('sms.empty'), W - 64).forEach((line, i) => g.fillText(line, W / 2, cy + 28 + i * 18));
  }

  paintPays(g, W, H, pays) {
    fill(g, W, H, '#101418', '#0b0e12');
    title(g, 'MESSAGES');
    const h = pays.length > 1 ? 118 : 150;
    pays.forEach((p, i) => {
      const y = TOP + 20 + i * (h + 12);
      card(g, INSET, y, W - 32, h, '#2a2416', 18);
      g.fillStyle = p.color; g.font = `700 13px ${MONO}`; g.textAlign = 'left'; g.textBaseline = 'middle';
      g.fillText(p.brand, INSET + 16, y + 22);
      g.font = `700 ${pays.length > 1 ? 32 : 40}px ${MONO}`; g.textAlign = 'center';
      g.fillText(p.code, W / 2, y + (pays.length > 1 ? 62 : 78));
      caption(g, p.body, INSET + 16, y + h - 18, '#d9cba6', 12);
    });
  }
}
