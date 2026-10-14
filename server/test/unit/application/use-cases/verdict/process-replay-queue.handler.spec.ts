import { ProcessReplayQueueCommand } from '../../../../../src/application/use-cases/verdict/process-replay-queue/process-replay-queue.command.js';
import { ProcessReplayQueueHandler } from '../../../../../src/application/use-cases/verdict/process-replay-queue/process-replay-queue.handler.js';
import { Ride } from '../../../../../src/domain/rides/ride.entity.js';
import { RideStatus } from '../../../../../src/domain/rides/ride-status.js';
import { RoadPlan } from '../../../../../src/domain/road/road-plan.js';
import { RideBatch } from '../../../../../src/domain/telemetry/ride-batch.entity.js';
import { hashBatch, recording } from '../../../../support/recording.js';
import { unitContext } from '../../../../support/unit-context.js';

describe('ProcessReplayQueueHandler', () => {
  it('processes multiple queued ride sessions concurrently and persists RideReplay records', async () => {
    const ctx = unitContext();
    const rideIds: string[] = [];

    for (let i = 0; i < 3; i++) {
      const base = await ctx.freeRide(`W${i}`, true);
      const plan = RoadPlan.forSeed(base.seed, base.trip);
      const batches = recording(base.id, { seconds: 30, distance: 390, road: base.seed, trip: base.trip, replay: true });
      let prevRows: readonly (readonly number[])[] = [];
      for (const b of batches) {
        const accepted = RideBatch.accept(base.id, b, b.hash ?? hashBatch(b), ctx.now(), undefined, undefined, 0, plan, prevRows);
        await ctx.batches.insert(accepted);
        prevRows = b.samples;
      }
      const r = Ride.restore({
        ...base.snapshot(),
        status: RideStatus.Completed,
        lastS: 390,
        lastT: 30,
        driveSeconds: 30,
        hull: 100,
        endedAt: ctx.now(),
      });
      await ctx.rides.save(r);
      await ctx.verdicts.enqueueVerification(r.id);
      rideIds.push(r.id);
    }

    expect(await ctx.replayQueue.depth()).toBe(3);

    const handler = new ProcessReplayQueueHandler(ctx.verdicts);
    const out = await handler.execute(new ProcessReplayQueueCommand(16, 4));
    expect(out.processed).toBe(3);
    expect(out.verified).toBe(3);
    expect(out.failed).toBe(0);
    expect(await ctx.replayQueue.depth()).toBe(0);

    for (const id of rideIds) {
      const replays = await ctx.replayRepo.listByRide(id);
      expect(replays).toHaveLength(1);
      expect(replays[0]?.status).toBe('verified');
      expect(replays[0]?.simHz).toBe(10);
    }

    const singleOut = await handler.execute(new ProcessReplayQueueCommand(16, 4, rideIds[0]));
    expect(singleOut.processed).toBe(1);
    expect(await ctx.replayQueue.depth()).toBe(0);
  });
});
