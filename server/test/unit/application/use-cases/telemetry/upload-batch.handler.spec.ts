import { UploadBatchHandler } from '../../../../../src/application/use-cases/telemetry/upload-batch/upload-batch.handler.js';
import { UploadBatchCommand } from '../../../../../src/application/use-cases/telemetry/upload-batch/upload-batch.command.js';
import { BadRequestError, ConflictError, NotFoundError } from '../../../../../src/domain/shared/errors.js';
import { recording } from '../../../../support/recording.js';
import { unitContext } from '../../../../support/unit-context.js';

describe('UploadBatchHandler', () => {
  const setup = () => {
    const ctx = unitContext();
    const handler = new UploadBatchHandler(ctx.lookup, ctx.batches, ctx.hasher, ctx.verdicts, ctx.clock, ctx.players, ctx.transactions);
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

  it('a ride cannot hold more recording than the wall time since its start allows (storage cap per ride)', async () => {
    const { ctx, up } = setup();
    const ride = await ctx.freeRide('w', true);
    const [b0] = recording(ride.id, { seconds: 120 }); // claims 15 s of game time right at the start: within the 30 s slack
    expect(await up('w', ride.id, b0!)).toMatchObject({ stored: true });
    const far = recording(ride.id, { seconds: 120 });
    await expect(up('w', ride.id, far[3]!)).rejects.toThrow(/more driving than time has passed/); // t1 = 60 s after 0 s of wall time
    await expect(up('w', ride.id, { ...b0!, seq: 11, prevHash: 'x' })).rejects.toThrow(/too many batches/); // seq 11 > 0 / 5 + 10
    ctx.clock.advance(60);
    expect(await up('w', ride.id, far[3]!)).toMatchObject({ stored: true });
  });

  it('a batch for a ride that already ended re-judges it (the final flush after /end)', async () => {
    const { ctx, up } = setup();
    const ride = await ctx.freeRide('w', true);
    const batches = recording(ride.id, { seconds: 20, distance: 140 });
    await up('w', ride.id, batches[0]!);
    ctx.clock.advance(20);
    ride.applyReport({ s: 140, t: 20, hull: 100, paused: false, route: null, night: false }, ctx.now(), ctx.rules.get());
    ride.finish('shift', null, ctx.now());
    await ctx.rides.save(ride);
    expect((await ctx.verdicts.judge(ride.id))?.status).not.toBe('verified');
    await up('w', ride.id, batches[1]!);
    expect((await ctx.verdictRepo.findByRide(ride.id))?.status).toBe('verified');
  });

  it("someone else's ride is not found; a malformed batch is a 400", async () => {
    const { ctx, up } = setup();
    const ride = await ctx.freeRide('w', true);
    const [b0] = recording(ride.id, { seconds: 10 });
    await expect(up('intruder', ride.id, b0!)).rejects.toBeInstanceOf(NotFoundError);
    await expect(up('w', ride.id, { ...b0!, t1: -1 })).rejects.toBeInstanceOf(BadRequestError);
  });
});
