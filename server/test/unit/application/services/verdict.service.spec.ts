import { Ride } from '../../../../src/domain/rides/ride.entity.js';
import { RideBatch } from '../../../../src/domain/telemetry/ride-batch.entity.js';
import { VerdictStatus } from '../../../../src/domain/verdict/verdict.dto.js';
import { hashBatch, recording } from '../../../support/recording.js';
import { unitContext } from '../../../support/unit-context.js';

describe('VerdictService', () => {
  /** a free ride driven 60 s / 840 m and ended as a complete shift, with or without its recording stored */
  async function ended(withRecording: boolean) {
    const ctx = unitContext();
    const ride = await ctx.freeRide('w', true);
    if (withRecording) for (const b of recording(ride.id, { seconds: 60, distance: 840 })) await ctx.batches.insert(RideBatch.accept(ride.id, b, hashBatch(b), ctx.now()));
    ctx.clock.advance(60);
    ride.applyReport({ s: 840, t: 60, hull: 100, paused: false, night: false }, ctx.now(), { hbTimeoutMs: 150_000, hbMinIntervalMs: 1000 });
    ride.finish('shift', null, ctx.now());
    await ctx.rides.save(ride);
    return { ctx, ride };
  }

  it('judges a completed shift from its stored recording and saves the verdict', async () => {
    const { ctx, ride } = await ended(true);
    const v = await ctx.verdicts.judge(ride.id);
    expect(v?.status).toBe(VerdictStatus.Verified);
    expect((await ctx.verdictRepo.findByRide(ride.id))?.snapshot()).toEqual(v?.snapshot());
    expect(ctx.db.honkMints.size).toBe(0); // a free ride mints no HONK
  });

  it('judging again re-reads the whole recording (a late batch turns "no recording" into a verdict on it)', async () => {
    const { ctx, ride } = await ended(false);
    expect((await ctx.verdicts.judge(ride.id))?.status).toBe(VerdictStatus.Rejected);
    for (const b of recording(ride.id, { seconds: 60, distance: 840 })) await ctx.batches.insert(RideBatch.accept(ride.id, b, hashBatch(b), ctx.now()));
    expect((await ctx.verdicts.judge(ride.id))?.status).toBe(VerdictStatus.Verified);
    expect((await ctx.verdictRepo.findByRide(ride.id))?.status).toBe(VerdictStatus.Verified);
  });

  it('only completed shifts are judged (a running, failed or missing ride gives null and stores nothing)', async () => {
    const ctx = unitContext();
    const running = await ctx.freeRide('w', true);
    expect(await ctx.verdicts.judge(running.id)).toBeNull();
    running.finish('failed', 'crash', ctx.now());
    await ctx.rides.save(running);
    expect(await ctx.verdicts.judge(running.id)).toBeNull();
    expect(await ctx.verdicts.judge('nope')).toBeNull();
    expect(ctx.db.verdicts.size).toBe(0);
  });

  it('rejudgeQuietly (the bulk re-judge): judges again, keeps an admin decision, and skips – not rejects – a ride whose recording was swept', async () => {
    const { ctx, ride } = await ended(true);
    expect(await ctx.verdicts.rejudgeQuietly(ride.id)).toEqual({ before: null, after: VerdictStatus.Verified });
    expect(await ctx.verdicts.rejudgeQuietly(ride.id)).toEqual({ before: VerdictStatus.Verified, after: VerdictStatus.Verified });
    await ctx.verdicts.override(ride.id, VerdictStatus.Rejected, 'admin', 'no', null);
    expect(await ctx.verdicts.rejudgeQuietly(ride.id)).toEqual({ before: VerdictStatus.Rejected, after: VerdictStatus.Rejected });
    const { ctx: c2, ride: r2 } = await ended(true);
    await c2.verdicts.judge(r2.id);
    for (const key of [...c2.db.batches.keys()]) c2.db.batches.delete(key);
    expect(await c2.verdicts.rejudgeQuietly(r2.id)).toBeNull();
    expect((await c2.verdictRepo.findByRide(r2.id))?.status).toBe(VerdictStatus.Verified);
    expect(await c2.verdicts.rejudgeQuietly('nope')).toBeNull();
  });

  const mark = { code: 'pool-shared-ip', detail: 'shares a network address', severity: 'flag' as const };

  it('addAttention: appends pool marks under the rider\'s lock (verified → flagged), saves nothing the second time, never over an admin\'s decision', async () => {
    const { ctx, ride } = await ended(true);
    await ctx.verdicts.judge(ride.id);
    expect(await ctx.verdicts.addAttention('w', [{ rideId: ride.id, reasons: [mark] }])).toEqual([{ rideId: ride.id, before: 'verified', after: 'flagged', added: ['pool-shared-ip'], skipped: null }]);
    const version = ctx.db.verdicts.get(ride.id)?.version;
    expect(await ctx.verdicts.addAttention('w', [{ rideId: ride.id, reasons: [mark] }])).toEqual([{ rideId: ride.id, before: 'flagged', after: 'flagged', added: [], skipped: null }]);
    expect(ctx.db.verdicts.get(ride.id)?.version).toBe(version);
    await ctx.verdicts.override(ride.id, VerdictStatus.Verified, 'admin', null, null);
    expect((await ctx.verdicts.addAttention('w', [{ rideId: ride.id, reasons: [{ ...mark, code: 'pool-distance-outlier' }] }]))[0]?.skipped).toBe('overridden');
    expect(await ctx.verdicts.addAttention('someone-else', [{ rideId: ride.id, reasons: [mark] }])).toEqual([{ rideId: ride.id, before: null, after: null, added: [], skipped: 'not-completed' }]);   // not that wallet's ride
  });

  it('judging again (a late batch, the bulk re-judge, an admin\'s RE-JUDGE) keeps the pool marks – they do not come from the recording', async () => {
    const { ctx, ride } = await ended(true);
    await ctx.verdicts.judge(ride.id);
    await ctx.verdicts.addAttention('w', [{ rideId: ride.id, reasons: [mark] }]);
    expect(await ctx.verdicts.judge(ride.id)).toMatchObject({ status: VerdictStatus.Flagged, reasons: [mark] });
    expect(await ctx.verdicts.rejudgeQuietly(ride.id)).toEqual({ before: VerdictStatus.Flagged, after: VerdictStatus.Flagged });
    await ctx.verdicts.override(ride.id, VerdictStatus.Verified, 'admin', null, null);
    expect((await ctx.verdicts.rejudge(ride.id, 'admin', null)).reasons).toEqual([mark]);   // clearing a mark is a decision (the override), not a re-run
  });

  it('a verified paid finish mints the checkpoint once; a reject mints nothing', async () => {
    const ctx = unitContext();
    await ctx.player('w');
    let ride = Ride.createPaidOrder({ id: 'paid-honk', wallet: 'w', tier: '1h', seed: 7, minSeconds: 60, timeScale: 60, priceUsd: 5, lamports: 1, solUsd: 100, now: ctx.now(), quoteTtlMs: 60_000 });
    await ctx.rides.insert(ride);
    ride.markPaid(1, ctx.now());
    ride.start(ctx.now());
    ride = await ctx.rides.save(ride);
    ctx.clock.advance(60);
    ride = await ctx.reload(ride.id);
    ride.applyReport({ s: 840, t: 60, hull: 100, paused: false, night: false }, ctx.now(), { hbTimeoutMs: 150_000, hbMinIntervalMs: 1000 });
    ride.finish('shift', null, ctx.now());
    await ctx.rides.save(ride);
    expect((await ctx.verdicts.judge(ride.id))?.status).toBe(VerdictStatus.Rejected); // no recording
    expect(await ctx.honkRepo.findMint(ride.id)).toBeNull();
    for (const b of recording(ride.id, { seconds: 60, distance: 840 })) await ctx.batches.insert(RideBatch.accept(ride.id, b, hashBatch(b), ctx.now()));
    expect((await ctx.verdicts.judge(ride.id))?.status).toBe(VerdictStatus.Verified);
    expect(await ctx.honkRepo.balance('w')).toBe(100_000_000n);
    expect((await ctx.honkRepo.findMint(ride.id))?.band100).toBe(true);
    await ctx.verdicts.judge(ride.id);
    expect(await ctx.honkRepo.balance('w')).toBe(100_000_000n);
    expect(ctx.db.honkMints.size).toBe(1);
  });
});
