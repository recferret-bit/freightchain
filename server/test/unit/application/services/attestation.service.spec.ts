import { describe, expect, it } from 'vitest';
import { AttestationService } from '../../../../src/application/services/attestation.service.js';
import { ATTESTATION_FLAGGED, ATTESTATION_UNVERIFIED, ATTESTATION_VERIFIED } from '../../../../src/application/ports/economy/pool-payout-chain.port.js';
import type { RideProps } from '../../../../src/domain/rides/ride.entity.js';
import { RideStatus } from '../../../../src/domain/rides/ride-status.js';
import { ConflictError } from '../../../../src/domain/shared/errors.js';
import { computeTelemetryMerkleRoot } from '../../../../src/domain/telemetry/telemetry-merkle.js';
import { VerdictStatus } from '../../../../src/domain/verdict/verdict.dto.js';
import { FakePoolPayoutChain } from '../../../support/fake-pool-payout-chain.js';
import { wallet } from '../../../support/pledges.js';
import { poolRide, type PoolRideVerdict } from '../../../support/pool-rides.js';
import { aPool } from '../../../support/pools.js';
import { unitContext } from '../../../support/unit-context.js';

const ZERO = new Uint8Array(32);

async function setup() {
  const ctx = unitContext();
  const driver = wallet();
  await ctx.player(driver);
  await ctx.pools.upsert(aPool({ id: 1, status: 'active' }, ctx.now()));
  await ctx.pools.upsert(aPool({ id: 2, status: 'active' }, ctx.now()));
  const payout = new FakePoolPayoutChain(ctx.poolChain);
  payout.payoutAddress = 'Payout11111111111111111111111111111111111111';
  const service = new AttestationService(payout, ctx.rides, ctx.verdictRepo, ctx.batches, ctx.pools, ctx.hasher, ctx.clock);
  /** a completed ride of pool 1 by `driver`, then its stored props overwritten (endedAt, status, completeDist…) */
  const ride = async (metres: number, verdict: PoolRideVerdict = 'verified', over: Partial<RideProps> = {}, by = driver) => {
    const id = await poolRide(ctx, by, metres, verdict);
    const row = ctx.db.rides.get(id)!;
    ctx.db.rides.set(id, { ...row, props: { ...row.props, ...over } });
    return id;
  };
  /** what an earlier pass wrote on chain for (pool 1, ride) */
  const onChain = (rideId: string, status: number, verifiedKm: number, settledPledges = 0, by = driver) =>
    payout.attestations.set(`1:${rideId}`, { driver: by, status, verifiedKm, settleFrom: new Date(0), settledPledges, telemetryRoot: ZERO });
  const sent = () => payout.calls.filter((c) => c.startsWith('attest '));
  const stored = (rideId: string) => payout.attestations.get(`1:${rideId}`);
  const rootOf = async (rideId: string) => computeTelemetryMerkleRoot(await ctx.batches.listFactsByRide(rideId), (d) => ctx.hasher.sha256(d));
  const revoke = async (rideId: string) => {
    const v = (await ctx.verdictRepo.findByRide(rideId))!;
    v.override(VerdictStatus.Rejected, 'Admin', null, ctx.now());
    await ctx.verdictRepo.save(v);
  };
  return { ctx, driver, payout, service, ride, onChain, sent, stored, rootOf, revoke };
}

describe('AttestationService', () => {
  describe('factsOf (what the chain should say about one pledged ride)', () => {
    it('a verified ride ≥ 1 km → VERIFIED with floor(km) (never rounded up) and the RFC 6962 root of its recording', async () => {
      const { service, ride, rootOf } = await setup();
      const id = await ride(12_999);
      const facts = await service.factsOf(1, id);
      expect(facts).toMatchObject({ status: 'verified', verifiedKm: 12 });
      expect(Buffer.from((facts as { telemetryRoot: Uint8Array }).telemetryRoot)).toEqual(Buffer.from(await rootOf(id)));
      expect(Buffer.from((facts as { telemetryRoot: Uint8Array }).telemetryRoot).every((b) => b === 0)).toBe(false);
    });

    it('distance 0 falls back to the ride\'s finish line (completeDist); an admin-accepted ride counts as verified', async () => {
      const { service, ride } = await setup();
      expect(await service.factsOf(1, await ride(0, 'verified', { completeDist: 42_900 }))).toMatchObject({ status: 'verified', verifiedKm: 42 });
      expect(await service.factsOf(1, await ride(5_000, 'accepted'))).toMatchObject({ status: 'verified', verifiedKm: 5 });
    });

    it('a rejected ride (by the machine or the admin) → flagged: its sponsors get everything back', async () => {
      const { service, ride } = await setup();
      expect(await service.factsOf(1, await ride(9_000, 'rejected'))).toEqual({ status: 'flagged' });
      expect(await service.factsOf(1, await ride(9_000, 'refused'))).toEqual({ status: 'flagged' });
    });

    it('none: an unknown ride, a ride of another pool, one not completed, one ended after the play deadline (H6), a verified ride under 1 km', async () => {
      const { ctx, service, ride } = await setup();
      const deadline = (await ctx.pools.findById(1))!.playDeadline.getTime();
      expect(await service.factsOf(1, '00000000-0000-4000-8000-00000000dead')).toEqual({ status: 'none' });
      expect(await service.factsOf(2, await ride(9_000))).toEqual({ status: 'none' });
      expect(await service.factsOf(1, await ride(9_000, 'verified', { status: RideStatus.Failed }))).toEqual({ status: 'none' });
      expect(await service.factsOf(1, await ride(9_000, 'verified', { endedAt: new Date(deadline + 1) }))).toEqual({ status: 'none' });
      expect(await service.factsOf(1, await ride(9_000, 'verified', { endedAt: new Date(deadline) }))).toMatchObject({ status: 'verified' });   // AT the deadline still counts
      expect(await service.factsOf(1, await ride(999))).toEqual({ status: 'none' });
    });

    it('undecided: still on the road, never judged, flagged and waiting for the admin', async () => {
      const { service, ride } = await setup();
      expect(await service.factsOf(1, await ride(9_000, 'verified', { status: RideStatus.Running, endedAt: null }))).toEqual({ status: 'undecided' });
      expect(await service.factsOf(1, await ride(9_000, 'none'))).toEqual({ status: 'undecided' });
      expect(await service.factsOf(1, await ride(9_000, 'flagged'))).toEqual({ status: 'undecided' });
    });

    it('a ride created but never started: undecided until the play deadline, then none – it can no longer start, and nothing else would end it (the payout would stall to expiry)', async () => {
      const { ctx, service, ride } = await setup();
      const id = await ride(0, 'none', { status: RideStatus.Created, startedAt: null, endedAt: null });
      expect(await service.factsOf(1, id)).toEqual({ status: 'undecided' });
      ctx.clock.advance((((await ctx.pools.findById(1))!.rideWindow().endBy.getTime() - ctx.now().getTime()) / 1000) + 1);
      expect(await service.factsOf(1, id)).toEqual({ status: 'none' });
      expect(await service.factsOf(1, await ride(9_000, 'verified', { status: RideStatus.Running, startedAt: ctx.now(), endedAt: null }))).toEqual({ status: 'undecided' });   // a started one waits for the sweeper
    });

    it('a verified ride whose recording was purged → ConflictError recording_purged', async () => {
      const { ctx, service, ride } = await setup();
      const id = await ride(9_000);
      for (const [key, b] of ctx.db.batches) if (b.rideId === id) ctx.db.batches.delete(key);   // the retention sweep keeps a live pool's recordings: drop them by hand
      await expect(service.factsOf(1, id)).rejects.toThrow(ConflictError);
      await expect(service.factsOf(1, id)).rejects.toMatchObject({ errorCode: 'recording_purged' });
    });
  });

  describe('attestRide', () => {
    it('a verified ride → record_ride_attestation VERIFIED with floor(km), the recording\'s root, and the RIDE\'s driver', async () => {
      const { service, ride, sent, stored, rootOf, driver } = await setup();
      const id = await ride(25_400);
      expect(await service.attestRide(1, id)).toEqual({ status: 'verified', signature: expect.any(String) });
      expect(sent()).toEqual([`attest 1 ${id} ${ATTESTATION_VERIFIED}`]);
      expect(stored(id)).toMatchObject({ driver, status: ATTESTATION_VERIFIED, verifiedKm: 25, settledPledges: 0 });
      expect(Buffer.from(stored(id)!.telemetryRoot)).toEqual(Buffer.from(await rootOf(id)));
    });

    it('a rejected ride → FLAGGED with 0 km and a zero root', async () => {
      const { service, ride, stored } = await setup();
      const id = await ride(25_400, 'rejected');
      expect(await service.attestRide(1, id)).toEqual({ status: 'flagged', signature: expect.any(String) });
      expect(stored(id)).toMatchObject({ status: ATTESTATION_FLAGGED, verifiedKm: 0 });
      expect(Buffer.from(stored(id)!.telemetryRoot).every((b) => b === 0)).toBe(true);
    });

    it('none and nothing on chain: nothing is sent (refunded once the pool is over); undecided sends nothing and does not even read the chain', async () => {
      const { service, ride, sent, payout } = await setup();
      expect(await service.attestRide(1, await ride(400))).toEqual({ status: 'none', signature: null });
      expect(sent()).toEqual([]);
      const reads = payout.attestationReads;
      expect(await service.attestRide(1, await ride(9_000, 'flagged'))).toEqual({ status: 'undecided', signature: null });
      expect(payout.attestationReads).toBe(reads);
      expect(sent()).toEqual([]);
    });

    it('two rides of one driver in one pool get one attestation EACH, with their own km (pentest H4: never the driver\'s best ride)', async () => {
      const { service, ride, stored } = await setup();
      const short = await ride(3_500), long = await ride(42_100);
      await service.attestRide(1, short);
      await service.attestRide(1, long);
      expect(stored(short)).toMatchObject({ status: ATTESTATION_VERIFIED, verifiedKm: 3 });
      expect(stored(long)).toMatchObject({ status: ATTESTATION_VERIFIED, verifiedKm: 42 });
    });

    it('on chain and still what the verdict says (VERIFIED with the same km, FLAGGED for a rejected ride): nothing sent', async () => {
      const { service, ride, onChain, sent } = await setup();
      const v = await ride(25_400), f = await ride(25_400, 'rejected');
      onChain(v, ATTESTATION_VERIFIED, 25);
      onChain(f, ATTESTATION_FLAGGED, 0);
      expect(await service.attestRide(1, v)).toEqual({ status: 'verified', signature: null });
      expect(await service.attestRide(1, f)).toEqual({ status: 'flagged', signature: null });
      expect(sent()).toEqual([]);
    });

    it('on chain but no longer what the verdict says is WRITTEN AGAIN (pentest M7): other km → VERIFIED anew, revoked → FLAGGED, accepted since → VERIFIED, UNVERIFIED → decided', async () => {
      const { service, ride, onChain, stored, revoke } = await setup();
      const km = await ride(25_400);
      onChain(km, ATTESTATION_VERIFIED, 3);
      expect(await service.attestRide(1, km)).toEqual({ status: 'verified', signature: expect.any(String) });
      expect(stored(km)).toMatchObject({ status: ATTESTATION_VERIFIED, verifiedKm: 25 });
      const revoked = await ride(25_400);
      onChain(revoked, ATTESTATION_VERIFIED, 25);
      await revoke(revoked);
      expect(await service.attestRide(1, revoked)).toEqual({ status: 'flagged', signature: expect.any(String) });
      expect(stored(revoked)).toMatchObject({ status: ATTESTATION_FLAGGED, verifiedKm: 0 });
      const accepted = await ride(7_000, 'accepted');
      onChain(accepted, ATTESTATION_FLAGGED, 0);
      expect(await service.attestRide(1, accepted)).toEqual({ status: 'verified', signature: expect.any(String) });
      const unverified = await ride(7_000);
      onChain(unverified, ATTESTATION_UNVERIFIED, 0);
      expect((await service.attestRide(1, unverified)).status).toBe('verified');
      expect(stored(unverified)).toMatchObject({ status: ATTESTATION_VERIFIED, verifiedKm: 7 });
    });

    it('a VERIFIED attestation whose ride now counts for nothing (ended after the play deadline) is written UNVERIFIED', async () => {
      const { ctx, service, ride, onChain, stored } = await setup();
      const id = await ride(9_000, 'verified', { endedAt: new Date((await ctx.pools.findById(1))!.playDeadline.getTime() + 1) });
      onChain(id, ATTESTATION_VERIFIED, 9);
      expect(await service.attestRide(1, id)).toEqual({ status: 'none', signature: expect.any(String) });
      expect(stored(id)).toMatchObject({ status: ATTESTATION_UNVERIFIED, verifiedKm: 0 });
    });

    it('an attestation a pledge was settled on is FINAL: never rewritten, the chain\'s word is returned', async () => {
      const { service, ride, onChain, sent, stored, revoke } = await setup();
      const id = await ride(25_400);
      onChain(id, ATTESTATION_VERIFIED, 25, 1);
      await revoke(id);
      expect(await service.attestRide(1, id)).toEqual({ status: 'verified', signature: null });
      expect(sent()).toEqual([]);
      expect(stored(id)).toMatchObject({ status: ATTESTATION_VERIFIED, verifiedKm: 25, settledPledges: 1 });
    });
  });

  describe('concurrency', () => {
    it('concurrent calls for one (pool, ride) share one transaction', async () => {
      const { service, ride, sent } = await setup();
      const id = await ride(25_400);
      const all = await Promise.all([service.attestRide(1, id), service.attestRide(1, id), service.attestRide(1, id)]);
      expect(sent()).toHaveLength(1);
      expect(new Set(all.map((r) => r.signature)).size).toBe(1);
      expect(all[0]!.signature).toEqual(expect.any(String));
    });

    it('different rides (also of the same driver) are not coalesced', async () => {
      const { service, ride, sent } = await setup();
      const a = await ride(5_000), b = await ride(6_000), c = await ride(7_000, 'verified', {}, wallet());
      await Promise.all([service.attestRide(1, a), service.attestRide(1, b), service.attestRide(1, c)]);
      expect(sent()).toHaveLength(3);
    });

    it('a failure rejects every joined call, and the next call starts clean', async () => {
      const { service, ride, sent, payout } = await setup();
      const id = await ride(25_400);
      payout.failingAttestations.add(id);
      const joined = await Promise.allSettled([service.attestRide(1, id), service.attestRide(1, id)]);
      expect(joined.map((r) => r.status)).toEqual(['rejected', 'rejected']);
      payout.failingAttestations.delete(id);
      expect((await service.attestRide(1, id)).signature).toEqual(expect.any(String));
      expect(sent()).toHaveLength(1);
    });
  });
});
