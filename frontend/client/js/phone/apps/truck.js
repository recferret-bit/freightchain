import { MONO, fmt, gearName } from '../../util.js';
import { st, disp, driveHull } from '../../state.js';
import { t } from '../../minigames/i18n/index.js';
import { PhoneApp } from '../app.js';
import { INSET, TOP, fill, caption, bar, clip } from '../kit.js';

/* Vehicle status, the way a truck screen shows speed and the four dash meters. */

const speed = () => { const k = st.v * 3.6; return k < 10 ? k.toFixed(1) : String(Math.round(k)); };

export class TruckApp extends PhoneApp {
  constructor() { super({ id: 'truck', label: 'TRUCK', color: '#5c6b7a' }); }

  paint(g, W, H) {
    fill(g, W, H, '#1c232b', '#101418');
    caption(g, 'KM/H', INSET, TOP - 8, '#8b98a5', 11);
    g.fillStyle = '#f4f7fb'; g.font = '300 64px system-ui, sans-serif'; g.textAlign = 'left'; g.textBaseline = 'middle';
    g.fillText(speed(), INSET, TOP + 36);
    const gx = W - 78, gy = TOP + 8;
    g.strokeStyle = '#8b98a5'; g.lineWidth = 1.5; g.strokeRect(gx, gy, 52, 44);
    g.fillStyle = '#f4f7fb'; g.font = `700 22px ${MONO}`; g.textAlign = 'center';
    g.fillText(gearName(st.gear), gx + 26, gy + 24);
    if (st.park) {
      g.fillStyle = '#e23b2f'; g.beginPath(); g.roundRect(gx, gy + 52, 52, 20, 6); g.fill();
      g.fillStyle = '#fff'; g.font = `700 11px ${MONO}`; g.fillText('PARK', gx + 26, gy + 62);
    }
    const meters = [
      ['BODY', driveHull() / 100, '#6fbf73'],
      ['HULL', st.hull / 100, '#c45b4a'],
      ['FUEL', disp.fuel, '#e0b15a'],
      ['TEMP', disp.temp, '#e0714a'],
      ['BATT', st.batt, '#7eb6e0'],
    ];
    meters.forEach((m, i) => {
      const y = TOP + 120 + i * 52;
      caption(g, m[0], INSET, y, '#8b98a5', 11);
      bar(g, INSET, y + 14, W - 32, 10, m[1], m[2]);
    });
    const foot = TOP + 120 + meters.length * 52 + 6;
    g.fillStyle = '#c5ced8'; g.font = `600 13px ${MONO}`; g.textAlign = 'left'; g.textBaseline = 'middle';
    g.fillText(fmt(st.t) + '   ' + (st.s / 1000).toFixed(1) + ' km', INSET, foot);
    caption(g, clip(g, t('app.truck'), W - 32), INSET, foot + 20, '#8b98a5', 12);
  }
}
