import { deflateRawSync } from 'node:zlib';
import { NodeDeflateAdapter } from '../../../../src/infrastructure/telemetry/node-deflate.adapter.js';

describe('NodeDeflateAdapter', () => {
  it('inflates a deflate-raw payload', () => {
    const plain = Buffer.from('fc-streams');
    const out = new NodeDeflateAdapter().inflateRaw(deflateRawSync(plain));
    expect(out.equals(plain)).toBe(true);
  });
});
