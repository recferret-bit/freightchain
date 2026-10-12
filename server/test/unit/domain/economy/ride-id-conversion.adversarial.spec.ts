import { describe, expect, it } from 'vitest';
import { rideIdFromBytes, rideIdToBytes } from '../../../../src/domain/economy/pledge.types.js';
import { PublicKey } from '@solana/web3.js';
import { PoolProgramCodec } from '../../../../src/infrastructure/solana/pool-program.codec.js';

describe('Adversarial Stress Test: Ride ID Conversion & PDA Derivation', () => {
  const programId = 'FC11111111111111111111111111111111111111111';
  const codec = new PoolProgramCodec(programId);
  const dummySponsor = new PublicKey('11111111111111111111111111111111');

  describe('Standard RFC 4122 UUID v4 conversions', () => {
    it('correctly converts canonical v4 UUIDs to 32 bytes and back', () => {
      const uuids = [
        '12345678-1234-4234-8234-123456789abc',
        '00000000-0000-4000-8000-000000000001',
        'ffffffff-ffff-4fff-bfff-ffffffffffff',
        'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
      ];

      for (const uuid of uuids) {
        const bytes32 = rideIdToBytes(uuid);
        expect(bytes32).toBeInstanceOf(Uint8Array);
        expect(bytes32.length).toBe(32);

        // Bytes 16..31 must be strictly zero-padded
        for (let i = 16; i < 32; i++) {
          expect(bytes32[i]).toBe(0);
        }

        const restored = rideIdFromBytes(bytes32);
        expect(restored).toBe(uuid.toLowerCase());
      }
    });

    it('handles uppercase UUIDs by normalizing to lowercase on restore', () => {
      const upper = '12345678-ABCD-4EF0-8123-123456789ABC';
      const bytes32 = rideIdToBytes(upper);
      const restored = rideIdFromBytes(bytes32);
      expect(restored).toBe(upper.toLowerCase());
      // Not strictly identical string due to case folding
      expect(restored).not.toBe(upper);
    });

    it('handles boundary UUIDs: nil UUID and max UUID', () => {
      const nilUuid = '00000000-0000-0000-0000-000000000000';
      const nilBytes = rideIdToBytes(nilUuid);
      expect(nilBytes.every((b) => b === 0)).toBe(true);
      expect(rideIdFromBytes(nilBytes)).toBe(nilUuid);

      const maxUuid = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
      const maxBytes = rideIdToBytes(maxUuid);
      for (let i = 0; i < 16; i++) expect(maxBytes[i]).toBe(255);
      for (let i = 16; i < 32; i++) expect(maxBytes[i]).toBe(0);
      expect(rideIdFromBytes(maxBytes)).toBe(maxUuid);
    });

    it('handles UUID v1, v3, v5, and v7 formats', () => {
      const variousUuids = [
        '6ba7b810-9dad-11d1-80b4-00c04fd430c8', // v1
        '6fa459ea-ee8a-3ca4-894e-db77e160355e', // v3
        '886313e1-3b8a-5372-9b90-0c9aee199e5d', // v5
        '018d3b84-6019-7987-a24d-616a67f01c23', // v7
      ];
      for (const u of variousUuids) {
        expect(rideIdFromBytes(rideIdToBytes(u))).toBe(u);
      }
    });
  });

  describe('Adversarial input validation for rideIdToBytes', () => {
    it('rejects malformed and non-UUID inputs', () => {
      const invalidInputs = [
        '',
        'not-a-uuid',
        '12345678-1234-1234-1234-123456789ab', // 35 chars
        '12345678-1234-1234-1234-123456789abc0', // 37 chars
        '12345678123412341234123456789abc', // missing hyphens
        '12345678-1234-123-41234-123456789abc', // bad hyphen placement
        '12345678-1234-1234-1234-123456789abg', // non-hex 'g'
        '{12345678-1234-1234-1234-123456789abc}', // braced
        'urn:uuid:12345678-1234-1234-1234-123456789abc', // URN prefix
        ' 12345678-1234-1234-1234-123456789abc', // leading space
        '12345678-1234-1234-1234-123456789abc ', // trailing space
        '12345678-1234-1234-1234-123456789ab\0', // null byte
      ];

      for (const bad of invalidInputs) {
        expect(() => rideIdToBytes(bad)).toThrow(RangeError);
      }
    });
  });

  describe('Adversarial input validation for rideIdFromBytes', () => {
    it('strictly enforces 32-byte input length', () => {
      const badLengths = [0, 1, 15, 16, 31, 33, 48, 64];
      for (const len of badLengths) {
        const buf = new Uint8Array(len);
        expect(() => rideIdFromBytes(buf)).toThrow(RangeError);
      }
    });

    it('rejects non-zero trailing bytes in padding region (bytes 16..31) with RangeError', () => {
      const canonicalUuid = '12345678-1234-4234-8234-123456789abc';
      const corruptedBytes = rideIdToBytes(canonicalUuid);
      // Inject non-zero bytes into the padding region (bytes 16..31)
      corruptedBytes[16] = 0xde;
      corruptedBytes[17] = 0xad;
      corruptedBytes[31] = 0xbe;

      expect(() => rideIdFromBytes(corruptedBytes)).toThrow(RangeError);
      expect(() => rideIdFromBytes(corruptedBytes)).toThrow('bytes 16..31 of ride id must be zero-padded');

      // Test each single byte 16..31 individually
      for (let i = 16; i < 32; i++) {
        const testBytes = rideIdToBytes(canonicalUuid);
        testBytes[i] = 1;
        expect(() => rideIdFromBytes(testBytes)).toThrow(RangeError);
      }
    });
  });

  describe('Solana Pledge PDA derivation compatibility', () => {
    it('produces identical PDA addresses when given Uint8Array and Buffer', () => {
      const uuid = '12345678-1234-4234-8234-123456789abc';
      const uint8 = rideIdToBytes(uuid);
      const buffer = Buffer.from(uint8);

      const pda1 = codec.pledgePda(uint8, dummySponsor);
      const pda2 = codec.pledgePda(buffer, dummySponsor);
      expect(pda1.toBase58()).toBe(pda2.toBase58());
    });

    it('demonstrates that non-zero padding corrupts PDA address derivation', () => {
      const uuid = '12345678-1234-4234-8234-123456789abc';
      const cleanBytes = rideIdToBytes(uuid);
      const dirtyBytes = new Uint8Array(cleanBytes);
      dirtyBytes[20] = 0x01; // dirty byte in padding

      const cleanPda = codec.pledgePda(cleanBytes, dummySponsor);
      const dirtyPda = codec.pledgePda(dirtyBytes, dummySponsor);

      // The on-chain PDA differs if padding is not clean zeros!
      expect(cleanPda.toBase58()).not.toBe(dirtyPda.toBase58());
    });
  });
});
