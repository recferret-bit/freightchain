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
});
