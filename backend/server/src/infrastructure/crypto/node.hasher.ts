import { createHash, createHmac } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { HasherPort } from '../../application/ports/shared/hasher.port.js';

@Injectable()
export class NodeHasher extends HasherPort {
  sha256Hex(text: string): string {
    return createHash('sha256').update(text, 'utf8').digest('hex');
  }

  sha256(data: Uint8Array | Buffer | string): Buffer {
    return createHash('sha256').update(data).digest();
  }

  hmacSha256Hex(key: Uint8Array | Buffer, message: string): string {
    return createHmac('sha256', key).update(message, 'utf8').digest('hex');
  }
}
