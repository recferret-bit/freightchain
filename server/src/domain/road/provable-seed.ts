import bs58 from 'bs58';

/**
 * Preimage packing: poolId (4B LE) || blockhash (32B raw) || slot (8B LE) = 44 bytes.
 * Fully pure domain: uses standard Uint8Array, DataView, and bs58.
 */
export function packSeedPreimage(poolId: number, blockhash: string, slot: number | bigint): Uint8Array {
  const buf = new Uint8Array(44);
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  view.setUint32(0, poolId >>> 0, true);
  const bhBytes = bs58.decode(blockhash);
  if (bhBytes.length !== 32) {
    throw new RangeError(`invalid blockhash length: expected 32 bytes, got ${bhBytes.length}`);
  }
  buf.set(bhBytes, 4);
  view.setBigUint64(36, BigInt(slot), true);
  return buf;
}

/**
 * Projects a 32-byte SHA-256 digest into a 31-bit integer [0, 0x7fff_ffff] matching RoadLayout.
 */
export function projectRoadSeed(commitment: Uint8Array): number {
  if (commitment.length < 4) {
    throw new RangeError('commitment must have at least 4 bytes');
  }
  const view = new DataView(commitment.buffer, commitment.byteOffset, commitment.byteLength);
  return (view.getUint32(0, true) & 0x7fff_ffff) >>> 0;
}
