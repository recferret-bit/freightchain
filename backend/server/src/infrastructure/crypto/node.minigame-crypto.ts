import { createHash, createHmac } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { MinigameCryptoPort } from '../../application/ports/minigames/minigame-crypto.port.js';

@Injectable()
export class NodeMinigameCrypto extends MinigameCryptoPort {
  hmacSha256(key: Uint8Array | string, message: Uint8Array | string): Uint8Array {
    return createHmac('sha256', key).update(message).digest();
  }

  sha256(data: Uint8Array | string): Uint8Array {
    return createHash('sha256').update(data).digest();
  }
}
