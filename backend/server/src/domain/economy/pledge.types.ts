import { orderIdToBytes, orderIdFromBytes } from './ticket-purchase-verification.js';

/** pending = the server built the create_pledge, the chain has not shown it (yet); active = the PledgeCreated is on chain; settled / refunded = the pledge
    account is closed, its money paid out; abandoned = never signed (no account on chain an hour after it was built). */
export const PLEDGE_STATUSES = ['pending', 'active', 'settled', 'refunded', 'abandoned'] as const;
export type PledgeStatus = (typeof PLEDGE_STATUSES)[number];

/** A pledge event of the program, decoded (events.rs PledgeCreated / PledgeSettled / PledgeRefunded); rideId as the uuid, lamports as bigint. */
export type PledgeChainEvent = { signature: string; slot: number; rideId: string; sponsor: string; driver: string; pool: string } & (
  | { kind: 'PledgeCreated'; maxLamports: bigint; lamportsPerKm: bigint; targetKm: number }
  | { kind: 'PledgeSettled'; verifiedKm: number; earnedLamports: bigint; refundedLamports: bigint }
  | { kind: 'PledgeRefunded'; refundedLamports: bigint }
);

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
  status: PledgeStatus;
  /** the create_pledge transaction, once the chain showed it */
  createSignature: string | null;
  /** status is settled or refunded (kept as a column for the indexes) */
  settled: boolean;
  earnedLamports: bigint;
  refundedLamports: bigint;
  createdAt: Date;
  settledAt: Date | null;
  /** the settle_pledge / refund_pledge transaction */
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
