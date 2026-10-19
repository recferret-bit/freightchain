import bs58 from 'bs58';
import { packSeedPreimage, projectRoadSeed } from '../../../../src/domain/road/provable-seed.js';

describe('provable-seed', () => {
  describe('packSeedPreimage', () => {
    it('packs 44 bytes containing LE u32 poolId, 32B blockhash, and LE u64 slot', () => {
      const rawHash = new Uint8Array(32);
      rawHash.fill(0xab);
      const blockhash = bs58.encode(rawHash);
      const poolId = 42;
      const slot = 123456789n;

      const preimage = packSeedPreimage(poolId, blockhash, slot);
      expect(preimage).toHaveLength(44);

      const view = new DataView(preimage.buffer, preimage.byteOffset, preimage.byteLength);
      expect(view.getUint32(0, true)).toBe(42);
      expect(preimage.subarray(4, 36)).toEqual(rawHash);
      expect(view.getBigUint64(36, true)).toBe(123456789n);
    });

    it('rejects blockhash that does not decode to 32 bytes', () => {
      const shortBh = bs58.encode(new Uint8Array(31));
      expect(() => packSeedPreimage(1, shortBh, 100)).toThrow(RangeError);
      expect(() => packSeedPreimage(1, shortBh, 100)).toThrow('invalid blockhash length: expected 32 bytes, got 31');
    });
  });

  describe('projectRoadSeed', () => {
    it('projects first 4 LE bytes masked with 0x7fff_ffff into [0, 2147483647]', () => {
      // 0xffffffff masked with 0x7fffffff is 0x7fffffff (2147483647)
      const allOnes = new Uint8Array(32).fill(0xff);
      const seed = projectRoadSeed(allOnes);
      expect(seed).toBe(0x7fff_ffff);
      expect(seed).toBeGreaterThanOrEqual(0);
      expect(seed).toBeLessThanOrEqual(0x7fff_ffff);
    });

    it('preserves low 31 bits in little endian', () => {
      const buf = new Uint8Array(32);
      buf[0] = 0x12;
      buf[1] = 0x34;
      buf[2] = 0x56;
      buf[3] = 0x78; // 0x78563412 < 0x7fffffff
      expect(projectRoadSeed(buf)).toBe(0x78563412);
    });

    it('clears bit 31 when set', () => {
      const buf = new Uint8Array(32);
      buf[0] = 0x00;
      buf[1] = 0x00;
      buf[2] = 0x00;
      buf[3] = 0x80; // 0x80000000 -> bit 31 set
      expect(projectRoadSeed(buf)).toBe(0);
    });

    it('throws if input has fewer than 4 bytes', () => {
      expect(() => projectRoadSeed(new Uint8Array(3))).toThrow(RangeError);
    });

    it('works with Buffer slice with non-zero offset', () => {
      const full = Buffer.alloc(10);
      full.writeUInt32LE(0x12345678, 4);
      const slice = full.subarray(4);
      expect(projectRoadSeed(slice)).toBe(0x12345678);
    });
  });
});
