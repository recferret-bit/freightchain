/** A transaction the payout key signed, before it goes out: the caller stores it so a crash after the broadcast is resolved from the signature, never by paying twice. */
export interface SignedPayout {
  signature: string;
  lastValidBlockHeight: number;
}

/** Attestation.status (programs/freightchain_pools/src/constants.rs) */
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

/** A pledged ride's attestation on chain (program v4 RideAttestation – audit H4: a pledge settles on ITS ride, not on the driver's best one). */
export interface RideAttestationState {
  driver: string;
  status: number;
  verifiedKm: number;
  /** pledges on it settle only from here (the review lock) */
  settleFrom: Date;
  /** > 0 = a pledge was settled on it: the program refuses a rewrite */
  settledPledges: number;
}

/**
 * The payout job's door to the chain (PAYOUT_SECRET – the key the admin named as the program's `payout_authority`). Program v4 (audit H5-B): the key COMMITS a
 * pool's winners root (public for the review lock, vetoable by the cold admin), records the attestation of each pledged ride, and closes a pool once every committed
 * rank is paid; `pay_prize` / `settle_pledge` / `refund_pledge` are permissionless and it only sends them (pays their fees). Money goes only where the committed root,
 * the pledge or the pool's declared treasuries say. Without PAYOUT_SECRET `address` is null and the payout job does nothing (the admin acts from the admin page).
 * `onSigned` is awaited BEFORE the transaction is broadcast; if it throws, nothing is sent.
 */
export abstract class PoolPayoutChainPort {
  /** the payout key's public address; null = no PAYOUT_SECRET (or no program configured) */
  abstract get address(): string | null;
  /** the chain's Clock.unix_timestamp – the program's "now" */
  abstract chainNow(): Promise<Date>;
  /** the address the program's Config names as payout_authority (null = none) – the job refuses to run when it is not this key */
  abstract configuredPayoutAuthority(): Promise<string | null>;
  /** `commit_winners`: the root of (rank, wallet, lamports) for the pool (count 0 + a zero root = no winner); ConflictError when the program refuses it */
  abstract commitWinners(input: { poolId: number; root: Uint8Array; total: number; count: number }): Promise<{ signature: string }>;
  /** `pay_prize` of one committed rank (1-based; the leaf index is rank − 1) with its proof, sent and paid by the payout key; ConflictError (transaction_would_fail /
      _failed / _dropped / _unconfirmed) otherwise */
  abstract payPrize(input: { poolId: number; rank: number; to: string; lamports: number; proof: Uint8Array[] }, onSigned: (tx: SignedPayout) => Promise<void>): Promise<{ signature: string }>;
  /** build + sign `close_pool` (treasuries from the Pool and Config accounts), send and wait */
  abstract closePool(poolId: number): Promise<{ signature: string }>;
  /** the ride's attestation for the pool, null = none */
  abstract rideAttestationOf(poolId: number, rideId: string): Promise<RideAttestationState | null>;
  /** `record_ride_attestation` signed (and its rent paid) by the payout key */
  abstract recordRideAttestation(input: {
    poolId: number;
    rideId: string;
    driver: string;
    telemetryRoot: Uint8Array | Buffer;
    verifiedKm: number;
    status: number;
  }): Promise<{ signature: string }>;
  /** `settle_pledge`: the driver gets max × min(verified_km, target) / target, the sponsor the rest + the account's rent; needs the RIDE's attestation past its lock */
  abstract settlePledge(keys: PledgeKeys): Promise<{ signature: string }>;
  /** `refund_pledge`: everything back to the sponsor – the pool is over and the ride has no decided attestation */
  abstract refundPledge(keys: PledgeKeys): Promise<{ signature: string }>;
}
