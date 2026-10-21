import { MONO } from '../util.js';
import { t } from '../minigames/i18n/index.js';

export function button(g, x, y, w, h, label, primary) {
  g.fillStyle = primary ? '#f4f7fb' : 'rgba(255,255,255,.1)';
  g.beginPath(); g.roundRect(x, y, w, h, 12); g.fill();
  g.fillStyle = primary ? '#15191f' : '#f4f7fb';
  g.font = `700 15px ${MONO}`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(label, x + w / 2, y + h / 2 + 1);
}

export function paintImage(g, img, x, y, w, h) {
  g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip();
  g.fillStyle = '#f4f0e6'; g.fillRect(x, y, w, h);
  if (img) g.drawImage(img, x, y, w, h);
  else { g.fillStyle = 'rgba(255,255,255,.06)'; g.fillRect(x, y, w, h); g.strokeStyle = 'rgba(255,255,255,.2)'; g.strokeRect(x + .5, y + .5, w - 1, h - 1); }
  g.restore();
}

export function simBar(g, W) {
  // Below the camera island. The notch covers the top of the canvas, so a bar at y=0 is clipped.
  const text = t('sim.badge');
  g.fillStyle = 'rgba(0,0,0,.82)'; g.fillRect(0, 38, W, 22);
  g.fillStyle = '#f5d78e'; g.textAlign = 'center'; g.textBaseline = 'middle';
  let size = 10;
  g.font = `700 ${size}px ${MONO}`;
  while (size > 6.5 && g.measureText(text).width > W - 16) { size -= 0.5; g.font = `700 ${size}px ${MONO}`; }
  g.fillText(text, W / 2, 49);
}

export function heading(g, W, text, y) {
  g.fillStyle = '#f4f7fb'; g.font = `700 16px ${MONO}`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, W / 2, y);
}
