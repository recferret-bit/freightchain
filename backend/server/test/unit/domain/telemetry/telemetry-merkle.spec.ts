import { createHash } from 'node:crypto';
import { SERVER_HASHED_LEAF, computeBatchLeaf, computeTelemetryMerkleRoot, type DigestFn } from '../../../../src/domain/telemetry/telemetry-merkle.js';
import { RideBatch } from '../../../../src/domain/telemetry/ride-batch.entity.js';
import { hashBatch, recording } from '../../../support/recording.js';

const sha256: DigestFn = (data) => createHash('sha256').update(data).digest();

describe('telemetry-merkle', () => {
  it('returns 32 zero bytes for empty input', () => {
    const root = computeTelemetryMerkleRoot([], sha256);
    expect(root).toBeInstanceOf(Buffer);
    expect(root.length).toBe(32);
    expect(root.equals(Buffer.alloc(32, 0))).toBe(true);
  });

  it('computes domain-separated leaf with 0x00 prefix', () => {
    const rawData = Buffer.from('batch_0_data');
    const expected = sha256(Buffer.concat([Buffer.from([0x00]), rawData]));
    const leaf = computeBatchLeaf(rawData, sha256);
    expect(leaf.equals(expected)).toBe(true);
  });

  it('returns single leaf directly for 1 batch item', () => {
    const batch = { hash: 'aa'.repeat(32) };
    const leaf = computeBatchLeaf(batch, sha256);
    const root = computeTelemetryMerkleRoot([batch], sha256);
    expect(root.equals(leaf)).toBe(true);
  });

  it('computes 2-leaf tree with 0x01 parent prefix', () => {
    const b0 = { hash: '11'.repeat(32) };
    const b1 = { hash: '22'.repeat(32) };
    const l0 = computeBatchLeaf(b0, sha256);
    const l1 = computeBatchLeaf(b1, sha256);
    const expected = sha256(Buffer.concat([Buffer.from([0x01]), l0, l1]));

    const root = computeTelemetryMerkleRoot([b0, b1], sha256);
    expect(root.equals(expected)).toBe(true);
  });

  it('handles odd leaf count by promoting odd node without duplication', () => {
    const b0 = { hash: '11'.repeat(32) };
    const b1 = { hash: '22'.repeat(32) };
    const b2 = { hash: '33'.repeat(32) };

    const l0 = computeBatchLeaf(b0, sha256);
    const l1 = computeBatchLeaf(b1, sha256);
    const l2 = computeBatchLeaf(b2, sha256);

    // Level 1: parent01 = sha256(0x01 || l0 || l1), parent2 = l2 (promoted)
    const p01 = sha256(Buffer.concat([Buffer.from([0x01]), l0, l1]));
    // Level 2 (Root): sha256(0x01 || p01 || l2)
    const expectedRoot = sha256(Buffer.concat([Buffer.from([0x01]), p01, l2]));

    const root = computeTelemetryMerkleRoot([b0, b1, b2], sha256);
    expect(root.equals(expectedRoot)).toBe(true);
  });

  it('accepts hex string, Uint8Array, and object with hash or body', () => {
    const hex = 'ab'.repeat(32);
    const uint8 = new Uint8Array([1, 2, 3, 4]);
    const objHash = { hash: 'cd'.repeat(32) };
    const objBody = { body: { seq: 0, test: true } };

    const root = computeTelemetryMerkleRoot([hex, uint8, objHash, objBody], sha256);
    expect(root).toBeInstanceOf(Buffer);
    expect(root.length).toBe(32);
  });

  it('an UNHASHED batch is bound by the server\'s hash of its content: two of them with different content never share a leaf (audit M13)', () => {
    const [a, b] = recording('ride-m', { seconds: 30 }).map((x) => ({ ...x, hash: null }));
    const ra = RideBatch.accept('ride-m', a!, hashBatch(a!), new Date(0)), rb = RideBatch.accept('ride-m', b!, hashBatch(b!), new Date(0));
    expect(ra.serverHash).toBe(hashBatch(a!));
    const la = computeBatchLeaf({ hash: null, serverHash: ra.serverHash }, sha256), lb = computeBatchLeaf({ hash: null, serverHash: rb.serverHash }, sha256);
    expect(la.equals(lb)).toBe(false);
    expect(la.equals(sha256(Buffer.concat([Buffer.from([SERVER_HASHED_LEAF]), Buffer.from(ra.serverHash!, 'hex')])))).toBe(true);
    expect(computeTelemetryMerkleRoot([{ hash: null, serverHash: ra.serverHash }, { hash: null, serverHash: rb.serverHash }], sha256)
      .equals(computeTelemetryMerkleRoot([{ hash: null }, { hash: null }], sha256))).toBe(false);
  });

  it('a hashed batch keeps its leaf (roots already attested stay valid); a row from before the server hash was kept keeps the old empty leaf', () => {
    const h = 'ab'.repeat(32);
    expect(computeBatchLeaf({ hash: h, serverHash: 'cd'.repeat(32) }, sha256).equals(computeBatchLeaf({ hash: h }, sha256))).toBe(true);
    expect(computeBatchLeaf({ hash: null, serverHash: null }, sha256).equals(sha256(Buffer.from([0x00])))).toBe(true);
  });
});
