import { describe, expect, it } from 'vitest';
import { AttestationService } from '../../../../src/application/services/attestation.service.js';
import type { PoolPayoutChainPort } from '../../../../src/application/ports/economy/pool-payout-chain.port.js';
import type { RideRepositoryPort } from '../../../../src/application/ports/rides/ride.repository.port.js';
import type { RideBatchRepositoryPort } from '../../../../src/application/ports/telemetry/ride-batch.repository.port.js';
import type { HasherPort } from '../../../../src/application/ports/shared/hasher.port.js';
import { NodeHasher } from '../../../../src/infrastructure/crypto/node.hasher.js';
import { ConflictError } from '../../../../src/domain/shared/errors.js';
import { Ride } from '../../../../src/domain/rides/ride.entity.js';
import { RideStatus } from '../../../../src/domain/rides/ride-status.js';

describe('Adversarial Stress Test: AttestationService Idempotency & Concurrency', () => {
  const hasher: HasherPort = new NodeHasher();
  const DRIVER = 'DriverWallet111111111111111111111111111111';

  function mockRide(id = '00000000-0000-4000-8000-000000000001', distance = 25000) {
    const created = Ride.createFromTicket({
      id,
      wallet: DRIVER,
      tier: '1h',
      seed: 12345,
      minSeconds: 300,
      timeScale: 1,
      poolId: 42,
      roundId: 1,
      now: new Date('2026-10-12T00:00:00Z'),
    });
    return Ride.restore({
      ...created.snapshot(),
      status: RideStatus.Completed,
      lastS: distance,
      driveSeconds: 300,
      endedAt: new Date('2026-10-12T00:05:00Z'),
    });
  }

  describe('Idempotency & Re-execution', () => {
    it('returns immediately without chain submission if already attested on-chain', async () => {
      let isAttestedCalls = 0;
      let recordAttestationCalls = 0;
      let rideLookupCalls = 0;

      const payout = {
        isAttested: async () => {
          isAttestedCalls++;
          return true; // Already attested
        },
        recordAttestation: async () => {
          recordAttestationCalls++;
          return { signature: 'sig_should_not_be_called' };
        },
      } as unknown as PoolPayoutChainPort;

      const rides = {
        findBestVerifiedByPoolAndWallet: async () => {
          rideLookupCalls++;
          return mockRide();
        },
      } as unknown as RideRepositoryPort;

      const batches = {
        listFactsByRide: async () => [],
      } as unknown as RideBatchRepositoryPort;

      const service = new AttestationService(payout, rides, batches, hasher);

      const res1 = await service.ensureAttestation(42, DRIVER);
      const res2 = await service.ensureAttestation(42, DRIVER);

      expect(res1).toEqual({ attested: true, signature: null });
      expect(res2).toEqual({ attested: true, signature: null });
      expect(isAttestedCalls).toBe(2);
      expect(recordAttestationCalls).toBe(0);
      expect(rideLookupCalls).toBe(0);
    });

    it('throws ConflictError if driver has no completed ride', async () => {
      const payout = {
        isAttested: async () => false,
      } as unknown as PoolPayoutChainPort;

      const rides = {
        findBestVerifiedByPoolAndWallet: async () => null,
      } as unknown as RideRepositoryPort;

      const batches = {} as unknown as RideBatchRepositoryPort;

      const service = new AttestationService(payout, rides, batches, hasher);
      await expect(service.ensureAttestation(42, DRIVER)).rejects.toThrow(ConflictError);
    });
  });

  describe('Zero-batch telemetry edge case (On-chain constraint violation)', () => {
    it('rejects zero telemetry batches or all-zero Merkle root with ConflictError', async () => {
      let recordAttestationCalled = false;

      const payout = {
        isAttested: async () => false,
        recordAttestation: async () => {
          recordAttestationCalled = true;
          return { signature: 'sig_empty_root' };
        },
      } as unknown as PoolPayoutChainPort;

      const rides = {
        findBestVerifiedByPoolAndWallet: async () => mockRide(),
      } as unknown as RideRepositoryPort;

      // Retention sweeper or empty facts
      const batches = {
        listFactsByRide: async () => [],
      } as unknown as RideBatchRepositoryPort;

      const service = new AttestationService(payout, rides, batches, hasher);
      await expect(service.ensureAttestation(42, DRIVER)).rejects.toThrow(ConflictError);
      await expect(service.ensureAttestation(42, DRIVER)).rejects.toThrow('recording for ride has no facts or has been purged');
      expect(recordAttestationCalled).toBe(false);
    });
  });

  describe('Concurrency Stress Testing', () => {
    it('coalesces simultaneous calls so only one on-chain transaction submission occurs', async () => {
      let onChainSubmissions = 0;
      let isAttestedCount = 0;

      const payout = {
        isAttested: async () => {
          isAttestedCount++;
          // Simulated delay for RPC read
          await new Promise((r) => setTimeout(r, 20));
          return false;
        },
        recordAttestation: async () => {
          onChainSubmissions++;
          // Simulated transaction delay
          await new Promise((r) => setTimeout(r, 50));
          return { signature: `sig_tx_${onChainSubmissions}` };
        },
      } as unknown as PoolPayoutChainPort;

      const rides = {
        findBestVerifiedByPoolAndWallet: async () => mockRide(),
      } as unknown as RideRepositoryPort;

      const batches = {
        listFactsByRide: async () => [{ hash: 'aa'.repeat(32) }],
      } as unknown as RideBatchRepositoryPort;

      const service = new AttestationService(payout, rides, batches, hasher);

      // 5 concurrent calls to ensureAttestation for the same pool and driver
      const promises = [
        service.ensureAttestation(42, DRIVER),
        service.ensureAttestation(42, DRIVER),
        service.ensureAttestation(42, DRIVER),
        service.ensureAttestation(42, DRIVER),
        service.ensureAttestation(42, DRIVER),
      ];

      const results = await Promise.all(promises);

      // All 5 resolve
      expect(results).toHaveLength(5);
      for (const r of results) {
        expect(r.attested).toBe(true);
        expect(r.signature).toBe('sig_tx_1');
      }

      // In-flight promise caching ensures exactly 1 RPC check and 1 on-chain submission
      expect(isAttestedCount).toBe(1);
      expect(onChainSubmissions).toBe(1);
    });
  });
});
