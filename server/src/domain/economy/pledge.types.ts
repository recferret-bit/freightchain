import { orderIdToBytes, orderIdFromBytes } from './ticket-purchase-verification.js';

export interface PledgeProps {
  id: string; // UUID
  pdaAddress: string; // Solana Base58 PDA
  rideId: string; // Ride UUID
  sponsor: string; // Base58 wallet
  driver: string; // Base58 wallet
  poolId: number; // Pool ID
  maxLamports: bigint;
  lamportsPerKm: bigint;
  targetKm: number;
  settled: boolean;
  earnedLamports: bigint;
  refundedLamports: bigint;
  createdAt: Date;
  settledAt: Date | null;
  signature: string | null;
  slot: bigint | null;
  blockhash?: string | null;
}

/** Converts a 16-byte Ride UUID string to 32 bytes by zero-padding bytes 16..32 */
export function rideIdToBytes(uuid: string): Uint8Array {
  const bytes16 = orderIdToBytes(uuid);
  const out = new Uint8Array(32);
  out.set(bytes16, 0);
  return out;
}

/** Converts a 32-byte ride ID buffer (zero-padded 16-byte UUID) back to UUID string */
export function rideIdFromBytes(bytes: Uint8Array): string {
  if (bytes.length !== 32) throw new RangeError(`a ride id byte representation is 32 bytes, got ${bytes.length}`);
  for (let i = 16; i < 32; i++) {
    if (bytes[i] !== 0) throw new RangeError('bytes 16..31 of ride id must be zero-padded');
  }
  return orderIdFromBytes(bytes.slice(0, 16));
}
