import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { computeBatchLeaf, computeTelemetryMerkleRoot, type DigestFn } from '../../../src/domain/telemetry/telemetry-merkle.js';

const sha256: DigestFn = (data) => createHash('sha256').update(data).digest();

/**
 * Official RFC 6962 / Google Certificate Transparency recursive reference implementation.
 * Section 2.1:
 * For n > 1, let k be the largest power of two smaller than n (k < n <= 2k).
 * MTH(D[n]) = SHA-256(0x01 || MTH(D[0:k]) || MTH(D[k:n]))
 */
function rfc6962ReferenceMth(leaves: Buffer[]): Buffer {
  if (leaves.length === 0) return Buffer.alloc(32, 0); // Freight Chain domain sentinel
  if (leaves.length === 1) {
    return sha256(Buffer.concat([Buffer.from([0x00]), leaves[0]!]));
  }

  // DownToPowerOfTwo(n): largest power of 2 strictly less than n
  let split = 1;
  do {
    split <<= 1;
  } while (split < leaves.length);
  split >>= 1;

  const left = rfc6962ReferenceMth(leaves.slice(0, split));
  const right = rfc6962ReferenceMth(leaves.slice(split));
  return sha256(Buffer.concat([Buffer.from([0x01]), left, right]));
}

describe('Empirical Adversarial Verification: Milestone M3 Iteration 2', () => {
  describe('computeTelemetryMerkleRoot: RFC 6962 Certificate Transparency Compliance', () => {
    it('produces identical roots to the recursive RFC 6962 specification for all tree sizes 1..256', () => {
      for (let size = 1; size <= 256; size++) {
        const rawLeaves: Buffer[] = Array.from({ length: size }, (_, i) =>
          Buffer.from(`telemetry_batch_leaf_${i}_payload_data`),
        );

        const rfcRoot = rfc6962ReferenceMth(rawLeaves);
        const codeRoot = computeTelemetryMerkleRoot(rawLeaves, sha256);

        expect(codeRoot).toBeInstanceOf(Buffer);
        expect(codeRoot.length).toBe(32);
        expect(codeRoot.equals(rfcRoot)).toBe(true);
      }
    });

    it('validates RFC 6962 domain separation (0x00 leaf prefix vs 0x01 internal node prefix)', () => {
      const leaf0Raw = Buffer.from('leaf0');
      const leaf1Raw = Buffer.from('leaf1');

      const leaf0Hash = sha256(Buffer.concat([Buffer.from([0x00]), leaf0Raw]));
      const leaf1Hash = sha256(Buffer.concat([Buffer.from([0x00]), leaf1Raw]));

      // Single leaf is exactly leaf0Hash
      expect(computeTelemetryMerkleRoot([leaf0Raw], sha256).equals(leaf0Hash)).toBe(true);

      // Two leaves combine with 0x01 prefix
      const expectedPair = sha256(Buffer.concat([Buffer.from([0x01]), leaf0Hash, leaf1Hash]));
      expect(computeTelemetryMerkleRoot([leaf0Raw, leaf1Raw], sha256).equals(expectedPair)).toBe(true);

      // Verify that leaf prefix 0x00 prevents second preimage attack with internal nodes
      const fakeNodeData = Buffer.concat([leaf0Hash, leaf1Hash]);
      const fakeLeaf = computeBatchLeaf(fakeNodeData, sha256);
      expect(fakeLeaf.equals(expectedPair)).toBe(false);
    });

    it('correctly handles all TelemetryLeafInput formats (hex, Buffer, uint8, hash, body)', () => {
      const hexHash = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
      const bufData = Buffer.from('buffer_leaf');
      const uint8Data = new Uint8Array([10, 20, 30, 40]);
      const objHash = { hash: 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210' };
      const objBody = { body: { speed: 88, fuel: 95 } };

      const root = computeTelemetryMerkleRoot([hexHash, bufData, uint8Data, objHash, objBody], sha256);
      expect(root).toBeInstanceOf(Buffer);
      expect(root.length).toBe(32);
      expect(root.every((b) => b === 0)).toBe(false);
    });

    it('returns 32-byte zero buffer for empty batch array', () => {
      const root = computeTelemetryMerkleRoot([], sha256);
      expect(root.length).toBe(32);
      expect(root.every((b) => b === 0)).toBe(true);
    });
  });
});
