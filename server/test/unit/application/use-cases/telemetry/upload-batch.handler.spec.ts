import { UploadBatchHandler } from '../../../../../src/application/use-cases/telemetry/upload-batch/upload-batch.handler.js';
import { UploadBatchCommand } from '../../../../../src/application/use-cases/telemetry/upload-batch/upload-batch.command.js';
import { BadRequestError, ConflictError, NotFoundError } from '../../../../../src/domain/shared/errors.js';
import { recording } from '../../../../support/recording.js';
import { unitContext } from '../../../../support/unit-context.js';

describe('UploadBatchHandler', () => {
  const setup = () => {
    const ctx = unitContext();
    const handler = new UploadBatchHandler(ctx.lookup, ctx.batches, ctx.hasher, ctx.verdicts, ctx.clock);
    return { ctx, up: (wallet: string, id: string, b: Parameters<typeof handler.execute>[0]['body']) => handler.execute(new UploadBatchCommand(wallet, id, b)) };
  };

  it('stores a chained recording while the ride runs; a re-sent seq is stored:false and changes nothing', async () => {
    const { ctx, up } = setup();
    const ride = await ctx.freeRide('w', true);
    const [b0, b1] = recording(ride.id, { seconds: 30 });
    expect(await up('w', ride.id, b0!)).toEqual({ seq: 0, stored: true, hashOk: true });
    expect(await up('w', ride.id, b1!)).toEqual({ seq: 1, stored: true, hashOk: true });
    expect(await up('w', ride.id, { ...b0!, samples: [] })).toEqual({ seq: 0, stored: false, hashOk: false });
    const stored = await ctx.batches.listByRide(ride.id);
    expect(stored.map((b) => [b.seq, b.body.samples.length])).toEqual([[0, 150], [1, 150]]);
  });

  it('a wrong or missing client hash is stored but marked hashOk:false (the verdict rejects the chain)', async () => {
    const { ctx, up } = setup();
    const ride = await ctx.freeRide('w', true);
    const [b0] = recording(ride.id, { seconds: 10 });
    expect(await up('w', ride.id, { ...b0!, hash: 'a'.repeat(64) })).toMatchObject({ stored: true, hashOk: false });
  });

  it('takes the final flush for a minute after the ride ended, then refuses; never for a ride that has not started', async () => {
    const { ctx, up } = setup();
    const ride = await ctx.freeRide('w', true);
    ctx.clock.advance(10);
    ride.finish('failed', 'crash', ctx.now());
    await ctx.rides.save(ride);
    const [b0] = recording(ride.id, { seconds: 10 });
    ctx.clock.advance(59);
    expect(await up('w', ride.id, b0!)).toMatchObject({ stored: true });
    ctx.clock.advance(2);
    await expect(up('w', ride.id, { ...b0!, seq: 1 })).rejects.toThrow(new ConflictError('ride is failed'));
    const unstarted = await ctx.freeRide('w');
    await expect(up('w', unstarted.id, b0!)).rejects.toThrow(new ConflictError('ride is created'));
  });

  it("someone else's ride is not found; a malformed batch is a 400", async () => {
    const { ctx, up } = setup();
    const ride = await ctx.freeRide('w', true);
    const [b0] = recording(ride.id, { seconds: 10 });
    await expect(up('intruder', ride.id, b0!)).rejects.toBeInstanceOf(NotFoundError);
    await expect(up('w', ride.id, { ...b0!, t1: -1 })).rejects.toBeInstanceOf(BadRequestError);
  });
});
