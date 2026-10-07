import { RideBatch } from '../../src/domain/telemetry/ride-batch.entity.js';
import { hashBatch, recording, type RecordingOptions } from './recording.js';
import type { UnitContext } from './unit-context.js';

/** A free ride of `wallet` driven `seconds` to `distance` m and ended as a complete shift, with its recording stored, then judged by the real VerdictService. */
export async function judgedRide(ctx: UnitContext, wallet: string, rec: Partial<RecordingOptions> | null = {}, seconds = 60, distance = 840) {
  const ride = await ctx.freeRide(wallet, true);
  if (rec) for (const b of recording(ride.id, { seconds, distance, ...rec })) await ctx.batches.insert(RideBatch.accept(ride.id, b, hashBatch(b), ctx.now()));
  for (let t = 10; t <= seconds; t += 10) {   // a heartbeat every 10 s, like the game (a gap > 150 s would fail the ride)
    ctx.clock.advance(10);
    ride.applyReport({ s: (distance * t) / seconds, t, hull: 100, paused: false, route: null, night: false }, ctx.now(), { hbTimeoutMs: 150_000, hbMinIntervalMs: 1000 });
  }
  ride.finish('shift', null, ctx.now());
  await ctx.rides.save(ride);
  const verdict = await ctx.verdicts.judge(ride.id);
  return { ride: await ctx.reload(ride.id), verdict };
}
