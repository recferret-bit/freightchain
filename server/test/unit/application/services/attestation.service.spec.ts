import { describe, expect, it } from 'vitest';
import { AttestationService } from '../../../../src/application/services/attestation.service.js';
import { ATTESTATION_FLAGGED, ATTESTATION_VERIFIED, type PoolPayoutChainPort } from '../../../../src/application/ports/economy/pool-payout-chain.port.js';
import type { RideRepositoryPort } from '../../../../src/application/ports/rides/ride.repository.port.js';
import type { RideBatchRepositoryPort } from '../../../../src/application/ports/telemetry/ride-batch.repository.port.js';
import { Ride } from '../../../../src/domain/rides/ride.entity.js';
import { RideStatus } from '../../../../src/domain/rides/ride-status.js';
import { ConflictError } from '../../../../src/domain/shared/errors.js';
import { NodeHasher } from '../../../../src/infrastructure/crypto/node.hasher.js';

const DRIVER = 'DriverWallet111111111111111111111111111111';
const OTHER = 'DriverWallet222222222222222222222222222222';

function rideOf(distance: number, wallet = DRIVER, completeDist = 30_000): Ride {
  const r = Ride.createFromTicket({ id: '00000000-0000-4000-8000-000000000001', wallet, tier: '1h', seed: 1, minSeconds: 300, timeScale: 1, poolId: 4, roundId: 1, now: new Date(0) });
  return Ride.restore({ ...r.snapshot(), status: RideStatus.Completed, lastS: distance, completeDist, driveSeconds: 300, endedAt: new Date(1) });
}

interface Setup {
  onChain?: { status: number; verifiedKm: number } | null;
  /** the driver's best verified ride (null = none) */
  best?: Ride | null;
  completed?: boolean;
  facts?: { hash: string }[];
  /** fails the first n record_attestation calls */
  failFirst?: number;
  delayMs?: number;
}

function setup(o: Setup = {}) {
  const sent: { poolId: number; driver: string; verifiedKm: number; status: number; telemetryRoot: Uint8Array | Buffer }[] = [];
  let fails = o.failFirst ?? 0;
  const payout = {
    attestationOf: async () => o.onChain ?? null,
    recordAttestation: async (i: (typeof sent)[number]) => {
      if (o.delayMs) await new Promise((r) => setTimeout(r, o.delayMs));
      if (fails-- > 0) throw new Error('RPC transient failure');
      sent.push(i);
      return { signature: `sig${sent.length}` };
    },
  } as unknown as PoolPayoutChainPort;
  const rides = {
    findBestVerifiedByPoolAndWallet: async () => (o.best === undefined ? rideOf(25_400) : o.best),
    hasCompletedInPool: async () => o.completed ?? true,
  } as unknown as RideRepositoryPort;
  const batches = { listFactsByRide: async () => o.facts ?? [{ hash: 'aa'.repeat(32) }, { hash: 'bb'.repeat(32) }] } as unknown as RideBatchRepositoryPort;
  return { service: new AttestationService(payout, rides, batches, new NodeHasher()), sent };
}

describe('AttestationService', () => {
  describe('ensureAttestation (a prize winner)', () => {
    it('records VERIFIED with floor(km) of the best verified ride and its recording\'s Merkle root', async () => {
      const { service, sent } = setup();
      expect(await service.ensureAttestation(4, DRIVER)).toEqual({ status: 'verified', signature: 'sig1' });
      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({ poolId: 4, driver: DRIVER, verifiedKm: 25, status: ATTESTATION_VERIFIED });
      expect(Buffer.from(sent[0]!.telemetryRoot).every((b) => b === 0)).toBe(false);
    });

    it('a driver already VERIFIED on chain: nothing is sent', async () => {
      const { service, sent } = setup({ onChain: { status: ATTESTATION_VERIFIED, verifiedKm: 25 } });
      expect(await service.ensureAttestation(4, DRIVER)).toEqual({ status: 'verified', signature: null });
      expect(sent).toHaveLength(0);
    });

    it('no verified ride, a ride under 1 km (never rounded up), or only rejected rides → ConflictError, no VERIFIED sent', async () => {
      await expect(setup({ best: null, completed: false }).service.ensureAttestation(4, DRIVER)).rejects.toThrow(ConflictError);
      const short = setup({ best: rideOf(999) });
      await expect(short.service.ensureAttestation(4, DRIVER)).rejects.toThrow(ConflictError);
      expect(short.sent).toHaveLength(0);
      const rejected = setup({ best: null, completed: true });
      await expect(rejected.service.ensureAttestation(4, DRIVER)).rejects.toThrow(ConflictError);
      expect(rejected.sent.every((s) => s.status !== ATTESTATION_VERIFIED)).toBe(true);
    });

    it('distance 0 falls back to the ride\'s finish line (completeDist)', async () => {
      const { service, sent } = setup({ best: rideOf(0, DRIVER, 42_900) });
      await service.ensureAttestation(4, DRIVER);
      expect(sent[0]!.verifiedKm).toBe(42);
    });

    it('a purged recording (no batches) → ConflictError', async () => {
      await expect(setup({ facts: [] }).service.ensureAttestation(4, DRIVER)).rejects.toThrow(/no batches/);
    });
  });

  describe('attestForPledges (a pledged driver)', () => {
    it('a verified ride → VERIFIED with floor(km)', async () => {
      const { service, sent } = setup({ best: rideOf(12_999) });
      expect(await service.attestForPledges(4, DRIVER)).toEqual({ status: 'verified', signature: 'sig1' });
      expect(sent[0]).toMatchObject({ verifiedKm: 12, status: ATTESTATION_VERIFIED });
    });

    it('only rejected finished rides → FLAGGED with 0 km (the sponsor gets it all back)', async () => {
      const { service, sent } = setup({ best: null, completed: true });
      expect(await service.attestForPledges(4, DRIVER)).toEqual({ status: 'flagged', signature: 'sig1' });
      expect(sent[0]).toMatchObject({ verifiedKm: 0, status: ATTESTATION_FLAGGED });
    });

    it('no finished ride, or a verified ride under 1 km → none, nothing sent (refunded once the pool is over)', async () => {
      const none = setup({ best: null, completed: false });
      expect(await none.service.attestForPledges(4, DRIVER)).toEqual({ status: 'none', signature: null });
      const short = setup({ best: rideOf(400) });
      expect(await short.service.attestForPledges(4, DRIVER)).toEqual({ status: 'none', signature: null });
      expect([...none.sent, ...short.sent]).toHaveLength(0);
    });

    it('on chain and still what the rides say (VERIFIED with the same km, FLAGGED with no verified ride): nothing sent', async () => {
      const v = setup({ onChain: { status: ATTESTATION_VERIFIED, verifiedKm: 25 } });
      expect(await v.service.attestForPledges(4, DRIVER)).toEqual({ status: 'verified', signature: null });
      const f = setup({ onChain: { status: ATTESTATION_FLAGGED, verifiedKm: 0 }, best: null });
      expect(await f.service.attestForPledges(4, DRIVER)).toEqual({ status: 'flagged', signature: null });
      expect([...v.sent, ...f.sent]).toHaveLength(0);
    });

    it('on chain but no longer what the rides say is WRITTEN AGAIN (pentest M7): other km → VERIFIED anew; the verified ride revoked → FLAGGED, and no prize', async () => {
      const km = setup({ onChain: { status: ATTESTATION_VERIFIED, verifiedKm: 3 } });
      expect(await km.service.attestForPledges(4, DRIVER)).toEqual({ status: 'verified', signature: 'sig1' });
      expect(km.sent[0]).toMatchObject({ status: ATTESTATION_VERIFIED, verifiedKm: 25 });
      const revoked = setup({ onChain: { status: ATTESTATION_VERIFIED, verifiedKm: 25 }, best: null });
      expect(await revoked.service.attestForPledges(4, DRIVER)).toEqual({ status: 'flagged', signature: 'sig1' });
      const prize = setup({ onChain: { status: ATTESTATION_VERIFIED, verifiedKm: 25 }, best: null });
      await expect(prize.service.ensureAttestation(4, DRIVER)).rejects.toMatchObject({ errorCode: 'driver_not_verified' });
      expect(prize.sent).toMatchObject([{ status: ATTESTATION_FLAGGED, verifiedKm: 0 }]);
      const accepted = setup({ onChain: { status: ATTESTATION_FLAGGED, verifiedKm: 0 } });   // an admin accepted the ride since
      expect(await accepted.service.attestForPledges(4, DRIVER)).toEqual({ status: 'verified', signature: 'sig1' });
    });

    it('an UNVERIFIED attestation on chain is decided again', async () => {
      const { service, sent } = setup({ onChain: { status: 0, verifiedKm: 0 } });
      expect((await service.attestForPledges(4, DRIVER)).status).toBe('verified');
      expect(sent).toHaveLength(1);
    });
  });

  describe('concurrency', () => {
    it('concurrent calls for one (pool, driver) share one transaction – also across winner and pledge calls', async () => {
      const { service, sent } = setup({ delayMs: 20 });
      const all = await Promise.all([service.ensureAttestation(4, DRIVER), service.ensureAttestation(4, DRIVER), service.attestForPledges(4, DRIVER)]);
      expect(sent).toHaveLength(1);
      expect(all.map((r) => r.signature)).toEqual(['sig1', 'sig1', 'sig1']);
    });

    it('other drivers are not coalesced with each other', async () => {
      const { service, sent } = setup({ delayMs: 10 });
      await Promise.all([service.ensureAttestation(4, DRIVER), service.ensureAttestation(4, OTHER), service.ensureAttestation(5, DRIVER)]);
      expect(sent).toHaveLength(3);
    });

    it('a failure rejects every joined call, and the next call starts clean', async () => {
      const { service, sent } = setup({ delayMs: 10, failFirst: 1 });
      const joined = await Promise.allSettled([service.ensureAttestation(4, DRIVER), service.ensureAttestation(4, DRIVER)]);
      expect(joined.map((r) => r.status)).toEqual(['rejected', 'rejected']);
      expect((await service.ensureAttestation(4, DRIVER)).signature).toBe('sig1');
      expect(sent).toHaveLength(1);
    });
  });
});
