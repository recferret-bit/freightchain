/** A transaction the payout key signed, before it goes out: the caller stores it so a crash after the broadcast is resolved from the signature, never by paying twice. */
export interface SignedPayout {
  signature: string;
  lastValidBlockHeight: number;
}

/**
 * The payout job's door to the chain (PAYOUT_SECRET – the key the admin named as the program's `payout_authority`). It can do two things, and the program
 * allows it nothing else: `pay_prize` (capped at the pool's prize share, only after the pool's review window) and `close_pool` (money only to the treasuries
 * the pool declared). It pays only its own fees. Without PAYOUT_SECRET `address` is null and the payout job does nothing (the admin pays from the admin page).
 * `onSigned` is awaited BEFORE the transaction is broadcast; if it throws, nothing is sent.
 */
export abstract class PoolPayoutChainPort {
  /** the payout key's public address; null = no PAYOUT_SECRET (or no program configured) */
  abstract get address(): string | null;
  /** the chain's Clock.unix_timestamp – the program's "now" for `payout_at` */
  abstract chainNow(): Promise<Date>;
  /** the address the program's Config names as payout_authority (null = none) – the job refuses to run when it is not this key */
  abstract configuredPayoutAuthority(): Promise<string | null>;
  /** build + sign `pay_prize`, await `onSigned`, then send and wait for confirmation; ConflictError (transaction_would_fail / _failed / _dropped / _unconfirmed) otherwise */
  abstract payPrize(input: { poolId: number; to: string; lamports: number; rank: number }, onSigned: (tx: SignedPayout) => Promise<void>): Promise<{ signature: string }>;
  /** build + sign `close_pool` (treasuries from the Pool and Config accounts), send and wait */
  abstract closePool(poolId: number): Promise<{ signature: string }>;
  /** check if driver already has an on-chain Verified Attestation account */
  abstract isAttested(poolId: number, driver: string): Promise<boolean>;
  /** submit on-chain Attestation account signed by the payout authority */
  abstract recordAttestation(input: {
    poolId: number;
    driver: string;
    telemetryRoot: Uint8Array | Buffer;
    verifiedKm: number;
    status: number;
  }): Promise<{ signature: string }>;
}
