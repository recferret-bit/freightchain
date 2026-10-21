import { MONO } from '../../util.js';
import { PhoneApp } from '../app.js';
import { t } from '../../minigames/i18n/index.js';
import { machine } from '../../minigames/machine.js';
import { INSET, TOP, FOOT, fill, caption, wrap } from '../kit.js';
import { pike, sendPike, pushPike, backPike, confirmPike } from '../pike-state.js';

/* PIKE toll. The four digits are never drawn here — they live in Messages until the arm is up. */

const ORANGE = '#ff5a1f';
const INK = '#1a120c';

function padHits(W) {
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'back', '0', 'ok'];
  const bw = (W - 32 - 16) / 3, bh = 48, y0 = TOP + 196;
  return keys.map((id, i) => ({
    id: 'pike:' + id, x: INSET + (i % 3) * (bw + 8), y: y0 + Math.floor(i / 3) * (bh + 8), w: bw, h: bh,
  }));
}

function button(g, h, on, label) {
  g.fillStyle = on ? ORANGE : '#2a2018';
  g.beginPath(); g.roundRect(h.x, h.y, h.w, h.h, 12); g.fill();
  if (!on) { g.strokeStyle = '#8a4a32'; g.lineWidth = 1.5; g.stroke(); }
  g.fillStyle = on ? INK : '#f6edd4';
  g.font = `700 16px ${MONO}`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(label, h.x + h.w / 2, h.y + h.h / 2);
}

function status(g, W, text, color = '#e6d2c4') {
  g.fillStyle = color; g.font = `600 13px ${MONO}`; g.textAlign = 'left'; g.textBaseline = 'middle';
  wrap(g, text, W - 32).slice(0, 3).forEach((line, i) => g.fillText(line, INSET, TOP + 78 + i * 18));
}

export class PikeApp extends PhoneApp {
  constructor() { super({ id: 'pike', label: 'PIKE', color: ORANGE }); }

  paint(g, W, H) {
    fill(g, W, H, '#241610', '#120e0c');
    g.fillStyle = ORANGE; g.fillRect(0, 34, W, 52);
    g.fillStyle = INK; g.font = `800 26px ${MONO}`; g.textAlign = 'left'; g.textBaseline = 'middle';
    g.fillText('PIKE', INSET, 52);
    g.font = `600 12px ${MONO}`; g.fillText(t('pike.tag'), INSET, 74);
    if (pike.phase === 'open') return this.paintOpen(g, W, H);
    if (pike.phase === 'code') return this.paintCode(g, W);
    const line = pike.at ? t('pike.here') : t('pike.find');
    status(g, W, line);
    const go = pike.at && pike.phase === 'pay';
    g.globalAlpha = go ? 1 : 0.45;
    button(g, { x: INSET, y: TOP + 160, w: W - 32, h: 58 }, go, t('pike.pay'));
    g.globalAlpha = 1;
    if (H) {
      g.fillStyle = '#a89080'; g.font = `600 11px ${MONO}`; g.textAlign = 'left'; g.textBaseline = 'middle';
      wrap(g, t('pike.wait'), W - 32).slice(0, 2).forEach((ln, i) => g.fillText(ln, INSET, H - FOOT - 22 + i * 14));
    }
  }

  paintCode(g, W) {
    status(g, W, pike.at ? t('pike.remember') : t('pike.away'), pike.wrong ? '#e07060' : '#e6d2c4');
    if (pike.wrong) caption(g, t('pike.wrong'), INSET, TOP + 112, '#e07060', 12);
    const slots = padHits(W);
    const boxW = 36, gap = 10, x0 = (W - (boxW * 4 + gap * 3)) / 2, y = TOP + 132;
    for (let i = 0; i < 4; i++) {
      g.fillStyle = '#2a2018'; g.beginPath(); g.roundRect(x0 + i * (boxW + gap), y, boxW, 44, 8); g.fill();
      g.fillStyle = ORANGE; g.font = `700 22px ${MONO}`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(pike.typed[i] ? '●' : '', x0 + i * (boxW + gap) + boxW / 2, y + 22);
    }
    const labels = { back: '⌫', ok: t('pike.ok') };
    for (const h of slots) button(g, h, h.id === 'pike:ok', labels[h.id.slice(5)] ?? h.id.slice(5));
  }

  paintOpen(g, W, H) {
    status(g, W, t('pike.open'));
    g.fillStyle = ORANGE; g.beginPath(); g.arc(W / 2, (TOP + 200 + H - FOOT) / 2, 28, 0, 7); g.fill();
    g.strokeStyle = INK; g.lineWidth = 4; g.lineCap = 'round'; g.lineJoin = 'round';
    const y = (TOP + 200 + H - FOOT) / 2;
    g.beginPath(); g.moveTo(W / 2 - 12, y); g.lineTo(W / 2 - 2, y + 10); g.lineTo(W / 2 + 14, y - 10); g.stroke();
  }

  hits(W) {
    if (pike.phase === 'code') return padHits(W);
    if (pike.phase === 'pay' || pike.phase === 'idle') return [{ id: 'pike:pay', x: INSET, y: TOP + 160, w: W - 32, h: 58 }];
    return [];
  }

  onPress(id) {
    if (id === 'pike:pay') sendPike();
    else if (id === 'pike:back') backPike();
    else if (id === 'pike:ok') confirmPike();
    else if (/^pike:[0-9]$/.test(id)) pushPike(id.slice(5));
  }

  onKey(e) {
    if (machine.phase === 'revealed' || machine.phase === 'answering') return false;
    if (pike.phase !== 'code') return false;
    if (/^Digit[0-9]$/.test(e.code)) { pushPike(e.code.slice(5)); return true; }
    if (e.code === 'Backspace') { backPike(); return true; }
    if (e.code === 'Enter') { confirmPike(); return true; }
    return false;
  }
}
