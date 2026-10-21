import { mulberry32 } from '../shared/index.js';
import type { MgMac } from './mac.js';

/** HMAC-SHA256(salt, label), then mulberry32 from the first 4 bytes (little-endian). */
export function subseedRng(mac: MgMac, salt: Uint8Array, label: string): () => number {
  const digest = mac.hmacSha256(salt, label);
  const a = ((digest[0] ?? 0) | ((digest[1] ?? 0) << 8) | ((digest[2] ?? 0) << 16) | ((digest[3] ?? 0) << 24)) >>> 0;
  return mulberry32(a);
}

/** 16 hex chars from `rnd`. Reroll when the text contains `banned` so an id cannot leak the code. */
export function hex16(rnd: () => number, banned = ''): string {
  for (let i = 0; i < 8; i++) {
    let s = '';
    for (let k = 0; k < 16; k++) s += Math.floor(rnd() * 16).toString(16);
    if (!banned || !s.includes(banned)) return s;
  }
  return 'a'.repeat(16);
}
