import { MONO } from '../../util.js';
import { radio } from '../../sim/radio.js';
import { STATIONS } from '../../sim/radio-composer.js';
import { t } from '../../minigames/i18n/index.js';
import { PhoneApp } from '../app.js';
import { INSET, TOP, FOOT, fill, caption, clip } from '../kit.js';

/* Car-stereo tuner. The dash radio owns the station; this screen only shows it. */

export class RadioApp extends PhoneApp {
  constructor() { super({ id: 'radio', label: 'RADIO', color: '#e8710a' }); }

  paint(g, W, H) {
    fill(g, W, H, '#2a1810', '#100c09');
    const stn = radio.station, on = !!radio.on;
    g.globalAlpha = on ? 1 : .45;
    caption(g, 'FM', INSET, TOP - 14, '#e8710a', 11);
    g.fillStyle = '#f6e7d4'; g.textAlign = 'left'; g.textBaseline = 'middle';
    if (on && stn) { g.font = `700 40px ${MONO}`; g.fillText(stn.freq.toFixed(1), INSET, TOP + 16); }
    else {
      for (let i = 0; i < 4; i++) { g.beginPath(); g.roundRect(INSET + i * 26, TOP + 8, i === 2 ? 8 : 18, 8, 3); g.fill(); }
    }
    g.font = `700 13px ${MONO}`; g.fillStyle = '#f4f7fb';
    g.fillText(clip(g, on && stn ? stn.name : t('app.radio.off'), W - 32), INSET, TOP + 46);
    if (on && stn?.tag) caption(g, stn.tag, INSET, TOP + 64, '#c9a27a', 11);
    const y = TOP + 84, x0 = INSET, x1 = W - INSET;
    g.strokeStyle = 'rgba(246,231,212,.45)'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(x0, y); g.lineTo(x1, y); g.stroke();
    for (let f = 88; f <= 108; f += 2) {
      const x = x0 + (f - 88) / 20 * (x1 - x0), tall = f % 10 === 0;
      g.beginPath(); g.moveTo(x, y - (tall ? 8 : 4)); g.lineTo(x, y + (tall ? 8 : 4)); g.stroke();
    }
    if (on && stn) {
      const x = x0 + (Math.min(108, Math.max(88, stn.freq)) - 88) / 20 * (x1 - x0);
      g.fillStyle = '#e8710a'; g.beginPath(); g.moveTo(x, y - 10); g.lineTo(x - 5, y); g.lineTo(x + 5, y); g.fill();
    }
    g.globalAlpha = 1;
    const top = TOP + 104, rowH = Math.max(16, Math.min(26, (H - FOOT - top - 36) / STATIONS.length));
    STATIONS.forEach((s, i) => {
      const ry = top + i * rowH, hot = i === radio.idx;
      if (hot) { g.fillStyle = 'rgba(232,113,10,.2)'; g.fillRect(0, ry, W, rowH); g.fillStyle = '#e8710a'; g.fillRect(0, ry, 3, rowH); }
      g.font = `600 11px ${MONO}`; g.textBaseline = 'middle'; g.textAlign = 'left';
      g.fillStyle = hot ? '#f6e7d4' : '#cbbbaa';
      g.fillText(clip(g, s.name, W * .62), INSET, ry + rowH / 2);
      g.textAlign = 'right'; g.fillStyle = hot ? '#e8710a' : '#8d7968';
      g.fillText(s.freq.toFixed(1), W - INSET, ry + rowH / 2);
    });
    if (on) caption(g, clip(g, t('app.radio'), W - 32), INSET, top + STATIONS.length * rowH + 14, '#c9a27a', 11);
  }
}
