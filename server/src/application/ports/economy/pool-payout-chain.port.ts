/** A transaction the payout key signed, before it goes out: the caller stores it so a crash after the broadcast is resolved from the signature, never by paying twice. */
export interface SignedPayout {
  signature: string;
  lastValidBlockHeight: number;
}

/** Attestation.status (programs/freightchain-pools constants.rs) */
export const ATTESTATION_UNVERIFIED = 0;
export const ATTESTATION_VERIFIED = 1;
export const ATTESTATION_FLAGGED = 2;

/** A pledge's keys on chain: the PDA is [b"pledge", rideId as 32 bytes, sponsor]. */
export interface PledgeKeys {
  poolId: number;
  /** the ride's uuid (zero-padded to 32 bytes on chain) */
  rideId: string;
  sponsor: string;
  driver: string;
}

/**
 * The payout job's door to the chain (PAYOUT_SECRET – the key the admin named as the program's `payout_authority`). The program allows it `pay_prize` (capped at
 * the pool's prize share, only after the pool's review window, only to a wallet with a VERIFIED attestation), `close_pool` (money only to the treasuries the
 * pool declared) and `record_attestation`; it also sends the permissionless `settle_pledge` / `refund_pledge` (money only to the pledge's driver / sponsor).
 * It pays only its own fees (and each Attestation's rent). Without PAYOUT_SECRET `address` is null and the payout job does nothing (the admin pays from the admin page).
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
  /** the driver's Attestation for the pool, null = none */
  abstract attestationOf(poolId: number, driver: string): Promise<{ status: number; verifiedKm: number } | null>;
  /** submit on-chain Attestation account signed by the payout authority */
  abstract recordAttestation(input: {
    poolId: number;
    driver: string;
    telemetryRoot: Uint8Array | Buffer;
    verifiedKm: number;
    status: number;
  }): Promise<{ signature: string }>;
  /** `settle_pledge`: the driver gets max × min(verified_km, target) / target, the sponsor the rest + the account's rent; needs the driver's attestation */
  abstract settlePledge(keys: PledgeKeys): Promise<{ signature: string }>;
  /** `refund_pledge`: everything back to the sponsor – the pool is over and the driver has no decided attestation */
  abstract refundPledge(keys: PledgeKeys): Promise<{ signature: string }>;
}
