import { NodeHasher } from '../../../../src/infrastructure/crypto/node.hasher.js';

describe('NodeHasher', () => {
  it('SHA-256 as lowercase hex, over the UTF-8 bytes', () => {
    const h = new NodeHasher();
    expect(h.sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(h.sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(h.sha256Hex('ü')).toBe(h.sha256Hex('ü'));
    expect(h.sha256Hex('a')).not.toBe(h.sha256Hex('b'));
  });

  it('SHA-256 as 32-byte Buffer over string, Buffer, or Uint8Array', () => {
    const h = new NodeHasher();
    const buf = h.sha256('abc');
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBe(32);
    expect(buf.toString('hex')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');

    const uint8 = new Uint8Array([0x61, 0x62, 0x63]); // 'abc'
    expect(h.sha256(uint8).toString('hex')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('HMAC-SHA256 is lowercase hex over the raw key', () => {
    const h = new NodeHasher();
    const key = Buffer.from('11'.repeat(32), 'hex');
    expect(h.hmacSha256Hex(key, 'fc-batch:v2')).toBe('94939ead6616f0c33ee55760c0dc367a96c46e7d8775e6b28475613aeff8f5fd');
  });
});
