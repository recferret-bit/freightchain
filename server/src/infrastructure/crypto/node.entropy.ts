import { randomBytes, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import bs58 from 'bs58';
import { EntropyPort } from '../../application/ports/shared/entropy.port.js';

const SEED_MASK = 0x7fffffff;

@Injectable()
export class NodeEntropy extends EntropyPort {
  uuid(): string {
    return randomUUID();
  }

  hex(bytes: number): string {
    return randomBytes(bytes).toString('hex');
  }

  seed31(): number {
    return randomBytes(4).readUInt32BE() & SEED_MASK;
  }

  referenceKey(): string {
    return bs58.encode(randomBytes(32));
  }
}
