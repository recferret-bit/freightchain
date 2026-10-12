import { describe, expect, it } from 'vitest';
import { AttestationService } from '../../src/application/services/attestation.service.js';
import type { PoolPayoutChainPort } from '../../src/application/ports/economy/pool-payout-chain.port.js';
import type { RideRepositoryPort } from '../../src/application/ports/rides/ride.repository.port.js';
import type { RideBatchRepositoryPort } from '../../src/application/ports/telemetry/ride-batch.repository.port.js';
import type { HasherPort } from '../../src/application/ports/shared/hasher.port.js';
import { NodeHasher } from '../../src/infrastructure/crypto/node.hasher.js';
import { ConflictError } from '../../src/domain/shared/errors.js';
import { Ride } from '../../src/domain/rides/ride.entity.js';
import { RideStatus } from '../../src/domain/rides/ride-status.js';
import { rideIdFromBytes, rideIdToBytes } from '../../src/domain/economy/pledge.types.js';

describe('Adversarial Verification Challenger M3-2 Stress Tests', () => {
  const hasher: HasherPort = new NodeHasher();
  const DRIVER_1 = 'DriverWallet111111111111111111111111111111';
  const DRIVER_2 = 'DriverWallet222222222222222222222222222222';

  function mockRide(id = '00000000-0000-4000-8000-000000000001', distance = 25000, wallet = DRIVER_1) {
    const created = Ride.createFromTicket({
      id,
      wallet,
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

  describe('AttestationService Concurrency & Failure Recovery', () => {
    it('concurrent failures reject all joined promises and allow subsequent clean retry', async () => {
      let attempts = 0;

      const payout = {
        isAttested: async () => false,
        recordAttestation: async () => {
          attempts++;
          await new Promise((r) => setTimeout(r, 20));
          if (attempts === 1) {
            throw new Error('RPC transient network failure');
          }
          return { signature: 'sig_retry_success' };
        },
      } as unknown as PoolPayoutChainPort;

      const rides = {
        findBestVerifiedByPoolAndWallet: async () => mockRide(),
      } as unknown as RideRepositoryPort;

      const batches = {
        listFactsByRide: async () => [{ hash: 'aa'.repeat(32) }],
      } as unknown as RideBatchRepositoryPort;

      const service = new AttestationService(payout, rides, batches, hasher);

      // 3 simultaneous calls during network failure
      const callsFirstBatch = [
        service.ensureAttestation(42, DRIVER_1),
        service.ensureAttestation(42, DRIVER_1),
        service.ensureAttestation(42, DRIVER_1),
      ];

      // All 3 joined promises must reject with the error
      const results1 = await Promise.allSettled(callsFirstBatch);
      expect(results1).toHaveLength(3);
      for (const res of results1) {
        expect(res.status).toBe('rejected');
        if (res.status === 'rejected') {
          expect(res.reason.message).toBe('RPC transient network failure');
        }
      }
      expect(attempts).toBe(1);

      // Now call again AFTER the failure has settled: must not be poisoned by old rejected promise!
      const retryResult = await service.ensureAttestation(42, DRIVER_1);
      expect(retryResult.attested).toBe(true);
      expect(retryResult.signature).toBe('sig_retry_success');
      expect(attempts).toBe(2);
    });

    it('independent drivers/pools are not throttled or coalesced with each other', async () => {
      let driver1Submissions = 0;
      let driver2Submissions = 0;

      const payout = {
        isAttested: async () => false,
        recordAttestation: async (req: { driver: string; poolId: number }) => {
          if (req.driver === DRIVER_1) driver1Submissions++;
          if (req.driver === DRIVER_2) driver2Submissions++;
          await new Promise((r) => setTimeout(r, 10));
          return { signature: `sig_${req.driver}` };
        },
      } as unknown as PoolPayoutChainPort;

      const rides = {
        findBestVerifiedByPoolAndWallet: async (_pool: number, wallet: string) => mockRide(undefined, 25000, wallet),
      } as unknown as RideRepositoryPort;

      const batches = {
        listFactsByRide: async () => [{ hash: 'aa'.repeat(32) }],
      } as unknown as RideBatchRepositoryPort;

      const service = new AttestationService(payout, rides, batches, hasher);

      // Call driver 1 twice, driver 2 twice in parallel
      const [r1a, r1b, r2a, r2b] = await Promise.all([
        service.ensureAttestation(42, DRIVER_1),
        service.ensureAttestation(42, DRIVER_1),
        service.ensureAttestation(42, DRIVER_2),
        service.ensureAttestation(42, DRIVER_2),
      ]);

      expect(r1a.signature).toBe(`sig_${DRIVER_1}`);
      expect(r1b.signature).toBe(`sig_${DRIVER_1}`);
      expect(r2a.signature).toBe(`sig_${DRIVER_2}`);
      expect(r2b.signature).toBe(`sig_${DRIVER_2}`);

      // Each distinct driver submitted exactly 1 transaction
      expect(driver1Submissions).toBe(1);
      expect(driver2Submissions).toBe(1);
    });

    it('clamps sub-kilometer distances to 1 km and uses completeDist as fallback when distance is 0', async () => {
      let submittedKm = 0;

      const payout = {
        isAttested: async () => false,
        recordAttestation: async (req: { verifiedKm: number }) => {
          submittedKm = req.verifiedKm;
          return { signature: 'sig_fallback' };
        },
      } as unknown as PoolPayoutChainPort;

      // Sub-kilometer ride: distance = 500m (< 1 km)
      const subKmRide = mockRide('00000000-0000-4000-8000-000000000009', 500);

      const rides = {
        findBestVerifiedByPoolAndWallet: async () => subKmRide,
      } as unknown as RideRepositoryPort;

      const batches = {
        listFactsByRide: async () => [{ hash: 'aa'.repeat(32) }],
      } as unknown as RideBatchRepositoryPort;

      const service = new AttestationService(payout, rides, batches, hasher);
      await service.ensureAttestation(42, DRIVER_1);

      // 500m -> Math.floor(500/1000) = 0 -> clamped by Math.max(1, 0) to 1 km
      expect(submittedKm).toBe(1);

      // When distance is 0, falls back to completeDist (~4500m -> 4 km)
      const zeroDistRide = mockRide('00000000-0000-4000-8000-000000000010', 0);
      rides.findBestVerifiedByPoolAndWallet = async () => zeroDistRide;
      await service.ensureAttestation(42, DRIVER_1);
      expect(submittedKm).toBe(4);
    });
  });

  describe('rideIdFromBytes & rideIdToBytes Edge Cases', () => {
    it('handles non-zero byteOffset views correctly', () => {
      const uuid = '4a5b6c7d-8e9f-4012-b345-6789abcdef01';
      const cleanBytes = rideIdToBytes(uuid);

      // Embed within larger buffer with byteOffset > 0
      const largeBuffer = new Uint8Array(128);
      largeBuffer.set(cleanBytes, 32);

      const subView = largeBuffer.subarray(32, 64);
      expect(subView.length).toBe(32);
      expect(subView.byteOffset).toBe(32);

      const parsedUuid = rideIdFromBytes(subView);
      expect(parsedUuid).toBe(uuid);

      // Corrupt padding within subView
      subView[16] = 0x01;
      expect(() => rideIdFromBytes(subView)).toThrow(RangeError);
      expect(() => rideIdFromBytes(subView)).toThrow('bytes 16..31 of ride id must be zero-padded');
    });

    it('exhaustively rejects any non-zero value at any position in 16..31', () => {
      const uuid = '00000000-0000-4000-8000-000000000000';
      const base = rideIdToBytes(uuid);

      for (let pos = 16; pos < 32; pos++) {
        for (const testVal of [1, 2, 127, 128, 255]) {
          const mutated = new Uint8Array(base);
          mutated[pos] = testVal;
          expect(() => rideIdFromBytes(mutated)).toThrow(RangeError);
        }
      }
    });

    it('works identically with Node.js Buffer', () => {
      const uuid = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
      const bytes = rideIdToBytes(uuid);
      const buf = Buffer.from(bytes);

      expect(rideIdFromBytes(buf)).toBe(uuid);

      buf[31] = 0xff;
      expect(() => rideIdFromBytes(buf)).toThrow(RangeError);
    });
  });
});
