import { Logger } from '@nestjs/common';
import { SweepTelemetryHandler } from '../../../../../src/application/use-cases/telemetry/sweep-telemetry/sweep-telemetry.handler.js';
import { RideBatch } from '../../../../../src/domain/telemetry/ride-batch.entity.js';
import { RideVerdict } from '../../../../../src/domain/verdict/ride-verdict.entity.js';
import { VerdictStatus } from '../../../../../src/domain/verdict/verdict.dto.js';
import { hashBatch, recording } from '../../../../support/recording.js';
import { unitContext, unitRules, type UnitContext } from '../../../../support/unit-context.js';

/** a ride that ended now (or still runs), with its 2 batches stored and an optional verdict; `completed` ends it as a complete shift instead of a crash */
async function recordedRide(ctx: UnitContext, end: boolean, verdict?: VerdictStatus, completed = false) {
  const ride = await ctx.freeRide('w', true);
  for (const b of recording(ride.id, { seconds: 20 })) await ctx.batches.insert(RideBatch.accept(ride.id, b, hashBatch(b), ctx.now()));
  if (end && completed) { const { Ride } = await import('../../../../../src/domain/rides/ride.entity.js'); await ctx.rides.save(Ride.restore({ ...ride.snapshot(), status: 'completed' as never, endedAt: ctx.now() })); }
  else if (end) { ride.finish('failed', 'x', ctx.now()); await ctx.rides.save(ride); }
  if (verdict) {
    await ctx.verdictRepo.save(RideVerdict.restore({ rideId: ride.id, status: verdict, reasons: [], rulesVersion: 1, judgedAt: ctx.now(), version: 1,
      scores: { recording: { batches: 2, samples: 0, inputs: 0, recordedSeconds: 0, coverage: 0, maxSpeed: 0, unhashed: 0 }, human: { presses: 0, minHoldCv: null, repeatShare: null, instantShare: null, timerStepMs: 0 }, challenges: { issued: 0, answered: 0, missed: 0, tooFast: 0, medianReactionMs: null } } }));
  }
  return ride;
}

describe('SweepTelemetryHandler', () => {
  it('deletes the recordings of rides that ended more than N days ago – not flagged ones, not recent ones, not running ones', async () => {
    const ctx = unitContext(unitRules({ telemetryRetentionDays: 30 }));
    const old = await recordedRide(ctx, true, VerdictStatus.Verified);
    const oldFlagged = await recordedRide(ctx, true, VerdictStatus.Flagged);
    const oldUnjudged = await recordedRide(ctx, true);
    const oldCompletedUnjudged = await recordedRide(ctx, true, undefined, true); // judging failed after /end: JUDGE NOW still needs the recording
    ctx.clock.advance(20 * 86_400);
    const recent = await recordedRide(ctx, true, VerdictStatus.Rejected);
    const running = await recordedRide(ctx, false);
    ctx.clock.advance(11 * 86_400);
    const handler = new SweepTelemetryHandler(ctx.batches, ctx.rules, ctx.clock);
    expect(await handler.execute()).toEqual({ cutoff: ctx.clock.ms - 30 * 86_400_000, deleted: 4 });
    for (const [ride, kept] of [[old, 0], [oldUnjudged, 0], [oldFlagged, 2], [oldCompletedUnjudged, 2], [recent, 2], [running, 2]] as const) expect((await ctx.batches.listByRide(ride.id)).length).toBe(kept);
    expect(await handler.execute()).toMatchObject({ deleted: 0 }); // idempotent
    expect(await ctx.rides.findById(old.id)).not.toBeNull(); // the ride row stays
  });

  it('nulls raw inp only after the pool is paid and 90 days, and alerts a similar pair before validation closes', async () => {
    const ctx = unitContext(unitRules({ telemetryRetentionDays: 30 }));
    const now = ctx.now();
    ctx.batches.retention.push(
      { rideId: 'old', inpAt: new Date(now.getTime() - 91 * 86_400_000), payoutFinalizedAt: new Date(now.getTime() - 1000) },
      { rideId: 'young', inpAt: now, payoutFinalizedAt: new Date(now.getTime() - 1000) },
      { rideId: 'unpaid', inpAt: new Date(now.getTime() - 91 * 86_400_000), payoutFinalizedAt: null },
    );
    ctx.batches.traces.push(
      { rideId: 'a', wallet: 'a', intervalsMs: Array.from({ length: 60 }, () => 100) },
      { rideId: 'b', wallet: 'b', intervalsMs: Array.from({ length: 60 }, () => 100) },
    );
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    await new SweepTelemetryHandler(ctx.batches, ctx.rules, ctx.clock).execute();
    expect(ctx.batches.nulled).toEqual(['old']);
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ code: 'trace-cluster' }));
    warn.mockRestore();
  });

  it('flags both rides in a similar top-20 pair for admin review', async () => {
    const ctx = unitContext(unitRules({ telemetryRetentionDays: 30 }));
    const scores = { recording: { batches: 1, samples: 0, inputs: 0, recordedSeconds: 0, coverage: 0, maxSpeed: 0, unhashed: 0 }, human: { presses: 0, minHoldCv: null, repeatShare: null, instantShare: null, timerStepMs: 0 }, challenges: { issued: 0, answered: 0, missed: 0, tooFast: 0, medianReactionMs: null } };
    for (const rideId of ['a', 'b']) {
      await ctx.verdictRepo.save(RideVerdict.restore({ rideId, status: VerdictStatus.Verified, reasons: [], rulesVersion: 1, judgedAt: ctx.now(), version: 1, scores }));
    }
    ctx.batches.traces.push(
      { rideId: 'a', wallet: 'a', intervalsMs: Array.from({ length: 60 }, () => 100), distance: 900 },
      { rideId: 'b', wallet: 'b', intervalsMs: Array.from({ length: 60 }, () => 100), distance: 800 },
      { rideId: 'z', wallet: 'z', intervalsMs: Array.from({ length: 60 }, () => 1), distance: 1 },
    );
    await new SweepTelemetryHandler(ctx.batches, ctx.rules, ctx.clock, ctx.verdictRepo).execute();
    for (const rideId of ['a', 'b']) {
      const verdict = await ctx.verdictRepo.findByRide(rideId);
      expect(verdict?.status).toBe(VerdictStatus.Flagged);
      expect(verdict?.reasons.some((reason) => reason.code === 'trace-cluster' && reason.severity === 'flag')).toBe(true);
    }
    expect((await ctx.verdictRepo.findByRide('z'))).toBeNull();
  });

  it('TELEMETRY_RETENTION_DAYS=0 keeps everything', async () => {
    const ctx = unitContext(unitRules({ telemetryRetentionDays: 0 }));
    await recordedRide(ctx, true);
    ctx.clock.advance(1000 * 86_400);
    expect(await new SweepTelemetryHandler(ctx.batches, ctx.rules, ctx.clock).execute()).toEqual({ cutoff: null, deleted: 0 });
    expect(ctx.db.batches.size).toBe(2);
  });
});
