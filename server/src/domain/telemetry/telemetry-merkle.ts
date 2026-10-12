/**
 * RFC 6962 / Certificate Transparency compliant Merkle Tree computation.
 * Pure domain implementation: accepts a DigestFn to remain 100% free of external crypto libraries.
 */

export type DigestFn = (data: Uint8Array | Buffer) => Buffer;

export interface TelemetryLeafInput {
  hash?: string | null;
  body?: unknown;
}

/**
 * Domain-separated RFC 6962 leaf digest: SHA-256(0x00 || leaf_data)
 */
export function computeBatchLeaf(item: TelemetryLeafInput | string | Uint8Array | Buffer, digest: DigestFn): Buffer {
  let raw: Uint8Array | Buffer;
  if (typeof item === 'string') {
    raw = item.length === 64 ? Buffer.from(item, 'hex') : Buffer.from(item, 'utf8');
  } else if (item instanceof Uint8Array || Buffer.isBuffer(item)) {
    raw = item;
  } else if (item.hash) {
    raw = Buffer.from(item.hash, 'hex');
  } else if (item.body) {
    raw = Buffer.from(JSON.stringify(item.body), 'utf8');
  } else {
    raw = Buffer.alloc(0);
  }

  const prefix = Buffer.from([0x00]);
  return digest(Buffer.concat([prefix, raw]));
}

/**
 * Computes the 32-byte Merkle root over telemetry batch chunks using RFC 6962 rules.
 * Empty input produces 32 zero bytes.
 * Single leaf produces the leaf hash.
 * Odd nodes at any level are promoted to avoid duplication collisions.
 */
export function computeTelemetryMerkleRoot(
  batches: Array<TelemetryLeafInput | string | Uint8Array | Buffer>,
  digest: DigestFn,
): Buffer {
  if (!batches || batches.length === 0) {
    return Buffer.alloc(32, 0);
  }

  let level: Buffer[] = batches.map((b) => computeBatchLeaf(b, digest));

  if (level.length === 1) {
    return level[0]!;
  }

  const prefix = Buffer.from([0x01]);

  while (level.length > 1) {
    const nextLevel: Buffer[] = [];
    for (let i = 0; i < level.length; i += 2) {
      if (i + 1 < level.length) {
        nextLevel.push(digest(Buffer.concat([prefix, level[i]!, level[i + 1]!])));
      } else {
        // Promote odd leaf directly to next level
        nextLevel.push(level[i]!);
      }
    }
    level = nextLevel;
  }

  return level[0]!;
}
