import { createHmac } from 'node:crypto';
import { batchMacGenesisMessage, batchMacMessage, TELEMETRY_KEY_ID } from '../../../../src/domain/shared/index.js';
import { RideBatch } from '../../../../src/domain/telemetry/ride-batch.entity.js';
import { TestHasher } from '../../../support/recording.js';

describe('batch mac', () => {
  it('uses one message for the client and the server, and the test hasher matches node', () => {
    expect(TELEMETRY_KEY_ID).toBe('v2');
    expect(batchMacGenesisMessage('ride-1')).toBe('ride-1');
    const canonical = RideBatch.canonical({ seq: 0, prevHash: 'ride-1', t0: 0, t1: 1, samples: [], inputs: [] });
    const message = batchMacMessage('ride-1', 0, 'ab', canonical);
    expect(message).toBe(`fc-batch:v2\nride-1\n0\nab\n${canonical}`);
    const key = Buffer.from('11'.repeat(32), 'hex');
    expect(new TestHasher().hmacSha256Hex(key, message)).toBe(createHmac('sha256', key).update(message, 'utf8').digest('hex'));
  });

  it('keeps protocol and mac out of the v1 canonical text', () => {
    const body = { seq: 0, prevHash: 'r', t0: 0, t1: 1, samples: [[0, 1]], inputs: [] };
    expect(RideBatch.canonical(body)).toBe(RideBatch.canonical({ ...body, protocol: 2, mac: 'a'.repeat(64) }));
  });
});
