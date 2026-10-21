import type { MgMac } from '../../../domain/minigames/mac.js';

/** HMAC-SHA256 and SHA-256 for minigame salts. Node lives in the infrastructure adapter. */
export abstract class MinigameCryptoPort implements MgMac {
  abstract hmacSha256(key: Uint8Array | string, message: Uint8Array | string): Uint8Array;
  abstract sha256(data: Uint8Array | string): Uint8Array;
}
