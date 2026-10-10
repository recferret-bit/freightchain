import { RidesHttpController } from '../../../src/presentation/rides/rides.http.controller.js';
import { CreateRideCommand } from '../../../src/application/use-cases/rides/create-ride/create-ride.command.js';
import { GetPendingRideQuery } from '../../../src/application/use-cases/rides/get-pending-ride/get-pending-ride.query.js';
import { GetRideQuery } from '../../../src/application/use-cases/rides/get-ride/get-ride.query.js';
import { GetPaymentInstructionsQuery } from '../../../src/application/use-cases/rides/get-payment-instructions/get-payment-instructions.query.js';
import { ConfirmPaymentCommand } from '../../../src/application/use-cases/rides/confirm-payment/confirm-payment.command.js';
import { ReconcilePaymentCommand } from '../../../src/application/use-cases/rides/reconcile-payment/reconcile-payment.command.js';
import { StartRideCommand } from '../../../src/application/use-cases/rides/start-ride/start-ride.command.js';
import { HeartbeatRideCommand } from '../../../src/application/use-cases/rides/heartbeat-ride/heartbeat-ride.command.js';
import { EndRideCommand } from '../../../src/application/use-cases/rides/end-ride/end-ride.command.js';
import { UploadBatchCommand } from '../../../src/application/use-cases/telemetry/upload-batch/upload-batch.command.js';
import { batchBodySchema, endRideBodySchema, heartbeatBodySchema, createRideBodySchema, confirmPaymentBodySchema, startRideBodySchema } from '../../../src/presentation/rides/dto/rides.dto.js';
import { rideIdParamsSchema } from '../../../src/presentation/common/dto/common.dto.js';
import { busMock } from '../../support/bus.js';
import { newSignature } from '../../support/fake-chain.js';
import { recording } from '../../support/recording.js';

const me = { wallet: 'W' }, params = { id: 'ride-1' };

describe('RidesHttpController', () => {
  const setup = () => { const commands = busMock({ id: 'ride-1' }), queries = busMock({ id: 'ride-1' }); return { commands, queries, c: new RidesHttpController(commands.bus, queries.bus) }; };

  it('dispatches every route to its command / query with the signed-in wallet', async () => {
    const { commands, queries, c } = setup();
    await c.create(me, { tier: '4h' }); expect(commands.last()).toEqual(new CreateRideCommand('W', '4h'));
    await c.create(me, { tier: 'free', tutorial: true, assist: true }); expect(commands.last()).toEqual(new CreateRideCommand('W', 'free', true, true));
    await c.create(me, { tier: 'free', level: 3 }); expect(commands.last()).toEqual(new CreateRideCommand('W', 'free', false, false, 3));
    await c.pending(me); expect(queries.last()).toEqual(new GetPendingRideQuery('W'));
    await c.get(me, params); expect(queries.last()).toEqual(new GetRideQuery('W', 'ride-1'));
    await c.payment(me, params); expect(queries.last()).toEqual(new GetPaymentInstructionsQuery('W', 'ride-1'));
    await c.confirm(me, params, { signature: 'S' }); expect(commands.last()).toEqual(new ConfirmPaymentCommand('W', 'ride-1', 'S'));
    await c.reconcile(me, params); expect(commands.last()).toEqual(new ReconcilePaymentCommand('W', 'ride-1'));
    await c.start(me, params, {}); expect(commands.last()).toEqual(new StartRideCommand('W', 'ride-1', null));
    await c.start(me, params, { trip: 'free-2' }); expect(commands.last()).toEqual(new StartRideCommand('W', 'ride-1', 'free-2'));
    const report = heartbeatBodySchema.parse({ s: 10, t: 2, hull: 90, route: 'brenner' });
    await c.heartbeat(me, params, report); expect(commands.last()).toEqual(new HeartbeatRideCommand('W', 'ride-1', report));
    const end = endRideBodySchema.parse({ outcome: 'failed', s: 'NaN', reason: 'crash' });
    await c.end(me, params, end); expect(commands.last()).toEqual(new EndRideCommand('W', 'ride-1', 'failed', end.report, 'crash'));
    const batch = batchBodySchema.parse(recording('ride-1', { seconds: 10 })[0]);
    await c.batch(me, params, batch); expect(commands.last()).toEqual(new UploadBatchCommand('W', 'ride-1', batch));
    expect(commands.sent).toHaveLength(10);
    expect(queries.sent).toHaveLength(3);
  });

  it('returns what the handler returned, untouched', async () => {
    const { c } = setup();
    expect(await c.get(me, params)).toEqual({ id: 'ride-1' });
  });

  describe('DTO schemas', () => {
    it('create: a known tier only', () => {
      expect(createRideBodySchema.safeParse({ tier: 'free' }).success).toBe(true);
      expect(createRideBodySchema.safeParse({ tier: 'platinum' }).success).toBe(false);
    });
    it('create: the free ride\'s tutorial / assist are optional booleans', () => {
      expect(createRideBodySchema.parse({ tier: 'free', tutorial: true, assist: false })).toEqual({ tier: 'free', tutorial: true, assist: false });
      expect(createRideBodySchema.safeParse({ tier: 'free', assist: 'yes' }).success).toBe(false);
      expect(createRideBodySchema.safeParse({ tier: 'free', tutorial: 1 }).success).toBe(false);
    });
    it('create: the free ride\'s level is optional and 1, 2 or 3 – nothing else', () => {
      expect(createRideBodySchema.parse({ tier: 'free', level: 2 })).toEqual({ tier: 'free', level: 2 });
      for (const level of [0, 4, 1.5, '2', null, 'HARD']) expect(createRideBodySchema.safeParse({ tier: 'free', level }).success, String(level)).toBe(false);
      expect(createRideBodySchema.safeParse({ tier: '1h', level: 1 }).success).toBe(true);   // valid shape: the handler refuses it (409 level_free_only)
    });
    it('start: the game\'s trip is an optional, short, non-empty string', () => {
      expect(startRideBodySchema.parse({})).toEqual({});
      expect(startRideBodySchema.parse({ trip: 'free-3' })).toEqual({ trip: 'free-3' });
      for (const trip of ['', 'x'.repeat(33), 3, null]) expect(startRideBodySchema.safeParse({ trip }).success, String(trip)).toBe(false);
    });
    it('confirm: a base58 transaction signature', () => {
      expect(confirmPaymentBodySchema.safeParse({ signature: newSignature() }).success).toBe(true);
      expect(confirmPaymentBodySchema.safeParse({ signature: 'nope' }).success).toBe(false);
    });
    it('params: a non-empty id of sane length', () => {
      expect(rideIdParamsSchema.safeParse({ id: '' }).success).toBe(false);
      expect(rideIdParamsSchema.safeParse({ id: 'x'.repeat(65) }).success).toBe(false);
    });
    it('heartbeat is STRICT: a missing / negative / huge distance or a garbage hull is a 400; extras are tolerated', () => {
      for (const bad of [{}, { s: 'abc' }, { s: -1 }, { s: 1e8 }, { s: 1, hull: 'x' }]) expect(heartbeatBodySchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
      expect(heartbeatBodySchema.parse({ s: '12.5', t: 'later', hull: null, paused: 'yes', route: 42, night: 1 })).toEqual({ s: 12.5, t: null, hull: null, paused: false, night: false, crashesVehicle: null, crashesBuilding: null });   // a `route` in the body is not read: the server assigns it
      expect(heartbeatBodySchema.parse({ s: 1, crashesVehicle: '3', crashesBuilding: 'x' })).toMatchObject({ crashesVehicle: 3, crashesBuilding: null }); // the crash counters are lenient – statistics, never a 400
      expect(heartbeatBodySchema.parse({ s: 1, route: 'siberia' })).not.toHaveProperty('route');
    });
    it('a recording batch is STRICT: typed rows, capped arrays, a hex hash or none', () => {
      const [b0] = recording('ride-1', { seconds: 10 });
      expect(batchBodySchema.parse(b0)).toEqual(b0);
      expect(batchBodySchema.parse({ ...b0, hash: undefined }).hash).toBeNull();
      expect(batchBodySchema.parse({ ...b0, inputs: [[1, '', 1]] }).inputs).toEqual([[1, '', 1]]); // a key without a KeyboardEvent.code (OEM / IME)
      for (const bad of [{ ...b0, seq: 1.5 }, { ...b0, seq: -1 }, { ...b0, prevHash: '' }, { ...b0, hash: 'ABC' }, { ...b0, t0: -1 }, { ...b0, inputs: [[1, 'x'.repeat(33), 1]] }, { ...b0, inputs: [[1, 'KeyW', 2]] }, { ...b0, samples: [['x']] }, { ...b0, samples: Array.from({ length: 401 }, () => [0]) }]) {
        expect(batchBodySchema.safeParse(bad).success, JSON.stringify(bad).slice(0, 80)).toBe(false);
      }
    });
    it('end is LENIENT: garbled values are dropped, never an error – but the outcome must be known', () => {
      expect(endRideBodySchema.parse({ outcome: 'shift', s: 'NaN', t: 'x', hull: 'y', reason: 42 })).toEqual({ outcome: 'shift', reason: null, report: { s: null, t: null, hull: null, paused: false, night: false, crashesVehicle: null, crashesBuilding: null } });
      expect(endRideBodySchema.parse({ outcome: 'failed', s: -5 }).report.s).toBeNull();
      expect(endRideBodySchema.parse({ outcome: 'failed', reason: 'r'.repeat(300) }).reason).toHaveLength(200);
      expect(endRideBodySchema.safeParse({ outcome: 'won' }).success).toBe(false);
    });
  });
});
