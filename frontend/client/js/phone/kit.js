import { MONO } from '../util.js';

/* Shared phone-app chrome. The camera island covers the top of the canvas, and the OS home pill covers the bottom. */

export const INSET = 16;
export const TOP = 58;
export const FOOT = 44;

export function fill(g, W, H, top, bottom) {
  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, top); bg.addColorStop(1, bottom);
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
}

export function title(g, text, y = TOP) {
  g.fillStyle = '#f4f7fb'; g.font = `700 22px ${MONO}`; g.textAlign = 'left'; g.textBaseline = 'middle';
  g.fillText(text, INSET, y);
}

export function caption(g, text, x, y, color = '#9aa6b2', size = 12) {
  g.fillStyle = color; g.font = `600 ${size}px ${MONO}`; g.textAlign = 'left'; g.textBaseline = 'middle';
  g.fillText(text, x, y);
}

export function card(g, x, y, w, h, color = 'rgba(255,255,255,.08)', r = 16) {
  g.fillStyle = color; g.beginPath(); g.roundRect(x, y, w, h, r); g.fill();
}

export function bar(g, x, y, w, h, t, color) {
  const k = Math.max(0, Math.min(1, t));
  g.fillStyle = 'rgba(255,255,255,.12)'; g.beginPath(); g.roundRect(x, y, w, h, h / 2); g.fill();
  g.fillStyle = color; g.beginPath(); g.roundRect(x, y, Math.max(h, w * k), h, h / 2); g.fill();
}

/** Clip a label so a row never spills into the next one. */
export function clip(g, text, max) {
  if (g.measureText(text).width <= max) return text;
  let s = text;
  while (s.length > 1 && g.measureText(s + '…').width > max) s = s.slice(0, -1);
  return s + '…';
}

/** Break a sentence into lines that fit `max` pixels. */
export function wrap(g, text, max) {
  const words = String(text).split(/\s+/), lines = [];
  let line = '';
  for (const word of words) {
    const next = line ? line + ' ' + word : word;
    if (line && g.measureText(next).width > max) { lines.push(line); line = word; }
    else line = next;
  }
  if (line) lines.push(line);
  return lines;
}
