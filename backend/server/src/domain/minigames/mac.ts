/** HMAC / SHA-256 injected from infrastructure. The domain stays free of node:crypto. */
export interface MgMac {
  hmacSha256(key: Uint8Array | string, message: Uint8Array | string): Uint8Array;
  sha256(data: Uint8Array | string): Uint8Array;
}

export const toHex = (bytes: Uint8Array): string => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

/**
 * mgSalt = HMAC-SHA256(secret, saltVersion || rideId || wallet) as raw bytes.
 * The version label (default `mg:v1`) is concatenated with no extra separators.
 * mgCommit = hex SHA-256 of those raw salt bytes — not of the hex encoding of the salt.
 * The salt is never stored; recompute it from the secret.
 */
export function mgSaltBytes(mac: MgMac, secret: string, version: string, rideId: string, wallet: string): Uint8Array {
  return mac.hmacSha256(secret, `${version}${rideId}${wallet}`);
}

export function mgCommitHex(mac: MgMac, salt: Uint8Array): string {
  return toHex(mac.sha256(salt));
}

/** sha256(eventId + ":" + normalized expected), hex. The raw answer is not stored. */
export function answerHashHex(mac: MgMac, eventId: string, normalized: string): string {
  return toHex(mac.sha256(`${eventId}:${normalized}`));
}

/**
 * Session keys (P1) are not issued yet. A mac of 43 base64url characters is structurally valid.
 * Real HMAC verification waits for that key — a well-formed mac is not `mg_bad_mac`.
 */
export const MAC_RE = /^[A-Za-z0-9_-]{43}$/;
export const macStructurallyValid = (mac: string): boolean => MAC_RE.test(mac);
