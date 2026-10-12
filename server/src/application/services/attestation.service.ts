import { Injectable } from '@nestjs/common';
import { ConflictError } from '../../domain/shared/errors.js';
import { computeTelemetryMerkleRoot } from '../../domain/telemetry/telemetry-merkle.js';
import { PoolPayoutChainPort } from '../ports/economy/pool-payout-chain.port.js';
import { RideRepositoryPort } from '../ports/rides/ride.repository.port.js';
import { RideBatchRepositoryPort } from '../ports/telemetry/ride-batch.repository.port.js';
import { HasherPort } from '../ports/shared/hasher.port.js';

export interface AttestationResult {
  attested: boolean;
  signature: string | null;
}

@Injectable()
export class AttestationService {
  private readonly pendingAttestations = new Map<string, Promise<AttestationResult>>();

  constructor(
    private readonly payout: PoolPayoutChainPort,
    private readonly rides: RideRepositoryPort,
    private readonly batches: RideBatchRepositoryPort,
    private readonly hasher: HasherPort,
  ) {}

  /**
   * Ensures driver has an on-chain Verified Attestation account for the given pool.
   * If already attested, returns immediately without sending a transaction (idempotent).
   * Concurrent in-flight calls are coalesced to prevent redundant on-chain transactions.
   * Otherwise, loads the best verified ride, computes telemetry Merkle root,
   * calculates verifiedKm = Math.max(1, Math.floor(distance / 1000)), and records attestation on-chain.
   */
  async ensureAttestation(poolId: number, driver: string): Promise<AttestationResult> {
    const key = `${poolId}:${driver}`;
    const inFlight = this.pendingAttestations.get(key);
    if (inFlight) {
      return inFlight;
    }

    const promise = this.executeEnsureAttestation(poolId, driver);
    this.pendingAttestations.set(key, promise);
    try {
      return await promise;
    } finally {
      this.pendingAttestations.delete(key);
    }
  }

  private async executeEnsureAttestation(poolId: number, driver: string): Promise<AttestationResult> {
    const alreadyAttested = await this.payout.isAttested(poolId, driver);
    if (alreadyAttested) {
      return { attested: true, signature: null };
    }

    const ride = await this.rides.findBestVerifiedByPoolAndWallet(poolId, driver);
    if (!ride) {
      throw new ConflictError(`driver ${driver} has no verified completed ride in pool ${poolId}`, 'driver_not_verified');
    }

    const facts = await this.batches.listFactsByRide(ride.id);
    const telemetryRoot = computeTelemetryMerkleRoot(facts, (d) => this.hasher.sha256(d));

    if (facts.length === 0 || telemetryRoot.every((b) => b === 0)) {
      throw new ConflictError('recording for ride has no facts or has been purged', 'recording_purged');
    }

    const dist = ride.distance || ride.completeDist;
    const verifiedKm = Math.max(1, Math.floor(dist / 1000));

    const { signature } = await this.payout.recordAttestation({
      poolId,
      driver,
      telemetryRoot,
      verifiedKm,
      status: 1, // 1 = Verified
    });

    return { attested: true, signature };
  }
}
