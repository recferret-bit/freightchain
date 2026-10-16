import { Injectable, Optional } from '@nestjs/common';
import { RideStatus } from '../../domain/rides/ride-status.js';
import { ConflictError } from '../../domain/shared/errors.js';
import { computeTelemetryMerkleRoot } from '../../domain/telemetry/telemetry-merkle.js';
import { VerdictStatus } from '../../domain/verdict/verdict.dto.js';
import { ATTESTATION_FLAGGED, ATTESTATION_UNVERIFIED, ATTESTATION_VERIFIED, PoolPayoutChainPort, type RideAttestationState } from '../ports/economy/pool-payout-chain.port.js';
import { PoolRepositoryPort } from '../ports/economy/pool.repository.port.js';
import { RideRepositoryPort } from '../ports/rides/ride.repository.port.js';
import { RideBatchRepositoryPort } from '../ports/telemetry/ride-batch.repository.port.js';
import { RideVerdictRepositoryPort } from '../ports/verdict/ride-verdict.repository.port.js';
import { CachePort } from '../ports/shared/cache.port.js';
import { ClockPort } from '../ports/shared/clock.port.js';
import { HasherPort } from '../ports/shared/hasher.port.js';

/** What the chain should say about one pledged ride (program v4 RideAttestation – audit H4: a pledge settles on ITS ride, never on the driver's best one). */
export type RideFacts =
  | { status: 'verified'; telemetryRoot: Uint8Array; verifiedKm: number }
  /** rejected: its sponsors get everything back */
  | { status: 'flagged' }
  /** nothing to attest: not finished, ended after the pool's play deadline (it counts for nothing, H6), or under 1 km – its pledges are refunded once the pool is over */
  | { status: 'none' }
  /** not judged yet, or under review: wait */
  | { status: 'undecided' };

export interface AttestationResult {
  /** what the chain holds for the ride now (after this call) */
  status: RideFacts['status'];
  /** the record_ride_attestation this call sent; null = nothing was sent */
  signature: string | null;
}

/**
 * The payout key's RideAttestation per pledged ride – the server's verdict written on chain, with the RFC 6962 Merkle root of the ride's recording batches (anyone
 * holding the recording can recompute it): `settle_pledge` pays the pledge by its `verified_km`, from the attestation's `settle_from` (the review lock – every record
 * is public that long first). It is the server's word, not a proof. Rewritten while the verdicts move, until a pledge was settled on it (then the program keeps it).
 * Concurrent calls for the same ride share one transaction.
 */
@Injectable()
export class AttestationService {
  private readonly inFlight = new Map<string, Promise<AttestationResult>>();

  constructor(
    private readonly payout: PoolPayoutChainPort,
    private readonly rides: RideRepositoryPort,
    private readonly verdicts: RideVerdictRepositoryPort,
    private readonly batches: RideBatchRepositoryPort,
    private readonly pools: PoolRepositoryPort,
    private readonly hasher: HasherPort,
    private readonly clock: ClockPort,
    @Optional() private readonly cache?: CachePort,
  ) {}

  /** The verdict of `rideId` as an attestation of pool `poolId`, read afresh every time (audit M7: a verdict revoked after an attestation was written). */
  async factsOf(poolId: number, rideId: string): Promise<RideFacts> {
    const ride = await this.rides.findById(rideId);
    if (!ride || ride.poolId !== poolId) return { status: 'none' };
    const pool = await this.pools.findById(poolId);
    // a ride never started can't start past the pool's play deadline (409 rides_closed) and the sweeper ends only running ones – waiting on it would stall the payout until expiry
    if (!ride.endedAt) return !ride.startedAt && pool && this.clock.now().getTime() > pool.rideWindow().endBy.getTime() ? { status: 'none' } : { status: 'undecided' };
    if (ride.status !== RideStatus.Completed) return { status: 'none' };
    if (pool && ride.endedAt.getTime() > pool.rideWindow().endBy.getTime()) return { status: 'none' };
    const verdict = await this.verdicts.findByRide(rideId);
    if (!verdict) return { status: 'undecided' };
    if (verdict.status === VerdictStatus.Rejected) return { status: 'flagged' };
    if (verdict.status !== VerdictStatus.Verified) return { status: 'undecided' };
    const verifiedKm = Math.floor((ride.distance || ride.completeDist) / 1000);   // whole km, never rounded up
    if (verifiedKm < 1) return { status: 'none' };
    const facts = await this.batches.listFactsByRide(rideId);
    const telemetryRoot = computeTelemetryMerkleRoot(facts, (d) => this.hasher.sha256(d));
    if (facts.length === 0 || telemetryRoot.every((b) => b === 0)) throw new ConflictError(`the recording of ride ${rideId} has no batches (purged?)`, 'recording_purged');
    return { status: 'verified', telemetryRoot, verifiedKm };
  }

  /** Make the chain say what the ride's verdict says (only while a rewrite is still allowed); 'undecided' sends nothing. */
  async attestRide(poolId: number, rideId: string): Promise<AttestationResult> {
    const key = `${poolId}:${rideId}`;
    const pending = this.inFlight.get(key);
    if (pending) return pending;
    const promise = (async () => {
      const lockKey = `attest:${key}`;
      const acquired = this.cache ? await this.cache.tryLock(lockKey, 30_000) : true;
      if (!acquired) {
        const facts = await this.factsOf(poolId, rideId);
        return { status: facts.status, signature: null };
      }
      try {
        return await this.attest(poolId, rideId);
      } finally {
        if (this.cache) await this.cache.releaseLock(lockKey);
      }
    })();
    this.inFlight.set(key, promise);
    try { return await promise; } finally { this.inFlight.delete(key); }
  }

  private async attest(poolId: number, rideId: string): Promise<AttestationResult> {
    const facts = await this.factsOf(poolId, rideId);
    if (facts.status === 'undecided') return { status: 'undecided', signature: null };
    const onChain = await this.payout.rideAttestationOf(poolId, rideId);
    if (onChain && onChain.settledPledges > 0) return { status: chainStatus(onChain), signature: null };   // final: a pledge was settled on it
    const want = facts.status === 'verified' ? ATTESTATION_VERIFIED : facts.status === 'flagged' ? ATTESTATION_FLAGGED : ATTESTATION_UNVERIFIED;
    if (!onChain && want === ATTESTATION_UNVERIFIED) return { status: 'none', signature: null };   // nothing to say: its pledges are refunded once the pool is over
    const km = facts.status === 'verified' ? facts.verifiedKm : 0;
    if (onChain && onChain.status === want && (want !== ATTESTATION_VERIFIED || onChain.verifiedKm === km)) return { status: facts.status, signature: null };
    const ride = await this.rides.findById(rideId);
    const { signature } = await this.payout.recordRideAttestation({
      poolId, rideId, driver: ride!.wallet, telemetryRoot: facts.status === 'verified' ? facts.telemetryRoot : new Uint8Array(32), verifiedKm: km, status: want,
    });
    return { status: facts.status, signature };
  }
}

const chainStatus = (a: RideAttestationState): RideFacts['status'] =>
  a.status === ATTESTATION_VERIFIED ? 'verified' : a.status === ATTESTATION_FLAGGED ? 'flagged' : 'none';
