import { createHash, createHmac } from 'node:crypto';
import { NodeMinigameCrypto } from '../../../../src/infrastructure/crypto/node.minigame-crypto.js';

describe('NodeMinigameCrypto', () => {
  const crypto = new NodeMinigameCrypto();

  it('HMAC-SHA256 and SHA-256 match node:crypto, including a raw key', () => {
    const key = new Uint8Array([1, 2, 3, 4]);
    expect(Buffer.from(crypto.hmacSha256('secret', 'mg:v1ridewallet'))).toEqual(createHmac('sha256', 'secret').update('mg:v1ridewallet').digest());
    expect(Buffer.from(crypto.hmacSha256(key, 'sched'))).toEqual(createHmac('sha256', key).update('sched').digest());
    const raw = crypto.hmacSha256('secret', 'mg:v1ridewallet');
    expect(Buffer.from(crypto.sha256(raw))).toEqual(createHash('sha256').update(raw).digest());
    expect(Buffer.from(crypto.sha256('abc')).toString('hex')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
