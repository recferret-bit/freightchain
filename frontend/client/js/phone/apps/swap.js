import { MONO } from '../../util.js';
import { PhoneApp } from '../app.js';
import { simBar } from '../chrome.js';
import { t } from '../../minigames/i18n/index.js';
import { hosts, paintJob } from '../../minigames/play.js';
import { INSET, fill, caption, card, clip, wrap } from '../kit.js';

/* Yard board. Names are the game's ·fc lots. No price, no chart, no order until dispatch sends one. */

const LOTS = ['DIESEL·fc', 'AXLE·fc', 'FRD·fc', 'FUEL·fc', 'GRAVEL·fc'];

function mark(g, i, x, y) {
  g.save(); g.translate(x, y); g.strokeStyle = '#b7efe4'; g.lineWidth = 1.6;
  if (i === 0) { g.beginPath(); g.arc(0, 0, 8, 0, 7); g.stroke(); }
  else if (i === 1) g.strokeRect(-7, -7, 14, 14);
  else if (i === 2) { g.beginPath(); g.moveTo(0, -9); g.lineTo(8, 7); g.lineTo(-8, 7); g.closePath(); g.stroke(); }
  else if (i === 3) { g.beginPath(); g.moveTo(0, -8); g.lineTo(8, 0); g.lineTo(0, 8); g.lineTo(-8, 0); g.closePath(); g.stroke(); }
  else { g.beginPath(); g.moveTo(-8, 0); g.lineTo(8, 0); g.moveTo(0, -8); g.lineTo(0, 8); g.stroke(); }
  g.restore();
}

export class SwapApp extends PhoneApp {
  constructor() { super({ id: 'swap', label: 'SWAP', color: '#0f766e' }); }

  paint(g, W, H, os) {
    const job = os.job;
    if (job && hosts(this.id, job.kind)) { paintJob(g, W, H, job); return; }
    fill(g, W, H, '#10211e', '#0a1211');
    simBar(g, W);
    caption(g, t('app.swap'), INSET, 78, '#d7fff6', 16);
    LOTS.forEach((name, i) => {
      const y = 98 + i * 58;
      card(g, INSET, y, W - 32, 50, 'rgba(255,255,255,.06)', 14);
      mark(g, i, INSET + 26, y + 25);
      g.fillStyle = '#e7f6f2'; g.font = `600 14px ${MONO}`; g.textAlign = 'left'; g.textBaseline = 'middle';
      g.fillText(clip(g, name, W - 150), INSET + 46, y + 25);
      g.fillStyle = 'rgba(15,118,110,.7)'; g.beginPath(); g.roundRect(W - INSET - 62, y + 14, 46, 22, 11); g.fill();
      g.fillStyle = '#d7fff6'; g.font = `700 10px ${MONO}`; g.textAlign = 'center';
      g.fillText('YARD', W - INSET - 39, y + 25);
    });
    g.font = `600 12px ${MONO}`; g.fillStyle = '#9fb8b2'; g.textAlign = 'left';
    wrap(g, t('app.swap.empty'), W - 48).forEach((line, i) => g.fillText(line, INSET, H - 72 + i * 16));
  }
}
