import { createRequire } from 'node:module';
const { deflateRawSync, inflateRawSync } = createRequire(import.meta.url)('node:zlib') as typeof import('node:zlib');
import { UploadBatchHandler } from '../../../../../src/application/use-cases/telemetry/upload-batch/upload-batch.handler.js';
import { STREAMS_COMPRESSED_MAX, STREAMS_UNCOMPRESSED_MAX } from '../../../../../src/application/telemetry/batch-streams.js';
import { UploadBatchCommand } from '../../../../../src/application/use-cases/telemetry/upload-batch/upload-batch.command.js';
import { BadRequestError, ConflictError, NotFoundError } from '../../../../../src/domain/shared/errors.js';
import { checkpointMetres, serverWorldDigest } from '../../../../../src/application/telemetry/enforce-resim.js';
import { revealRideSalts } from '../../../../../src/application/rides/ride-salts.js';
import { WORLD_DIGEST_WINDOW_M, spawnedWorldIds } from '../../../../../src/application/telemetry/spawned-world.js';
import { roadPlanFor } from '../../../../../src/domain/road/road-plan.js';
import { TrafficSimulator } from '../../../../../src/domain/verdict/traffic-sim.js';
import { batchMacGenesisMessage, batchMacMessage, enforceBatchMacMessage, worldDigest32 } from '../../../../../src/domain/shared/index.js';
import { RideBatch, type BatchBody } from '../../../../../src/domain/telemetry/ride-batch.entity.js';
import { recording, type TestHasher } from '../../../../support/recording.js';
import { RoadPlan } from '../../../../../src/domain/road/road-plan.js';
import { unitContext } from '../../../../support/unit-context.js';

describe('UploadBatchHandler', () => {
  const setup = () => {
    const ctx = unitContext();
    const handler = new UploadBatchHandler(ctx.lookup, ctx.batches, ctx.hasher, ctx.verdicts, ctx.clock, ctx.players, ctx.transactions, { inflateRaw: (data: Buffer) => inflateRawSync(data) });
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

  it('measures every batch against the SERVER\'s road on arrival – the ride\'s seed, never anything the client says (hole passes, off-road, gas)', async () => {
    const { ctx, up } = setup();
    const ride = await ctx.freeRide('w', true);
    ctx.clock.advance(200);
    for (const b of recording(ride.id, { seconds: 200, distance: 6000 })) await up('w', ride.id, b);   // past the free run's first holes (road-rules.ts TRIP_HOLE_FIRST)
    const stored = await ctx.batches.listByRide(ride.id);
    expect(stored.every((b) => b.summary.world !== null)).toBe(true);
    const planned = RoadPlan.forSeed(ride.seed, ride.trip).holesBetween(0, 6000).filter((h) => h.s < 5980);
    const met = new Set(stored.flatMap((b) => b.summary.world!.holes.map((p) => p.hole)));
    expect(planned.length).toBeGreaterThan(0);
    for (const h of planned) expect(met.has(h.id), h.id).toBe(true); // every planned hole the drive went past is in the measurement
    expect(stored.flatMap((b) => b.summary.world!.holes).filter((p) => p.edge)).toEqual([]); // uploaded in order: a pass across a cut is measured with the batch before
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
    for (const b of far.slice(1, 4)) expect(await up('w', ride.id, b)).toMatchObject({ stored: true });
  });

  it('an empty batch (the flush right after a cut) never cuts the tail the next batch is measured with; two empty batches in a row are refused', async () => {
    const { ctx, up } = setup();
    const ride = await ctx.freeRide('w', true);
    ctx.clock.advance(120);
    const [b0, b1, b2] = recording(ride.id, { seconds: 45 });
    const empty = { ...b1!, samples: [], t1: b1!.t0 };
    await up('w', ride.id, b0!);
    expect(await up('w', ride.id, empty)).toMatchObject({ stored: true });
    await expect(up('w', ride.id, { ...b2!, seq: 2, samples: [] })).rejects.toThrow(/two empty batches in a row/);
    expect(await up('w', ride.id, { ...b2!, seq: 2 })).toMatchObject({ stored: true });
    const stored = await ctx.batches.listByRide(ride.id);
    const { summariseBatch } = await import('../../../../../src/domain/telemetry/batch-summary.js');
    const { roadPlanFor } = await import('../../../../../src/domain/road/road-plan.js');
    expect(stored[2]!.summary.world).toEqual(summariseBatch(2, b2!.t0, b2!.t1, b2!.samples, b2!.inputs, roadPlanFor(ride.seed, ride.trip), b0!.samples).world);   // measured with batch 0's tail
  });

  it('takes the batches in order: batch n+1 waits (429, the game retries) until batch n is stored – a pass on the cut is always measured (audit M10)', async () => {
    const { ctx, up } = setup();
    const ride = await ctx.freeRide('w', true);
    ctx.clock.advance(60);
    const batches = recording(ride.id, { seconds: 45 });
    await expect(up('w', ride.id, batches[1]!)).rejects.toMatchObject({ statusCode: 429, errorCode: 'batch_out_of_order' });
    expect(await up('w', ride.id, batches[0]!)).toMatchObject({ stored: true });
    expect(await up('w', ride.id, batches[1]!)).toMatchObject({ stored: true });
    expect(await up('w', ride.id, batches[0]!)).toMatchObject({ stored: false });   // a re-send is still harmless
  });

  it('a batch for a ride that already ended re-judges it (the final flush after /end)', async () => {
    const { ctx, up } = setup();
    const ride = await ctx.freeRide('w', true);
    const batches = recording(ride.id, { seconds: 20, distance: 140 });
    await up('w', ride.id, batches[0]!);
    ctx.clock.advance(20);
    ride.applyReport({ s: 140, t: 20, hull: 100, paused: false, night: false }, ctx.now(), ctx.rules.get());
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

  it('a ride cannot hold more recording BYTES than the time since its start allows (a hostile client streaming junk)', async () => {
    const { ctx, up } = setup();
    const ride = await ctx.freeRide('w', true);
    ctx.clock.advance(1);
    const fat = (seq: number): Parameters<typeof up>[2] => ({ seq, prevHash: seq === 0 ? ride.id : `unhashed-${seq - 1}`, t0: 0, t1: 1, samples: [[0.5, 0, 2.4, 0, 0, 900, 1, 100, 0, 0, 0, 0]], inputs: Array.from({ length: 2000 }, (_, i) => [i, 'KeyW', (i % 2) as 0 | 1]), hash: null });   // one sample: two EMPTY batches in a row are refused before the budget
    let refused: unknown = null, stored = 0;
    for (let seq = 0; seq < 20 && !refused; seq++) await up('w', ride.id, fat(seq)).then(() => stored++, (e: unknown) => { refused = e; });
    expect(refused).toBeInstanceOf(BadRequestError);
    expect((refused as Error).message).toMatch(/larger than the time since the start allows/);
    expect(stored).toBeGreaterThan(3);
    expect(await ctx.batches.totalBytes(ride.id)).toBeLessThanOrEqual(ride.recordingAllowance(ctx.now()).maxBytes);
  });

  it('checks a protocol-2 mac and still stores a v1 batch on a ride that has a session key', async () => {
    const { ctx, up } = setup();
    const key = Buffer.from('11'.repeat(32), 'hex').toString('base64');
    const ride = await ctx.freeRide('w', true);
    ride.stampSessionKey(key);
    await ctx.rides.save(ride);
    const [b0, b1] = recording(ride.id, { seconds: 20 });
    const mac0 = macFor(ctx.hasher, key, ride.id, b0!, genesis(ctx.hasher, key, ride.id));
    expect(await up('w', ride.id, { ...b0!, protocol: 2, mac: mac0 })).toMatchObject({ seq: 0, stored: true, hashOk: true });
    const mac1 = macFor(ctx.hasher, key, ride.id, b1!, mac0);
    expect(await up('w', ride.id, { ...b1!, protocol: 2, mac: mac1 })).toMatchObject({ seq: 1, stored: true, hashOk: true });

    const bad = await ctx.freeRide('w', true);
    bad.stampSessionKey(key);
    await ctx.rides.save(bad);
    const [badBatch] = recording(bad.id, { seconds: 10 });
    await expect(up('w', bad.id, { ...badBatch!, protocol: 2, mac: 'ab'.repeat(32) })).rejects.toMatchObject({ errorCode: 'batch-mac-invalid' });

    const missing = await ctx.freeRide('w', true);
    missing.stampSessionKey(key);
    await ctx.rides.save(missing);
    const [bare] = recording(missing.id, { seconds: 10 });
    await expect(up('w', missing.id, { ...bare!, protocol: 2 })).rejects.toMatchObject({ errorCode: 'batch-mac-missing' });

    const legacy = await ctx.freeRide('w', true);
    legacy.stampSessionKey(key);
    await ctx.rides.save(legacy);
    const [v1] = recording(legacy.id, { seconds: 10 });
    expect(await up('w', legacy.id, v1!)).toMatchObject({ stored: true, hashOk: true });
  });

  it('checks the mac before inflate and refuses a bad or oversized protocol-2 stream without storing it', async () => {
    const { ctx, up } = setup();
    const key = Buffer.from('22'.repeat(32), 'hex').toString('base64');
    const ride = await ctx.freeRide('w', true);
    ride.stampSessionKey(key);
    await ctx.rides.save(ride);
    const [b0] = recording(ride.id, { seconds: 10 });
    const mac = macFor(ctx.hasher, key, ride.id, b0!, genesis(ctx.hasher, key, ride.id));
    const signed = { ...b0!, protocol: 2 as const, mac };
    const junk = Buffer.from([0xff, 0xff, 0xff, 0xff]).toString('base64');
    await expect(up('w', ride.id, { ...signed, mac: 'ab'.repeat(32), streams: junk })).rejects.toMatchObject({ errorCode: 'batch-mac-invalid' });
    await expect(up('w', ride.id, { ...signed, streams: junk })).rejects.toMatchObject({ errorCode: 'batch-streams-invalid' });
    await expect(up('w', ride.id, { ...signed, streams: Buffer.alloc(STREAMS_COMPRESSED_MAX + 1).toString('base64') })).rejects.toMatchObject({ errorCode: 'batch-streams-oversize' });
    const inflated = deflateRawSync(Buffer.alloc(STREAMS_UNCOMPRESSED_MAX + 1)).toString('base64');
    await expect(up('w', ride.id, { ...signed, streams: inflated })).rejects.toMatchObject({ errorCode: 'batch-streams-oversize' });
    expect(await ctx.batches.listByRide(ride.id)).toEqual([]);
    const streams = deflateRawSync(Buffer.from('fc-streams')).toString('base64');
    const stored = RideBatch.accept(ride.id, { ...signed, streams }, ctx.hasher.sha256Hex(RideBatch.canonical(signed)), ctx.now());
    const plain = RideBatch.accept(ride.id, signed, ctx.hasher.sha256Hex(RideBatch.canonical(signed)), ctx.now());
    expect(stored.summary).toEqual(plain.summary);
    expect(await up('w', ride.id, { ...signed, streams })).toMatchObject({ stored: true, hashOk: true });
    const legacy = await ctx.freeRide('v', true);
    legacy.stampSessionKey(key);
    await ctx.rides.save(legacy);
    const [v1] = recording(legacy.id, { seconds: 10 });
    expect(await up('v', legacy.id, v1!)).toMatchObject({ stored: true, hashOk: true });
  });

  it('enforce mode accepts a chk of the spawned ids and rejects a salt-formula or a world with an object removed', async () => {
    const ctx = unitContext();
    const handler = new UploadBatchHandler(ctx.lookup, ctx.batches, ctx.hasher, ctx.verdicts, ctx.clock, ctx.players, ctx.transactions, { inflateRaw: (data: Buffer) => inflateRawSync(data) }, { mode: () => 'enforce' });
    const key = Buffer.from('33'.repeat(32), 'hex').toString('base64');
    ctx.clock.advance(30);
    const upload = async (wallet: string, digestOf: (ids: string[], tSec: number, trafficSalt: string, holeSalt: string) => number) => {
      const ride = await ctx.freeRide(wallet, true);
      ride.stampSessionKey(key);
      await ctx.rides.save(ride);
      const [batch] = recording(ride.id, { seconds: 20 });
      const salts = revealRideSalts(ctx.hasher, ride.id, key);
      const plan = roadPlanFor(ride.seed, ride.trip);
      const cars = TrafficSimulator.forRide(ride.seed, ride.trip).cars;
      const checks = [0, 5, 12].map((tSec) => {
        const s = checkpointMetres(batch!.samples, tSec);
        const near = (at: number) => Math.abs(at - s) <= WORLD_DIGEST_WINDOW_M;
        const ids = [
          ...plan.holesNear(s - WORLD_DIGEST_WINDOW_M, s + WORLD_DIGEST_WINDOW_M).map((hole) => hole.id),
          ...plan.layout.describe(s + WORLD_DIGEST_WINDOW_M).junctions.filter((junction) => near(junction.s)).map((junction) => junction.id),
          ...cars.filter((car) => near(car.s)).map((car) => `car-${car.id}`),
        ];
        expect(ids.length).toBeGreaterThan(0);
        expect(spawnedWorldIds(ride.seed, ride.trip, s)).toEqual(ids);
        expect(serverWorldDigest(ride.seed, ride.trip, s)).toBe(worldDigest32(ids));
        expect(worldDigest32(ids)).not.toBe(worldDigest32([`traffic:${salts.trafficSalt}`, `hole:${salts.holeSalt}`, `t:${tSec}`]));
        return { tSec, s, digest: digestOf(ids, tSec, salts.trafficSalt, salts.holeSalt) };
      });
      const inp = deflateRawSync(Buffer.from(JSON.stringify([{ tick: 0, gas: 1 }]))).toString('base64');
      const chk = deflateRawSync(Buffer.from(JSON.stringify(checks))).toString('base64');
      const named = { inp, clk: inp, chk, mg: inp, env: inp, startTick: 0, endTick: 400 };
      const mac = ctx.hasher.hmacSha256Hex(Buffer.from(key, 'base64'), enforceBatchMacMessage(ride.id, 0, named.startTick, named.endTick, ctx.hasher.sha256Hex(inp), ctx.hasher.sha256Hex(chk)));
      return handler.execute(new UploadBatchCommand(wallet, ride.id, { ...batch!, named, mac }));
    };
    await expect(upload('w', (ids) => worldDigest32(ids))).resolves.toMatchObject({ stored: true });
    await expect(upload('gone', (ids) => worldDigest32(ids.slice(1)))).rejects.toMatchObject({ errorCode: 'world-digest-mismatch' });
    await expect(upload('echo', (_ids, tSec, trafficSalt, holeSalt) => worldDigest32([`traffic:${trafficSalt}`, `hole:${holeSalt}`, `t:${tSec}`]))).rejects.toMatchObject({ errorCode: 'world-digest-mismatch' });
  });
});

function genesis(hasher: TestHasher, keyB64: string, rideId: string): string {
  return hasher.hmacSha256Hex(Buffer.from(keyB64, 'base64'), batchMacGenesisMessage(rideId));
}

function macFor(hasher: TestHasher, keyB64: string, rideId: string, body: BatchBody, prevMac: string): string {
  return hasher.hmacSha256Hex(Buffer.from(keyB64, 'base64'), batchMacMessage(rideId, body.seq, prevMac, RideBatch.canonical(body)));
}
