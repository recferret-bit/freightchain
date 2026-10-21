import { MONO } from '../../util.js';
import { disp, driveHull } from '../../state.js';
import { PhoneApp } from '../app.js';
import { t } from '../../minigames/i18n/index.js';
import { machine } from '../../minigames/machine.js';
import { INSET, TOP, FOOT, fill, caption, bar, wrap } from '../kit.js';
import { gulp, toggleGas, toggleFix, sendCode, pushDigit, backDigit, confirmCode } from '../gulp-state.js';

/* GULP station. The four digits are never drawn here — they live in Messages until the bay is done. */

const YEL = '#f5c400';
const INK = '#1a1408';

function ready() { return gulp.at && (gulp.gas || gulp.fix); }

function pickHits(W) {
  const w = (W - 32 - 16) / 3, y = TOP + 168;
  return [
    { id: 'gulp:fill', x: INSET, y, w, h: 58 },
    { id: 'gulp:half', x: INSET + w + 8, y, w, h: 58 },
    { id: 'gulp:body', x: INSET + (w + 8) * 2, y, w, h: 58 },
    { id: 'gulp:send', x: INSET, y: y + 78, w: W - 32, h: 52 },
  ];
}

function padHits(W) {
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'back', '0', 'ok'];
  const bw = (W - 32 - 16) / 3, bh = 48, y0 = TOP + 196;
  return keys.map((id, i) => ({
    id: 'gulp:' + id, x: INSET + (i % 3) * (bw + 8), y: y0 + Math.floor(i / 3) * (bh + 8), w: bw, h: bh,
  }));
}

function button(g, h, on, label) {
  g.fillStyle = on ? YEL : '#2a2418';
  g.beginPath(); g.roundRect(h.x, h.y, h.w, h.h, 12); g.fill();
  if (!on) { g.strokeStyle = '#6b5a28'; g.lineWidth = 1.5; g.stroke(); }
  g.fillStyle = on ? INK : '#f6edd4';
  g.font = `700 15px ${MONO}`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(label, h.x + h.w / 2, h.y + h.h / 2);
}

function status(g, W, text, color = '#d9cba6') {
  g.fillStyle = color; g.font = `600 13px ${MONO}`; g.textAlign = 'left'; g.textBaseline = 'middle';
  wrap(g, text, W - 32).slice(0, 2).forEach((line, i) => g.fillText(line, INSET, TOP + 78 + i * 18));
}

export class GulpApp extends PhoneApp {
  constructor() { super({ id: 'gulp', label: 'GULP', color: YEL }); }

  paint(g, W, H) {
    fill(g, W, H, '#241c10', '#12100c');
    g.fillStyle = YEL; g.fillRect(0, 34, W, 52);
    g.fillStyle = INK; g.font = `800 26px ${MONO}`; g.textAlign = 'left'; g.textBaseline = 'middle';
    g.fillText('GULP', INSET, 52);
    g.font = `600 12px ${MONO}`; g.fillText(t('gulp.tag'), INSET, 74);
    if (gulp.phase === 'done') return this.paintDone(g, W, H);
    if (gulp.phase === 'code') return this.paintCode(g, W, H);
    this.paintPick(g, W, H);
  }

  paintMeters(g, W) {
    caption(g, 'FUEL', INSET, TOP + 112, '#b7a888', 11);
    bar(g, INSET + 52, TOP + 108, W - 84, 10, disp.fuel, YEL);
    caption(g, 'BODY', INSET, TOP + 136, '#b7a888', 11);
    bar(g, INSET + 52, TOP + 132, W - 84, 10, driveHull() / 100, '#8fd18a');
  }

  paintPick(g, W, H) {
    const line = !gulp.seen || gulp.phase === 'idle' ? t('gulp.find') : gulp.at ? t('gulp.here') : t('gulp.away');
    status(g, W, line);
    this.paintMeters(g, W);
    const hits = pickHits(W);
    button(g, hits[0], gulp.gas === 'fill', t('gulp.fill'));
    button(g, hits[1], gulp.gas === 'half', t('gulp.half'));
    button(g, hits[2], gulp.fix, t('gulp.body'));
    const go = ready();
    g.globalAlpha = go ? 1 : 0.45;
    button(g, hits[3], go, t('gulp.send'));
    g.globalAlpha = 1;
    if (H) {
      g.fillStyle = '#8c7d62'; g.font = `600 11px ${MONO}`; g.textAlign = 'left'; g.textBaseline = 'middle';
      wrap(g, t('gulp.lane'), W - 32).slice(0, 2).forEach((line, i) => g.fillText(line, INSET, H - FOOT - 22 + i * 14));
    }
  }

  paintCode(g, W) {
    status(g, W, gulp.at ? t('gulp.remember') : t('gulp.away'), gulp.wrong ? '#e07060' : '#d9cba6');
    if (gulp.wrong) caption(g, t('gulp.wrong'), INSET, TOP + 112, '#e07060', 12);
    const slots = padHits(W);
    const boxW = 36, gap = 10, x0 = (W - (boxW * 4 + gap * 3)) / 2, y = TOP + 132;
    for (let i = 0; i < 4; i++) {
      g.fillStyle = '#2a2418'; g.beginPath(); g.roundRect(x0 + i * (boxW + gap), y, boxW, 44, 8); g.fill();
      g.fillStyle = YEL; g.font = `700 22px ${MONO}`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(gulp.typed[i] ? '●' : '', x0 + i * (boxW + gap) + boxW / 2, y + 22);
    }
    const labels = { back: '⌫', ok: t('gulp.ok') };
    for (const h of slots) button(g, h, h.id === 'gulp:ok', labels[h.id.slice(5)] ?? h.id.slice(5));
  }

  paintDone(g, W, H) {
    status(g, W, t('gulp.done'), '#d9cba6');
    this.paintMeters(g, W);
    g.fillStyle = YEL; g.beginPath(); g.arc(W / 2, (TOP + 220 + H - FOOT) / 2, 28, 0, 7); g.fill();
    g.strokeStyle = INK; g.lineWidth = 4; g.lineCap = 'round'; g.lineJoin = 'round';
    g.beginPath(); g.moveTo(W / 2 - 12, (TOP + 220 + H - FOOT) / 2); g.lineTo(W / 2 - 2, (TOP + 220 + H - FOOT) / 2 + 10); g.lineTo(W / 2 + 14, (TOP + 220 + H - FOOT) / 2 - 10); g.stroke();
  }

  hits(W) {
    if (gulp.phase === 'code') return padHits(W);
    if (gulp.phase === 'pick') return pickHits(W);
    return [];
  }

  onPress(id) {
    if (id === 'gulp:fill') toggleGas('fill');
    else if (id === 'gulp:half') toggleGas('half');
    else if (id === 'gulp:body') toggleFix();
    else if (id === 'gulp:send') sendCode();
    else if (id === 'gulp:back') backDigit();
    else if (id === 'gulp:ok') confirmCode();
    else if (/^gulp:[0-9]$/.test(id)) pushDigit(id.slice(5));
  }

  onKey(e) {
    if (machine.phase === 'revealed' || machine.phase === 'answering') return false;
    if (gulp.phase !== 'code') return false;
    if (/^Digit[0-9]$/.test(e.code)) { pushDigit(e.code.slice(5)); return true; }
    if (e.code === 'Backspace') { backDigit(); return true; }
    if (e.code === 'Enter') { confirmCode(); return true; }
    return false;
  }
}
