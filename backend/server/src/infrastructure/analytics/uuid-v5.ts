import { createHash } from 'node:crypto';

/** RFC 4122 URL namespace. Not the DNS namespace. */
export const URL_NAMESPACE = '6ba7b811-9dad-11d1-80b4-00c04fd430c8';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** SHA-1 UUID v5 (RFC 4122). Same name always yields the same uuid. */
export function uuidV5(name: string, namespace = URL_NAMESPACE): string {
  const hash = createHash('sha1').update(Buffer.from(namespace.replace(/-/g, ''), 'hex')).update(name).digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export const analyticsUuid = (dedupeKey: string): string => uuidV5(`https://freightchain.fun/analytics/${dedupeKey}`);

export const isUuid = (value: string): boolean => UUID_RE.test(value);
