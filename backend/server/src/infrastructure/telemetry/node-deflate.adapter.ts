import { Injectable } from '@nestjs/common';
import { inflateRawSync } from 'node:zlib';
import { DeflatePort } from '../../application/ports/telemetry/deflate.port.js';

@Injectable()
export class NodeDeflateAdapter extends DeflatePort {
  inflateRaw(data: Buffer): Buffer {
    return inflateRawSync(data);
  }
}
