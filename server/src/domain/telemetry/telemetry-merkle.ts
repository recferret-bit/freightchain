/**
 * RFC 6962 / Certificate Transparency compliant Merkle Tree computation.
 * Pure domain implementation: accepts a DigestFn to remain 100% free of external crypto libraries.
 */

export type DigestFn = (data: Uint8Array | Buffer) => Buffer;

export interface TelemetryLeafInput {
  hash?: string | null;
  /** the server's own hash of the batch – the leaf of a batch the client could not hash */
  serverHash?: string | null;
  body?: unknown;
}

/** the leaf tag of a batch the client could not hash, bound by the SERVER's hash of its content (pentest 2026-10, fix-plan M13: every such leaf used to be
    SHA-256(0x00), whatever the batch held). Its own tag keeps every root of a recording without such batches what it was – no root version is needed. */
export const SERVER_HASHED_LEAF = 0x02;

/**
 * Domain-separated RFC 6962 leaf digest: SHA-256(0x00 || leaf_data) – SHA-256(0x02 || server hash) for a batch the client did not hash. A row stored
 * before the server hash was kept (no hash, no serverHash) keeps the old empty leaf.
 */
export function computeBatchLeaf(item: TelemetryLeafInput | string | Uint8Array | Buffer, digest: DigestFn): Buffer {
  let raw: Uint8Array | Buffer;
  if (typeof item === 'string') {
    raw = item.length === 64 ? Buffer.from(item, 'hex') : Buffer.from(item, 'utf8');
  } else if (item instanceof Uint8Array || Buffer.isBuffer(item)) {
    raw = item;
  } else if (item.hash) {
    raw = Buffer.from(item.hash, 'hex');
  } else if (item.serverHash) {
    return digest(Buffer.concat([Buffer.from([SERVER_HASHED_LEAF]), Buffer.from(item.serverHash, 'hex')]));
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
