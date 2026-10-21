import { MONO } from '../../util.js';
import { dn, weather } from '../../state.js';
import { t } from '../../minigames/i18n/index.js';
import { PhoneApp } from '../app.js';
import { INSET, TOP, fill, caption, card } from '../kit.js';

/* iOS-style weather. The glyph follows the live sky: snow, night, or sun. No city is invented. */

const tempC = () => Math.round(weather.ambient - 6 * dn.k);

function sun(g, x, y) {
  g.fillStyle = '#f6d365'; g.beginPath(); g.arc(x, y, 18, 0, 7); g.fill();
  g.strokeStyle = '#f6d365'; g.lineWidth = 2;
  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI / 4;
    g.beginPath(); g.moveTo(x + Math.cos(a) * 24, y + Math.sin(a) * 24); g.lineTo(x + Math.cos(a) * 32, y + Math.sin(a) * 32); g.stroke();
  }
}

function moon(g, x, y) {
  g.fillStyle = '#e7eef8'; g.beginPath(); g.arc(x, y, 18, 0, 7); g.fill();
  g.fillStyle = '#16324f'; g.beginPath(); g.arc(x + 8, y - 4, 14, 0, 7); g.fill();
}

function snow(g, x, y, color) {
  g.strokeStyle = color; g.lineWidth = 2; g.lineCap = 'round';
  for (let i = 0; i < 6; i++) {
    const a = i * Math.PI / 3, dx = Math.cos(a), dy = Math.sin(a);
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + dx * 16, y + dy * 16); g.stroke();
    const bx = x + dx * 9, by = y + dy * 9;
    g.beginPath();
    g.moveTo(bx, by); g.lineTo(bx + Math.cos(a + .6) * 6, by + Math.sin(a + .6) * 6);
    g.moveTo(bx, by); g.lineTo(bx + Math.cos(a - .6) * 6, by + Math.sin(a - .6) * 6);
    g.stroke();
  }
}

function cloud(g, x, y, s) {
  g.fillStyle = 'rgba(255,255,255,.72)';
  g.beginPath(); g.arc(x, y, s, 0, 7); g.arc(x + s * .9, y + 3, s * .72, 0, 7); g.arc(x - s * .8, y + 4, s * .62, 0, 7); g.fill();
}

export class WeatherApp extends PhoneApp {
  constructor() { super({ id: 'weather', label: 'WEATHER', color: '#1a8fe3' }); }

  paint(g, W, H) {
    const night = dn.k > 0.55, flakes = weather.snow > 0.4;
    fill(g, W, H, flakes ? '#8ea4b8' : night ? '#0c1b33' : '#3d8ed4', flakes ? '#d5dde6' : night ? '#16324f' : '#8ec6ef');
    caption(g, t('app.weather'), INSET, TOP, night || !flakes ? '#d5e6f5' : '#1c2830', 13);
    g.fillStyle = night || !flakes ? '#f4f7fb' : '#1c2830';
    g.font = `300 64px ${MONO}`; g.textAlign = 'left'; g.textBaseline = 'middle';
    g.fillText(tempC() + '°', INSET, TOP + 48);
    if (flakes) snow(g, W - 56, TOP + 40, '#1c3348');
    else if (night) moon(g, W - 56, TOP + 40);
    else sun(g, W - 56, TOP + 40);
    if (flakes) { snow(g, 48, TOP + 210, '#24506e'); snow(g, W - 64, TOP + 270, '#24506e'); snow(g, W / 2, TOP + 340, '#1c3348'); }
    else if (night) {
      g.fillStyle = '#f4f7fb';
      [[40, 200], [W - 50, 240], [W * .4, 280], [W * .7, 340], [30, 380]].forEach(([sx, sy]) => { g.beginPath(); g.arc(sx, sy, 1.4, 0, 7); g.fill(); });
    } else { cloud(g, 54, TOP + 210, 16); cloud(g, W - 70, TOP + 280, 22); }
    const stats = [['SNOW', weather.snow.toFixed(2)], ['NIGHT', dn.k.toFixed(2)], ['AIR', Math.round(weather.ambient) + '°']];
    const cw = (W - 32 - 16) / 3;
    stats.forEach((s, i) => {
      const x = INSET + i * (cw + 8), y = TOP + 100;
      card(g, x, y, cw, 64, flakes ? 'rgba(16,28,40,.55)' : 'rgba(0,0,0,.22)', 14);
      g.fillStyle = '#d5e6f5'; g.font = `600 10px ${MONO}`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(s[0], x + cw / 2, y + 22);
      g.font = `700 16px ${MONO}`; g.fillText(s[1], x + cw / 2, y + 44);
    });
  }
}
