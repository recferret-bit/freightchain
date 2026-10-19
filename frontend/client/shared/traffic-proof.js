// Little-endian Float64 preserves the exact frame inputs; base64 keeps the JSON body bounded.
export const TRAFFIC_PROOF_WIDTH = 12;
export const TRAFFIC_PROOF_MAX_CHARS = 85_000;
export function encodeTrafficProof(rows) {
  const bytes = new Uint8Array(rows.length * TRAFFIC_PROOF_WIDTH * 8), view = new globalThis.DataView(bytes.buffer);
  let offset = 0, binary = '';
  for (const row of rows) for (const value of row) { view.setFloat64(offset, value, true); offset += 8; }
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
export function decodeTrafficProof(text) {
  if (typeof text !== 'string' || text.length > TRAFFIC_PROOF_MAX_CHARS || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text)) return null;
  const binary = atob(text);
  if (binary.length % (TRAFFIC_PROOF_WIDTH * 8)) return null;
  const bytes = Uint8Array.from(binary, c => c.charCodeAt(0)), view = new globalThis.DataView(bytes.buffer), rows = [];
  for (let offset = 0; offset < bytes.length;) {
    const row = [];
    for (let col = 0; col < TRAFFIC_PROOF_WIDTH; col++, offset += 8) row.push(view.getFloat64(offset, true));
    rows.push(row);
  }
  return rows;
}
