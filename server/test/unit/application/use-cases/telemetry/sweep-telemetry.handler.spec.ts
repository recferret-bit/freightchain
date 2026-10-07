import { SweepTelemetryHandler } from '../../../../../src/application/use-cases/telemetry/sweep-telemetry/sweep-telemetry.handler.js';
import { RideBatch } from '../../../../../src/domain/telemetry/ride-batch.entity.js';
import { RideVerdict } from '../../../../../src/domain/verdict/ride-verdict.entity.js';
import { VerdictStatus } from '../../../../../src/domain/verdict/verdict.dto.js';
import { hashBatch, recording } from '../../../../support/recording.js';
import { unitContext, unitRules, type UnitContext } from '../../../../support/unit-context.js';

/** a ride that ended now (or still runs), with its 2 batches stored and an optional verdict */
async function recordedRide(ctx: UnitContext, end: boolean, verdict?: VerdictStatus) {
  const ride = await ctx.freeRide('w', true);
  for (const b of recording(ride.id, { seconds: 20 })) await ctx.batches.insert(RideBatch.accept(ride.id, b, hashBatch(b), ctx.now()));
  if (end) { ride.finish('failed', 'x', ctx.now()); await ctx.rides.save(ride); }
  if (verdict) {
    await ctx.verdictRepo.save(RideVerdict.restore({ rideId: ride.id, status: verdict, reasons: [], rulesVersion: 1, judgedAt: ctx.now(), version: 1,
      scores: { recording: { batches: 2, samples: 0, inputs: 0, recordedSeconds: 0, coverage: 0, maxSpeed: 0 }, human: { presses: 0, minHoldCv: null, repeatShare: null, instantShare: null, timerStepMs: 0 } } }));
  }
  return ride;
}

describe('SweepTelemetryHandler', () => {
  it('deletes the recordings of rides that ended more than N days ago – not flagged ones, not recent ones, not running ones', async () => {
    const ctx = unitContext(unitRules({ telemetryRetentionDays: 30 }));
    const old = await recordedRide(ctx, true, VerdictStatus.Verified);
    const oldFlagged = await recordedRide(ctx, true, VerdictStatus.Flagged);
    const oldUnjudged = await recordedRide(ctx, true);
    ctx.clock.advance(20 * 86_400);
    const recent = await recordedRide(ctx, true, VerdictStatus.Rejected);
    const running = await recordedRide(ctx, false);
    ctx.clock.advance(11 * 86_400);
    const handler = new SweepTelemetryHandler(ctx.batches, ctx.rules, ctx.clock);
    expect(await handler.execute()).toEqual({ cutoff: ctx.clock.ms - 30 * 86_400_000, deleted: 4 });
    for (const [ride, kept] of [[old, 0], [oldUnjudged, 0], [oldFlagged, 2], [recent, 2], [running, 2]] as const) expect((await ctx.batches.listByRide(ride.id)).length).toBe(kept);
    expect(await handler.execute()).toMatchObject({ deleted: 0 }); // idempotent
    expect(await ctx.rides.findById(old.id)).not.toBeNull(); // the ride row stays
  });

  it('TELEMETRY_RETENTION_DAYS=0 keeps everything', async () => {
    const ctx = unitContext(unitRules({ telemetryRetentionDays: 0 }));
    await recordedRide(ctx, true);
    ctx.clock.advance(1000 * 86_400);
    expect(await new SweepTelemetryHandler(ctx.batches, ctx.rules, ctx.clock).execute()).toEqual({ cutoff: null, deleted: 0 });
    expect(ctx.db.batches.size).toBe(2);
  });
});
