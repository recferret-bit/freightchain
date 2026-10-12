import { createHash } from 'node:crypto';
import { AttestationService } from '../../../../src/application/services/attestation.service.js';
import type { PoolPayoutChainPort } from '../../../../src/application/ports/economy/pool-payout-chain.port.js';
import type { RideRepositoryPort } from '../../../../src/application/ports/rides/ride.repository.port.js';
import type { RideBatchRepositoryPort } from '../../../../src/application/ports/telemetry/ride-batch.repository.port.js';
import { HasherPort } from '../../../../src/application/ports/shared/hasher.port.js';
import { Ride } from '../../../../src/domain/rides/ride.entity.js';
import { ConflictError } from '../../../../src/domain/shared/errors.js';

class MockHasher extends HasherPort {
  sha256Hex(text: string): string {
    return createHash('sha256').update(text).digest('hex');
  }
  sha256(data: Uint8Array | Buffer | string): Buffer {
    return createHash('sha256').update(data).digest();
  }
}

describe('AttestationService', () => {
  const hasher = new MockHasher();

  it('returns immediately if already attested on chain (idempotent)', async () => {
    let checked = false;
    let recorded = false;

    const payout = {
      isAttested: async (poolId: number, driver: string) => {
        checked = true;
        return true;
      },
      recordAttestation: async () => {
        recorded = true;
        return { signature: 'sig' };
      },
    } as unknown as PoolPayoutChainPort;

    const rides = {
      findBestVerifiedByPoolAndWallet: async () => null,
    } as unknown as RideRepositoryPort;

    const batches = {
      listFactsByRide: async () => [],
    } as unknown as RideBatchRepositoryPort;

    const service = new AttestationService(payout, rides, batches, hasher);
    const res = await service.ensureAttestation(42, 'driverWallet');

    expect(checked).toBe(true);
    expect(recorded).toBe(false);
    expect(res).toEqual({ attested: true, signature: null });
  });

  it('throws ConflictError if driver has no verified completed ride in pool', async () => {
    const payout = {
      isAttested: async () => false,
    } as unknown as PoolPayoutChainPort;

    const rides = {
      findBestVerifiedByPoolAndWallet: async () => null,
    } as unknown as RideRepositoryPort;

    const batches = {} as unknown as RideBatchRepositoryPort;

    const service = new AttestationService(payout, rides, batches, hasher);
    await expect(service.ensureAttestation(42, 'driverWallet')).rejects.toThrow(ConflictError);
  });

  it('computes Merkle root and submits on-chain attestation when not attested', async () => {
    let recordedInput: unknown = null;

    const payout = {
      isAttested: async () => false,
      recordAttestation: async (input: unknown) => {
        recordedInput = input;
        return { signature: 'attestation_sig_123' };
      },
    } as unknown as PoolPayoutChainPort;

    const created = Ride.createFromTicket({
      id: '12345678-1234-1234-1234-123456789abc',
      wallet: 'driverWallet',
      tier: '1h',
      seed: 12345,
      minSeconds: 300,
      timeScale: 1,
      poolId: 42,
      roundId: 1,
      now: new Date('2026-10-12T00:00:00Z'),
    });
    const mockRide = Ride.restore({ ...created.snapshot(), lastS: 25_000, driveSeconds: 300 });

    const rides = {
      findBestVerifiedByPoolAndWallet: async () => mockRide,
    } as unknown as RideRepositoryPort;

    const batches = {
      listFactsByRide: async () => [
        { hash: 'aa'.repeat(32) },
        { hash: 'bb'.repeat(32) },
      ],
    } as unknown as RideBatchRepositoryPort;

    const service = new AttestationService(payout, rides, batches, hasher);
    const res = await service.ensureAttestation(42, 'driverWallet');

    expect(res).toEqual({ attested: true, signature: 'attestation_sig_123' });
    expect(recordedInput).toMatchObject({
      poolId: 42,
      driver: 'driverWallet',
      verifiedKm: 25,
      status: 1,
    });
    expect((recordedInput as { telemetryRoot: Buffer }).telemetryRoot).toBeInstanceOf(Buffer);
    expect((recordedInput as { telemetryRoot: Buffer }).telemetryRoot.length).toBe(32);
  });

  it('throws ConflictError if telemetry facts are empty or telemetry root is all zeros', async () => {
    const payout = {
      isAttested: async () => false,
      recordAttestation: async () => ({ signature: 'sig' }),
    } as unknown as PoolPayoutChainPort;

    const created = Ride.createFromTicket({
      id: '12345678-1234-1234-1234-123456789abc',
      wallet: 'driverWallet',
      tier: '1h',
      seed: 12345,
      minSeconds: 300,
      timeScale: 1,
      poolId: 42,
      roundId: 1,
      now: new Date('2026-10-12T00:00:00Z'),
    });
    const mockRide = Ride.restore({ ...created.snapshot(), lastS: 25_000, driveSeconds: 300 });

    const rides = {
      findBestVerifiedByPoolAndWallet: async () => mockRide,
    } as unknown as RideRepositoryPort;

    const batches = {
      listFactsByRide: async () => [],
    } as unknown as RideBatchRepositoryPort;

    const service = new AttestationService(payout, rides, batches, hasher);
    await expect(service.ensureAttestation(42, 'driverWallet')).rejects.toThrow(ConflictError);
    await expect(service.ensureAttestation(42, 'driverWallet')).rejects.toThrow('recording for ride has no facts or has been purged');
  });

  it('coalesces concurrent calls for the same pool and driver into a single attestation submission', async () => {
    let callCount = 0;
    const payout = {
      isAttested: async () => false,
      recordAttestation: async () => {
        callCount++;
        await new Promise((resolve) => setTimeout(resolve, 20));
        return { signature: 'sig_concurrent' };
      },
    } as unknown as PoolPayoutChainPort;

    const created = Ride.createFromTicket({
      id: '12345678-1234-1234-1234-123456789abc',
      wallet: 'driverWallet',
      tier: '1h',
      seed: 12345,
      minSeconds: 300,
      timeScale: 1,
      poolId: 42,
      roundId: 1,
      now: new Date('2026-10-12T00:00:00Z'),
    });
    const mockRide = Ride.restore({ ...created.snapshot(), lastS: 25_000, driveSeconds: 300 });

    const rides = {
      findBestVerifiedByPoolAndWallet: async () => mockRide,
    } as unknown as RideRepositoryPort;

    const batches = {
      listFactsByRide: async () => [{ hash: 'aa'.repeat(32) }],
    } as unknown as RideBatchRepositoryPort;

    const service = new AttestationService(payout, rides, batches, hasher);
    const [res1, res2] = await Promise.all([
      service.ensureAttestation(42, 'driverWallet'),
      service.ensureAttestation(42, 'driverWallet'),
    ]);

    expect(callCount).toBe(1);
    expect(res1).toEqual({ attested: true, signature: 'sig_concurrent' });
    expect(res2).toEqual({ attested: true, signature: 'sig_concurrent' });
  });
});
