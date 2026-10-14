import { Injectable } from '@nestjs/common';
import { ConflictError } from '../../domain/shared/errors.js';
import { computeTelemetryMerkleRoot } from '../../domain/telemetry/telemetry-merkle.js';
import { ATTESTATION_FLAGGED, ATTESTATION_VERIFIED, PoolPayoutChainPort } from '../ports/economy/pool-payout-chain.port.js';
import { RideRepositoryPort } from '../ports/rides/ride.repository.port.js';
import { RideBatchRepositoryPort } from '../ports/telemetry/ride-batch.repository.port.js';
import { HasherPort } from '../ports/shared/hasher.port.js';

export interface AttestationResult {
  /** what the chain holds for (pool, driver) now: 'verified' / 'flagged', or 'none' (nothing to attest – the driver finished no ride) */
  status: 'verified' | 'flagged' | 'none';
  /** the record_attestation this call sent; null = it was there already, or nothing was sent */
  signature: string | null;
}

/**
 * The payout key's Attestation per (pool, driver) – the server's verdict written on chain, with the RFC 6962 Merkle root of the ride's recording batches (anyone
 * holding the recording can recompute it): `pay_prize` refuses a wallet without a VERIFIED one, `settle_pledge` pays a pledge by its `verified_km`. It is the
 * server's word, not a proof – the program only checks that the payout key signed it. Recorded while the pool is ACTIVE (the program refuses it after close).
 * Concurrent calls for the same (pool, driver) share one transaction.
 */
@Injectable()
export class AttestationService {
  private readonly inFlight = new Map<string, Promise<AttestationResult>>();

  constructor(
    private readonly payout: PoolPayoutChainPort,
    private readonly rides: RideRepositoryPort,
    private readonly batches: RideBatchRepositoryPort,
    private readonly hasher: HasherPort,
  ) {}

  /** A prize winner: VERIFIED with the km of the driver's best verified ride, or a ConflictError (no verified ride, purged recording, under 1 km). */
  async ensureAttestation(poolId: number, driver: string): Promise<AttestationResult> {
    return this.once(`${poolId}:${driver}`, async () => {
      const r = await this.attest(poolId, driver);
      if (r.status !== 'verified') throw new ConflictError(`driver ${driver} has no verified ride of at least 1 km in pool ${poolId}`, 'driver_not_verified');
      return r;
    });
  }

  /** A pledged driver, once every ride of the pool is decided: VERIFIED as above, FLAGGED when every finished ride was rejected (the sponsor gets it all back),
      nothing when the driver finished no ride or under 1 km (the pledge is refunded once the pool is over). Never throws for a driver without a verified ride. */
  async attestForPledges(poolId: number, driver: string): Promise<AttestationResult> {
    return this.once(`${poolId}:${driver}`, () => this.attest(poolId, driver));
  }

  private async once(key: string, run: () => Promise<AttestationResult>): Promise<AttestationResult> {
    const pending = this.inFlight.get(key);
    if (pending) return pending;
    const promise = run();
    this.inFlight.set(key, promise);
    try { return await promise; } finally { this.inFlight.delete(key); }
  }

  /** What a VERIFIED attestation of (pool, driver) says – the best verified ride's whole km and its recording's Merkle root; null = no verified ride, or one under
      1 km (a paid shift is far longer: a short ride is never rounded up into a prize or a pledge payment). Read only: the admin's manual payout signs it itself. */
  async verifiedFacts(poolId: number, driver: string): Promise<{ telemetryRoot: Uint8Array; verifiedKm: number } | null> {
    const ride = await this.rides.findBestVerifiedByPoolAndWallet(poolId, driver);
    if (!ride) return null;
    const verifiedKm = Math.floor((ride.distance || ride.completeDist) / 1000);
    if (verifiedKm < 1) return null;
    const facts = await this.batches.listFactsByRide(ride.id);
    const telemetryRoot = computeTelemetryMerkleRoot(facts, (d) => this.hasher.sha256(d));
    if (facts.length === 0 || telemetryRoot.every((b) => b === 0)) throw new ConflictError(`the recording of ride ${ride.id} has no batches (purged?)`, 'recording_purged');
    return { telemetryRoot, verifiedKm };
  }

  /** The verdicts are read AGAIN every time (pentest M7: an attestation already on chain used to be trusted, so a verdict revoked after it was still paid):
      what the chain holds is rewritten when it no longer says what the rides say now – VERIFIED with other km, VERIFIED for a driver whose verified ride is
      gone (→ FLAGGED: no prize, the sponsors get their pledges back), FLAGGED for one an admin has since accepted. The program allows the rewrite while the
      pool is active. A pledge already settled on an earlier attestation stays settled – an attestation is final once it was paid on. */
  private async attest(poolId: number, driver: string): Promise<AttestationResult> {
    const onChain = await this.payout.attestationOf(poolId, driver);
    const verified = await this.verifiedFacts(poolId, driver);
    if (verified) {
      if (onChain?.status === ATTESTATION_VERIFIED && onChain.verifiedKm === verified.verifiedKm) return { status: 'verified', signature: null };
      const { signature } = await this.payout.recordAttestation({ poolId, driver, ...verified, status: ATTESTATION_VERIFIED });
      return { status: 'verified', signature };
    }
    const shortVerified = (await this.rides.findBestVerifiedByPoolAndWallet(poolId, driver)) !== null;   // verified but under 1 km
    if (!shortVerified && !(await this.rides.hasCompletedInPool(poolId, driver)) && onChain?.status !== ATTESTATION_VERIFIED) return { status: 'none', signature: null };
    if (onChain?.status === ATTESTATION_FLAGGED) return { status: 'flagged', signature: null };
    if (shortVerified && onChain?.status !== ATTESTATION_VERIFIED) return { status: 'none', signature: null };
    const { signature } = await this.payout.recordAttestation({ poolId, driver, telemetryRoot: new Uint8Array(32), verifiedKm: 0, status: ATTESTATION_FLAGGED });
    return { status: 'flagged', signature };
  }
}
