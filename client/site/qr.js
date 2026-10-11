import { qrcode } from './qrcode-gen.mjs';

/** Byte-mode QR, error correction M. The matrix includes the 4-module quiet zone. */
export function qrModules(text) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const quiet = 4;
  const size = n + quiet * 2;
  const rows = [];
  for (let r = 0; r < size; r++) {
    const row = [];
    for (let c = 0; c < size; c++) {
      const rr = r - quiet, cc = c - quiet;
      row.push(rr >= 0 && cc >= 0 && rr < n && cc < n && qr.isDark(rr, cc));
    }
    rows.push(row);
  }
  return rows;
}

/** White background, black modules, quiet zone included by the encoder's margin. */
export function qrSvg(text) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 16, scalable: true });
}

/** The SVG as a node. Callers insert it with replaceChildren, never innerHTML. */
export function qrNode(text) {
  const svg = new DOMParser().parseFromString(qrSvg(text), 'image/svg+xml').documentElement;
  return document.importNode(svg, true);
}
