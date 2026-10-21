import { MONO } from '../../util.js';
import { PhoneApp } from '../app.js';
import { simBar } from '../chrome.js';
import { t } from '../../minigames/i18n/index.js';
import { hosts, paintJob } from '../../minigames/play.js';
import { INSET, fill, caption, wrap } from '../kit.js';

/* Rig Wallet, drawn as a card stack. In-game only: no address, no code, no signature. */

function chip(g, x, y) {
  g.fillStyle = '#e6c56a'; g.beginPath(); g.roundRect(x, y, 28, 22, 4); g.fill();
  g.strokeStyle = '#8a6a28'; g.lineWidth = 1;
  g.strokeRect(x + 4, y + 4, 20, 14);
  g.beginPath(); g.moveTo(x + 14, y + 4); g.lineTo(x + 14, y + 18); g.moveTo(x + 4, y + 11); g.lineTo(x + 24, y + 11); g.stroke();
}

function pass(g, x, y, w, h, top, bottom) {
  const bg = g.createLinearGradient(x, y, x + w, y + h);
  bg.addColorStop(0, top); bg.addColorStop(1, bottom);
  g.fillStyle = bg; g.beginPath(); g.roundRect(x, y, w, h, 18); g.fill();
}

export class WalletApp extends PhoneApp {
  constructor() { super({ id: 'wallet', label: 'WALLET', color: '#c9862a' }); }

  paint(g, W, H, os) {
    const job = os.job;
    if (job && hosts(this.id, job.kind)) { paintJob(g, W, H, job); return; }
    fill(g, W, H, '#1a140c', '#0c0a08');
    simBar(g, W);
    caption(g, t('app.wallet'), INSET, 78, '#f5d78e', 13);
    const x = INSET, w = W - 32;
    pass(g, x, 98, w, 168, '#6a4a22', '#3a2814');
    caption(g, 'YARD', x + 16, 118, '#f0d7a4', 12);
    pass(g, x, 168, w, 188, '#e0a24a', '#8a5a1c');
    caption(g, 'RIG', x + 16, 192, '#2a1c0c', 12);
    chip(g, x + w - 48, 180);
    g.fillStyle = '#2a1c0c'; g.beginPath(); g.roundRect(x + 18, 262, 92, 10, 5); g.fill();
    g.font = `600 12px ${MONO}`; g.fillStyle = '#cbbba0'; g.textAlign = 'left';
    wrap(g, t('app.wallet.empty'), W - 48).forEach((line, i) => g.fillText(line, INSET, 390 + i * 18));
  }
}
