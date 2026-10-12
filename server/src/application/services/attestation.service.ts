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

  private async attest(poolId: number, driver: string): Promise<AttestationResult> {
    const onChain = await this.payout.attestationOf(poolId, driver);
    if (onChain?.status === ATTESTATION_VERIFIED && onChain.verifiedKm > 0) return { status: 'verified', signature: null };
    if (onChain?.status === ATTESTATION_FLAGGED) return { status: 'flagged', signature: null };

    const ride = await this.rides.findBestVerifiedByPoolAndWallet(poolId, driver);
    if (ride) {
      const verifiedKm = Math.floor((ride.distance || ride.completeDist) / 1000);
      if (verifiedKm < 1) return { status: 'none', signature: null }; // a paid shift is far longer; never round a short ride up into a prize or a pledge payment
      const facts = await this.batches.listFactsByRide(ride.id);
      const telemetryRoot = computeTelemetryMerkleRoot(facts, (d) => this.hasher.sha256(d));
      if (facts.length === 0 || telemetryRoot.every((b) => b === 0)) throw new ConflictError(`the recording of ride ${ride.id} has no batches (purged?)`, 'recording_purged');
      const { signature } = await this.payout.recordAttestation({ poolId, driver, telemetryRoot, verifiedKm, status: ATTESTATION_VERIFIED });
      return { status: 'verified', signature };
    }
    if (!(await this.rides.hasCompletedInPool(poolId, driver))) return { status: 'none', signature: null };
    const { signature } = await this.payout.recordAttestation({ poolId, driver, telemetryRoot: new Uint8Array(32), verifiedKm: 0, status: ATTESTATION_FLAGGED });
    return { status: 'flagged', signature };
  }
}
