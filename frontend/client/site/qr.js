/* global DOMParser */
import { qrcode } from './qrcode-gen.mjs';
import { isMobileDevice } from '../js/mobile.js';

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

/** The pay block under a purchase: the QR plus its caption; on a phone the QR is also a `solana:` link (a tap opens the wallet app that handles Solana Pay –
 *  a desktop usually has no handler for the scheme). `cls` = the caption's class. One node for the lobby and the watch panel. */
export function payQrBlock(url, cls = 'dim') {
  const mobile = isMobileDevice();
  let code = qrNode(url);
  if (mobile) { const a = document.createElement('a'); a.href = url; a.className = 'pay-qr-link'; a.setAttribute('aria-label', 'Pay in a wallet app (Solana Pay)'); a.append(code); code = a; }
  const p = document.createElement('p');
  p.className = cls;
  p.textContent = mobile ? 'or tap the code to pay in your wallet app · same account · devnet' : 'or scan with a phone wallet · same account · devnet';
  return [code, p];
}
