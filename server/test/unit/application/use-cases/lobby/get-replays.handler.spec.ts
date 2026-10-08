import { GetReplaysHandler } from '../../../../../src/application/use-cases/lobby/get-replays/get-replays.handler.js';
import { GetReplaysQuery } from '../../../../../src/application/use-cases/lobby/get-replays/get-replays.query.js';
import { RideBatch } from '../../../../../src/domain/telemetry/ride-batch.entity.js';
import { hashBatch, recording } from '../../../../support/recording.js';
import { unitContext } from '../../../../support/unit-context.js';

describe('GetReplaysHandler', () => {
  it('ended rides newest first, paged by a stable cursor, filtered; the fail CODE (no reason text) and whether a replay exists', async () => {
    const ctx = unitContext();
    const handler = new GetReplaysHandler(ctx.rideQuery);
    const page = (before: { endedAt: Date; seq: bigint } | null, limit = 2, wallet: string | null = null, status: 'failed' | null = null) => handler.execute(new GetReplaysQuery(before, limit, wallet, status));
    const ended: string[] = [];
    for (const [w, outcome, reason] of [['a', 'shift', null], ['b', 'failed', 'You drove into a truck'], ['a', 'failed', 'heartbeat lost']] as const) {
      const r = await ctx.freeRide(w, true); ctx.clock.advance(10);
      r.finish(outcome, reason, ctx.now()); await ctx.rides.save(r); ended.push(r.id);
    }
    const running = await ctx.freeRide('c', true); void running;
    for (const b of recording(ended[0]!, { seconds: 10 })) await ctx.batches.insert(RideBatch.accept(ended[0]!, b, hashBatch(b), ctx.now()));
    const p1 = await page(null);
    expect(p1.rows.map((r) => [r.id, r.status, r.failCode])).toEqual([[ended[2], 'failed', 'heartbeat_lost'], [ended[1], 'failed', 'crash']]);
    expect(Object.keys(p1.rows[0]!)).not.toContain('reason');
    expect(p1.next).toMatch(/^\d+_\d+$/);
    const [ms, seq] = p1.next!.split('_');
    const p2 = await page({ endedAt: new Date(Number(ms)), seq: BigInt(seq!) });
    expect(p2).toMatchObject({ rows: [{ id: ended[0], status: 'abandoned', failCode: null, replay: true }], next: null });
    expect(p1.rows.every((r) => r.replay === false)).toBe(true);
    expect((await page(null, 10, 'a')).rows.map((r) => r.id)).toEqual([ended[2], ended[0]]);
    expect((await page(null, 10, null, 'failed')).rows).toHaveLength(2);
  });
});
