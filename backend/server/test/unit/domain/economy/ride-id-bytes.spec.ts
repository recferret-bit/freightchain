import { describe, expect, it } from 'vitest';
import { rideIdFromBytes, rideIdToBytes } from '../../../../src/domain/economy/pledge.types.js';

describe('rideIdToBytes / rideIdFromBytes (the pledge PDA seed)', () => {
  describe('rideIdFromBytes & rideIdToBytes Edge Cases', () => {
    it('handles non-zero byteOffset views correctly', () => {
      const uuid = '4a5b6c7d-8e9f-4012-b345-6789abcdef01';
      const cleanBytes = rideIdToBytes(uuid);

      // Embed within larger buffer with byteOffset > 0
      const largeBuffer = new Uint8Array(128);
      largeBuffer.set(cleanBytes, 32);

      const subView = largeBuffer.subarray(32, 64);
      expect(subView.length).toBe(32);
      expect(subView.byteOffset).toBe(32);

      const parsedUuid = rideIdFromBytes(subView);
      expect(parsedUuid).toBe(uuid);

      // Corrupt padding within subView
      subView[16] = 0x01;
      expect(() => rideIdFromBytes(subView)).toThrow(RangeError);
      expect(() => rideIdFromBytes(subView)).toThrow('bytes 16..31 of ride id must be zero-padded');
    });

    it('exhaustively rejects any non-zero value at any position in 16..31', () => {
      const uuid = '00000000-0000-4000-8000-000000000000';
      const base = rideIdToBytes(uuid);

      for (let pos = 16; pos < 32; pos++) {
        for (const testVal of [1, 2, 127, 128, 255]) {
          const mutated = new Uint8Array(base);
          mutated[pos] = testVal;
          expect(() => rideIdFromBytes(mutated)).toThrow(RangeError);
        }
      }
    });

    it('works identically with Node.js Buffer', () => {
      const uuid = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
      const bytes = rideIdToBytes(uuid);
      const buf = Buffer.from(bytes);

      expect(rideIdFromBytes(buf)).toBe(uuid);

      buf[31] = 0xff;
      expect(() => rideIdFromBytes(buf)).toThrow(RangeError);
    });
  });
});
