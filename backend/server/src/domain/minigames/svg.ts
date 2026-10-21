/** Same pixel size per role, so the byte length of the image does not leak how many digits it holds. */
export const CODE_SVG = { w: 96, h: 28 };
export const TEXT_SVG = { w: 220, h: 28 };
/** Square, so the dispatch mark stays a shape when the phone draws it. */
export const MARK_SVG = { w: 96, h: 96 };

const DIGIT: Record<string, number[]> = {
  '0': [0b01110, 0b10001, 0b10011, 0b10101, 0b11001, 0b10001, 0b01110],
  '1': [0b00100, 0b01100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110],
  '2': [0b01110, 0b10001, 0b00001, 0b00010, 0b00100, 0b01000, 0b11111],
  '3': [0b01110, 0b10001, 0b00001, 0b00110, 0b00001, 0b10001, 0b01110],
  '4': [0b00010, 0b00110, 0b01010, 0b10010, 0b11111, 0b00010, 0b00010],
  '5': [0b11111, 0b10000, 0b11110, 0b00001, 0b00001, 0b10001, 0b01110],
  '6': [0b00110, 0b01000, 0b10000, 0b11110, 0b10001, 0b10001, 0b01110],
  '7': [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b01000, 0b01000],
  '8': [0b01110, 0b10001, 0b10001, 0b01110, 0b10001, 0b10001, 0b01110],
  '9': [0b01110, 0b10001, 0b10001, 0b01111, 0b00001, 0b00010, 0b01100],
};

const INK = '#1a1814';
const PAPER = '#f4f0e6';

function wrap(box: { w: number; h: number }, body: string): string {
  // A path, not a rect: callers tell a mark-only picture from a digit picture by the absence of `<rect>`.
  const bg = `<path d="M0 0 H${box.w} V${box.h} H0 Z" fill="${PAPER}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${box.w}" height="${box.h}" viewBox="0 0 ${box.w} ${box.h}">${bg}${body}</svg>`;
}

function noise(rnd: () => number, box: { w: number; h: number }): string {
  let out = '';
  for (let n = 0; n < 2; n++) {
    const x1 = Math.floor(rnd() * box.w);
    const y1 = Math.floor(rnd() * box.h);
    const x2 = Math.floor(rnd() * box.w);
    const y2 = Math.floor(rnd() * box.h);
    out += `<path d="M${x1} ${y1} L${x2} ${y2}" fill="none" stroke="#c4b8a4" stroke-width="1"/>`;
  }
  return out;
}

/** Seven marks a person can match at a glance. Paths and circles only, so a mark-only picture has no `<rect>`. */
export function markShape(mark: number, x: number, y: number, s: number): string {
  const n = (v: number) => Math.round(v);
  const x0 = x, y0 = y, x1 = x + s, y1 = y + s, cx = x + s / 2, cy = y + s / 2;
  switch (mark % 7) {
    case 0: return `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(s * 0.36)}" fill="${INK}"/>`;
    case 1: return `<path d="M${n(x0 + s * .18)} ${n(y0 + s * .18)} H${n(x1 - s * .18)} V${n(y1 - s * .18)} H${n(x0 + s * .18)} Z" fill="${INK}"/>`;
    case 2: return `<path d="M${n(cx)} ${n(y0 + s * .12)} L${n(x1 - s * .12)} ${n(y1 - s * .1)} L${n(x0 + s * .12)} ${n(y1 - s * .1)} Z" fill="${INK}"/>`;
    case 3: return `<path d="M${n(cx)} ${n(y0 + 2)} L${n(x1 - 2)} ${n(cy)} L${n(cx)} ${n(y1 - 2)} L${n(x0 + 2)} ${n(cy)} Z" fill="${INK}"/>`;
    case 4: {
      const t = s * 0.16;
      return `<path d="M${n(cx - t)} ${n(y0 + s * .14)} H${n(cx + t)} V${n(cy - t)} H${n(x1 - s * .14)} V${n(cy + t)} H${n(cx + t)} V${n(y1 - s * .14)} H${n(cx - t)} V${n(cy + t)} H${n(x0 + s * .14)} V${n(cy - t)} H${n(cx - t)} Z" fill="${INK}"/>`;
    }
    case 5: return `<path d="M${n(x0 + s * .14)} ${n(y0 + s * .2)} H${n(x1 - s * .14)} V${n(y0 + s * .38)} H${n(x0 + s * .14)} Z M${n(x0 + s * .14)} ${n(y0 + s * .58)} H${n(x1 - s * .14)} V${n(y0 + s * .76)} H${n(x0 + s * .14)} Z" fill="${INK}"/>`;
    default: return `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(s * 0.34)}" fill="none" stroke="${INK}" stroke-width="${Math.max(2, n(s * 0.16))}"/>`;
  }
}

function digitRects(code: string, rnd: () => number, box: { w: number; h: number }, originX: number): string {
  const scale = 2, step = 11, parts: string[] = [];
  [...code].forEach((ch, i) => {
    const rows = DIGIT[ch];
    if (!rows) return;
    const ox = originX + i * step, oy = 4;
    rows.forEach((bits, r) => {
      for (let c = 0; c < 5; c++) {
        if (((bits >> (4 - c)) & 1) === 0) continue;
        const x = Math.min(box.w - scale, Math.max(0, ox + c * scale + Math.floor(rnd() * 2)));
        const y = Math.min(box.h - scale, oy + r * scale + Math.floor(rnd() * 2));
        parts.push(`<rect x="${x}" y="${y}" width="${scale}" height="${scale}" fill="${INK}"/>`);
      }
    });
  });
  return parts.join('');
}

/** A mark and nothing else. The dispatch picture uses this, so the code is not in the message. */
export function renderMark(mark: number, rnd: () => number, box: { w: number; h: number }): string {
  const s = Math.round(Math.min(box.w, box.h) * 0.62);
  const x = Math.round((box.w - s) / 2) + Math.floor(rnd() * 3) - 1;
  const y = Math.round((box.h - s) / 2) + Math.floor(rnd() * 3) - 1;
  return wrap(box, markShape(mark, x, y, s) + noise(rnd, box));
}

/** The same mark family plus digit cells. One cab slip carries the answer; the others carry decoys. */
export function renderMarkedCode(code: string, mark: number, rnd: () => number, box: { w: number; h: number }): string {
  const s = Math.min(box.h - 8, 20);
  return wrap(box, markShape(mark, 2, 4, s) + digitRects(code, rnd, box, 2 + s + 3) + noise(rnd, box));
}

export const svgLeaksText = (svg: string): boolean => /<text[\s>/]|<!--/.test(svg);
