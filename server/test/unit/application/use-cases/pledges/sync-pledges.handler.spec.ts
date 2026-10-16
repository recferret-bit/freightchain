import { describe, expect, it } from 'vitest';
import { SyncPledgesHandler } from '../../../../../src/application/use-cases/pledges/sync-pledges/sync-pledges.handler.js';
import { ATTESTATION_FLAGGED, ATTESTATION_UNVERIFIED, ATTESTATION_VERIFIED } from '../../../../../src/application/ports/economy/pool-payout-chain.port.js';
import { SETTLE_GRACE_MS } from '../../../../../src/domain/economy/pool-crank.js';
import type { Pledge } from '../../../../../src/domain/economy/pledge.entity.js';
import type { PoolProps } from '../../../../../src/domain/economy/pool.types.js';
import { Ride } from '../../../../../src/domain/rides/ride.entity.js';
import { RideStatus } from '../../../../../src/domain/rides/ride-status.js';
import { RideBatch } from '../../../../../src/domain/telemetry/ride-batch.entity.js';
import { RideVerdict } from '../../../../../src/domain/verdict/ride-verdict.entity.js';
import { VerdictStatus } from '../../../../../src/domain/verdict/verdict.dto.js';
import { AttestationService } from '../../../../../src/application/services/attestation.service.js';
import { FakePoolPayoutChain } from '../../../../support/fake-pool-payout-chain.js';
import { aPool, chainPool } from '../../../../support/pools.js';
import { aPledge, wallet } from '../../../../support/pledges.js';
import { hashBatch } from '../../../../support/recording.js';
import { unitContext } from '../../../../support/unit-context.js';

const KEY = 'Payout11111111111111111111111111111111111111';

describe('SyncPledgesHandler – the pledge job', () => {
  const setup = async (pool: Partial<PoolProps> = { status: 'active' }) => {
    const ctx = unitContext();
    const sponsor = wallet(), driver = wallet();
    await ctx.player(sponsor); await ctx.player(driver);
    await ctx.pools.upsert(aPool({ id: 1, ...pool }, ctx.now()));
    const payout = new FakePoolPayoutChain(ctx.poolChain);
    payout.payoutAddress = KEY;
    const handler = new SyncPledgesHandler(ctx.pledges, ctx.poolChain, payout, ctx.pools, ctx.players, ctx.transactions, ctx.clock,
      new AttestationService(payout, ctx.rides, ctx.verdictRepo, ctx.batches, ctx.pools, ctx.hasher, ctx.clock));
    const row = async (id: string) => (await ctx.pledges.findById(id))!;
    /** an active pledge: on chain and mirrored (its ride is not driven yet: nothing to end) */
    const active = async (o: { sponsor?: string; lamportsPerKm?: bigint; targetKm?: number } = {}) => {
      const { pledge } = await aPledge(ctx, { sponsor: o.sponsor ?? sponsor, driver, onChain: true, lamportsPerKm: o.lamportsPerKm, targetKm: o.targetKm });
      await handler.execute();
      expect((await row(pledge.id)).status).toBe('active');
      return pledge;
    };
    /** the pledged ride itself (id = the pledge's rideId), completed in pool 1 with one recorded batch and its verdict ('none' = never judged) */
    const drive = async (p: Pledge, metres: number, verdict: 'verified' | 'flagged' | 'rejected' | 'none' = 'verified', o: { by?: string; endedAt?: Date } = {}) => {
      const r = Ride.createFromTicket({ id: p.rideId, wallet: o.by ?? driver, tier: '1h', seed: 1, minSeconds: 3600, timeScale: 1, poolId: 1, roundId: 1, now: ctx.now() });
      await ctx.rides.insert(Ride.restore({ ...r.snapshot(), status: RideStatus.Completed, lastS: metres, endedAt: o.endedAt ?? ctx.now() }));
      const raw = { seq: 0, prevHash: r.id, t0: 0, t1: 10, samples: [[0, 0, 0, 30, 0, 800, 1, 100, 0, 0, 0, 0]], inputs: [] };
      const b = { ...raw, hash: hashBatch(raw) };
      await ctx.batches.insert(RideBatch.accept(r.id, b, b.hash, ctx.now()));
      if (verdict === 'none') return;
      const status = verdict === 'verified' ? VerdictStatus.Verified : verdict === 'flagged' ? VerdictStatus.Flagged : VerdictStatus.Rejected;
      await ctx.verdictRepo.save(RideVerdict.restore({
        rideId: r.id, status, reasons: status === VerdictStatus.Verified ? [] : [{ code: 'test', detail: 'test', severity: status === VerdictStatus.Rejected ? 'reject' : 'flag' }],
        scores: {} as never, rulesVersion: 4, judgedAt: ctx.now(), version: 1,
      }));
    };
    /** what the chain already holds for the pledge's ride (an earlier pass, or another sender) */
    const attest = (p: Pledge, status: number, verifiedKm: number, o: { by?: string; settledPledges?: number } = {}) =>
      payout.attestations.set(`1:${p.rideId}`, { driver: o.by ?? driver, status, verifiedKm, settleFrom: new Date(0), settledPledges: o.settledPledges ?? 0, telemetryRoot: new Uint8Array(32) });
    const revoke = async (p: Pledge) => {
      const v = (await ctx.verdictRepo.findByRide(p.rideId))!;
      v.override(VerdictStatus.Rejected, 'Admin', null, ctx.now());
      await ctx.verdictRepo.save(v);
    };
    /** the chain clock just past the pool's settle grace: an active pool counts as over */
    const pastGrace = async () => { payout.now = new Date((await ctx.pools.findById(1))!.payoutAt.getTime() + SETTLE_GRACE_MS + 1000); };
    return { ctx, sponsor, driver, payout, run: () => handler.execute(), row, active, drive, attest, revoke, pastGrace };
  };

  it('a pending pledge whose create_pledge landed (nobody confirmed) turns active from its account\'s history', async () => {
    const { ctx, sponsor, driver, run, row, payout } = await setup();
    const { pledge, createSig } = await aPledge(ctx, { sponsor, driver, onChain: true });
    expect(await run()).toMatchObject({ sending: true, checked: 1, activated: 1, errors: [] });
    expect(await row(pledge.id)).toMatchObject({ props: expect.objectContaining({ status: 'active', createSignature: createSig }) });
    expect(payout.calls).toEqual([]); // the pool still runs and the ride is not driven: nothing to end
  });

  it('a pending pledge never signed: kept for an hour, then abandoned', async () => {
    const { ctx, sponsor, driver, run, row } = await setup();
    const { pledge } = await aPledge(ctx, { sponsor, driver });
    ctx.clock.advance(59 * 60);
    await run();
    expect((await row(pledge.id)).status).toBe('pending');
    ctx.clock.advance(2 * 60);
    expect(await run()).toMatchObject({ abandoned: 1 });
    expect((await row(pledge.id)).status).toBe('abandoned');
    expect((await run()).checked).toBe(0); // no longer open
  });

  it('a VERIFIED ride: attested on chain, then settle_pledge pays max × min(km, target) / target and the row records the program\'s numbers', async () => {
    const { sponsor, run, row, active, drive, payout } = await setup();
    const p = await active({ lamportsPerKm: 3n, targetKm: 7 });
    await drive(p, 2_300);
    expect(await run()).toMatchObject({ settled: 1 });
    expect(payout.calls).toEqual([`attest 1 ${p.rideId} ${ATTESTATION_VERIFIED}`, `settle ${p.rideId} ${sponsor}`]);
    expect(await row(p.id)).toMatchObject({ status: 'settled', isSettled: true, earnedLamports: 6n, refundedLamports: 15n });
    expect((await run()).checked).toBe(0);
  });

  it('a REJECTED ride: attested FLAGGED, settled with nothing earned, the whole cap back to the sponsor', async () => {
    const { run, row, active, drive, payout } = await setup();
    const p = await active();
    await drive(p, 9_000, 'rejected');
    await run();
    expect(payout.calls[0]).toBe(`attest 1 ${p.rideId} ${ATTESTATION_FLAGGED}`);
    expect(await row(p.id)).toMatchObject({ status: 'settled', earnedLamports: 0n, refundedLamports: p.maxLamports });
  });

  it('two rides of one driver in one pool: each pledge settles on ITS ride\'s km, never on the driver\'s best ride (audit H4)', async () => {
    const { run, row, active, drive, payout } = await setup();
    const short = await active({ lamportsPerKm: 1_000n, targetKm: 20 });
    const long = await active({ sponsor: wallet(), lamportsPerKm: 1_000n, targetKm: 20 });
    await drive(short, 3_900);
    await drive(long, 12_200);
    expect(await run()).toMatchObject({ settled: 2 });
    expect(payout.attestations.get(`1:${short.rideId}`)).toMatchObject({ verifiedKm: 3 });
    expect(payout.attestations.get(`1:${long.rideId}`)).toMatchObject({ verifiedKm: 12 });
    expect(await row(short.id)).toMatchObject({ status: 'settled', earnedLamports: 3_000n, refundedLamports: 17_000n });
    expect(await row(long.id)).toMatchObject({ status: 'settled', earnedLamports: 12_000n, refundedLamports: 8_000n });
  });

  for (const [name, pool] of [
    ['failed (refunding)', { status: 'refunding' }],
    ['cancelled', { status: 'cancelled' }],
    ['closed (settled)', { status: 'settled' }],
    ['active past its settle grace', { status: 'active' }],
  ] as [string, Partial<PoolProps>][]) {
    it(`a pool that is over – ${name} – and the ride never driven: refund_pledge gives everything back`, async () => {
      const { ctx, run, row, active, payout, pastGrace } = await setup();
      const p = await active();
      await ctx.pools.upsert(aPool({ id: 1, ...pool }, ctx.now()));
      if (pool.status === 'active') await pastGrace();
      expect(await run()).toMatchObject({ refunded: 1 });
      expect(payout.calls).toEqual([`refund ${p.rideId} ${p.sponsor}`]);
      expect(await row(p.id)).toMatchObject({ status: 'refunded', earnedLamports: 0n, refundedLamports: p.maxLamports });
    });
  }

  it('a ride that ended after the play deadline counts for nothing (H6): not attested, its pledge refunded once the pool is over', async () => {
    const { ctx, run, row, active, drive, payout, pastGrace } = await setup();
    const p = await active();
    await drive(p, 9_000, 'verified', { endedAt: new Date((await ctx.pools.findById(1))!.playDeadline.getTime() + 1) });
    await run();
    expect(payout.calls).toEqual([]);
    expect((await row(p.id)).status).toBe('active');
    await pastGrace();
    expect(await run()).toMatchObject({ refunded: 1 });
    expect(payout.calls).toEqual([`refund ${p.rideId} ${p.sponsor}`]);
  });

  it('a decided attestation settles only from its settleFrom by the chain clock (the review lock, L5)', async () => {
    const { ctx, sponsor, run, row, active, drive, payout } = await setup();
    const chain = chainPool(ctx.now(), { poolId: 1, status: 'active' });
    ctx.poolChain.pools.set(1, chain);   // the fake's settleFrom = the pool's payout_at
    payout.now = ctx.now();
    const p = await active();
    await drive(p, 5_000);
    await run();
    expect(payout.calls).toEqual([`attest 1 ${p.rideId} ${ATTESTATION_VERIFIED}`]);
    expect(payout.attestations.get(`1:${p.rideId}`)!.settleFrom).toEqual(chain.payoutAt);
    payout.now = new Date(chain.payoutAt.getTime() - 1000);
    await run();
    expect(payout.calls).toHaveLength(1);   // not rewritten, not settled
    expect((await row(p.id)).status).toBe('active');
    payout.now = chain.payoutAt;
    expect(await run()).toMatchObject({ settled: 1 });
    expect(payout.calls.slice(1)).toEqual([`settle ${p.rideId} ${sponsor}`]);
  });

  it('an attestation naming another driver than the pledge\'s is never settled on: the pledge is refunded once the pool is over', async () => {
    const { run, row, active, drive, payout, pastGrace } = await setup();
    const p = await active();
    await drive(p, 9_000, 'verified', { by: wallet() });
    await run();
    expect(payout.calls).toEqual([`attest 1 ${p.rideId} ${ATTESTATION_VERIFIED}`]);   // the ride's own driver
    expect((await row(p.id)).status).toBe('active');
    await pastGrace();
    expect(await run()).toMatchObject({ settled: 0, refunded: 1 });
    expect(payout.calls.slice(1)).toEqual([`refund ${p.rideId} ${p.sponsor}`]);
    expect(await row(p.id)).toMatchObject({ status: 'refunded', refundedLamports: p.maxLamports });
  });

  it('money the admin has not released waits: a held pool, one with rides under review, one stopped in error – nothing is attested or settled (WP2 review)', async () => {
    for (const pool of [{ status: 'active' as const, hold: { by: 'Admin', at: new Date(0), note: 'wait' } }, { status: 'active' as const, payoutState: 'waiting_review' as const }, { status: 'active' as const, payoutState: 'error' as const }]) {
      const { run, row, active, drive, payout } = await setup(pool);
      const p = await active();
      await drive(p, 9_000);
      await run();
      expect(payout.calls).toEqual([]);
      expect((await row(p.id)).status).toBe('active');
    }
  });

  it('a VERIFIED ride whose verdict was revoked during the review lock is written FLAGGED before the settle – the sponsor gets it all back (audit M7)', async () => {
    const { ctx, run, row, active, drive, revoke, payout } = await setup();
    const chain = chainPool(ctx.now(), { poolId: 1, status: 'active' });
    ctx.poolChain.pools.set(1, chain);
    payout.now = ctx.now();
    const p = await active({ lamportsPerKm: 3n, targetKm: 7 });
    await drive(p, 2_000);
    await run();
    expect(payout.calls).toEqual([`attest 1 ${p.rideId} ${ATTESTATION_VERIFIED}`]);   // locked until payout_at
    await revoke(p);
    payout.now = chain.payoutAt;
    await run();
    expect(payout.calls.slice(1)).toEqual([`attest 1 ${p.rideId} ${ATTESTATION_FLAGGED}`, `settle ${p.rideId} ${p.sponsor}`]);
    expect(await row(p.id)).toMatchObject({ status: 'settled', earnedLamports: 0n, refundedLamports: p.maxLamports });
  });

  it('an attestation already settled on is FINAL: a later revoke rewrites nothing and the next pledge settles on the chain\'s km', async () => {
    const { run, row, active, drive, attest, revoke, payout } = await setup();
    const p = await active({ lamportsPerKm: 1_000n, targetKm: 10 });
    await drive(p, 4_000);
    attest(p, ATTESTATION_VERIFIED, 4, { settledPledges: 1 });
    await revoke(p);
    await run();
    expect(payout.calls).toEqual([`settle ${p.rideId} ${p.sponsor}`]);
    expect(await row(p.id)).toMatchObject({ status: 'settled', earnedLamports: 4_000n });
  });

  it('the pool still running and the ride undecided (flagged, never judged) – also with an UNVERIFIED attestation on chain: nothing is sent', async () => {
    const { run, row, active, drive, attest, payout } = await setup({ status: 'active' });
    const flagged = await active(), unjudged = await active({ sponsor: wallet() });
    await drive(flagged, 9_000, 'flagged');
    await drive(unjudged, 9_000, 'none');
    attest(flagged, ATTESTATION_UNVERIFIED, 0);
    await run();
    expect(payout.calls).toEqual([]);
    expect((await row(flagged.id)).status).toBe('active');
    expect((await row(unjudged.id)).status).toBe('active');
  });

  it('without the payout key it only follows the chain – a refund the sponsor sent itself is still mirrored', async () => {
    const { ctx, sponsor, driver, run, row, active, drive, attest, payout } = await setup({ status: 'settled' });
    payout.payoutAddress = null;
    const p = await active();
    await drive(p, 5_000);
    attest(p, ATTESTATION_VERIFIED, 5);
    expect(await run()).toMatchObject({ sending: false, settled: 0 });
    expect(payout.calls).toEqual([]);
    expect((await row(p.id)).status).toBe('active');
    ctx.poolChain.addPledgeTransaction([{ kind: 'PledgeRefunded', rideId: p.rideId, sponsor, driver, pool: 'pool1', refundedLamports: p.maxLamports }]);
    await run();
    expect((await row(p.id)).status).toBe('refunded');
  });

  it('an RPC error on one pledge is noted; the others go on', async () => {
    const { ctx, run, row, active, drive } = await setup();
    const broken = await active({ sponsor: wallet() });
    const fine = await active();
    await drive(broken, 10_000);
    await drive(fine, 10_000);
    ctx.poolChain.failingPledgePdas.add(broken.pdaAddress);
    const pass = await run();
    expect(pass.errors).toEqual([{ pledgeId: broken.id, note: expect.stringMatching(/unavailable/) }]);
    expect(pass.settled).toBe(1);
    expect((await row(fine.id)).status).toBe('settled');
    expect((await row(broken.id)).status).toBe('active');
    ctx.poolChain.failingPledgePdas.clear();
    await run();
    expect((await row(broken.id)).status).toBe('settled');
  });

  it('a settle another sender got in first: the row follows the chain, nothing is attested or paid twice', async () => {
    const { ctx, sponsor, driver, run, row, active, drive, payout } = await setup();
    const p = await active({ lamportsPerKm: 1_000n, targetKm: 10 });
    await drive(p, 4_000);
    ctx.poolChain.addPledgeTransaction([{ kind: 'PledgeSettled', rideId: p.rideId, sponsor, driver, pool: 'pool1', verifiedKm: 4, earnedLamports: 4_000n, refundedLamports: 6_000n }]);
    await run();
    expect(payout.calls).toEqual([]);
    expect(await row(p.id)).toMatchObject({ status: 'settled', earnedLamports: 4_000n });
  });
});
