import { MONO } from '../../util.js';
import { st } from '../../state.js';
import { radio } from '../../sim/radio.js';
import { phone } from '../../phone.js';
import { t } from '../../minigames/i18n/index.js';
import { PhoneApp } from '../app.js';
import { INSET, TOP, fill, title, card, wrap } from '../kit.js';

/* Grouped list of live cab state. Values are readouts: nothing on this screen is a control. */

export class SettingsApp extends PhoneApp {
  constructor() { super({ id: 'cog', label: 'SETTINGS', color: '#6b7280' }); }

  paint(g, W, H) {
    fill(g, W, H, '#16181c', '#101114');
    title(g, 'SETTINGS');
    const rows = [
      ['Radio', radio.on ? 'ON' : 'OFF'],
      ['Brake', st.park ? 'PARK' : 'OFF'],
      ['Engine', st.engineOn ? 'RUN' : 'OFF'],
      ['Language', phone.lang === 'ru' ? 'RU' : 'EN'],
    ];
    const y0 = TOP + 24, rh = 48;
    card(g, INSET, y0, W - 32, rh * rows.length, 'rgba(255,255,255,.06)', 14);
    rows.forEach((row, i) => {
      const y = y0 + i * rh;
      if (i) { g.strokeStyle = 'rgba(255,255,255,.08)'; g.beginPath(); g.moveTo(INSET + 14, y); g.lineTo(W - INSET - 14, y); g.stroke(); }
      g.fillStyle = '#f4f7fb'; g.font = `600 14px ${MONO}`; g.textAlign = 'left'; g.textBaseline = 'middle';
      g.fillText(row[0], INSET + 16, y + rh / 2);
      g.fillStyle = '#9aa6b2'; g.textAlign = 'right';
      g.fillText(row[1], W - INSET - 16, y + rh / 2);
    });
    g.font = `600 12px ${MONO}`; g.fillStyle = '#9aa6b2'; g.textAlign = 'left';
    wrap(g, t('app.settings'), W - 48).forEach((line, i) => g.fillText(line, INSET + 4, y0 + rh * rows.length + 28 + i * 16));
  }
}
