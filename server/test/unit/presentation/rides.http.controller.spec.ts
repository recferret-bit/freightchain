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
import { endRideBodySchema, heartbeatBodySchema, createRideBodySchema, confirmPaymentBodySchema } from '../../../src/presentation/rides/dto/rides.dto.js';
import { rideIdParamsSchema } from '../../../src/presentation/common/dto/common.dto.js';
import { busMock } from '../../support/bus.js';
import { newSignature } from '../../support/fake-chain.js';

const me = { wallet: 'W' }, params = { id: 'ride-1' };

describe('RidesHttpController', () => {
  const setup = () => { const commands = busMock({ id: 'ride-1' }), queries = busMock({ id: 'ride-1' }); return { commands, queries, c: new RidesHttpController(commands.bus, queries.bus) }; };

  it('dispatches every route to its command / query with the signed-in wallet', async () => {
    const { commands, queries, c } = setup();
    await c.create(me, { tier: '4h' }); expect(commands.last()).toEqual(new CreateRideCommand('W', '4h'));
    await c.pending(me); expect(queries.last()).toEqual(new GetPendingRideQuery('W'));
    await c.get(me, params); expect(queries.last()).toEqual(new GetRideQuery('W', 'ride-1'));
    await c.payment(me, params); expect(queries.last()).toEqual(new GetPaymentInstructionsQuery('W', 'ride-1'));
    await c.confirm(me, params, { signature: 'S' }); expect(commands.last()).toEqual(new ConfirmPaymentCommand('W', 'ride-1', 'S'));
    await c.reconcile(me, params); expect(commands.last()).toEqual(new ReconcilePaymentCommand('W', 'ride-1'));
    await c.start(me, params); expect(commands.last()).toEqual(new StartRideCommand('W', 'ride-1'));
    const report = heartbeatBodySchema.parse({ s: 10, t: 2, hull: 90, route: 'brenner' });
    await c.heartbeat(me, params, report); expect(commands.last()).toEqual(new HeartbeatRideCommand('W', 'ride-1', report));
    const end = endRideBodySchema.parse({ outcome: 'failed', s: 'NaN', reason: 'crash' });
    await c.end(me, params, end); expect(commands.last()).toEqual(new EndRideCommand('W', 'ride-1', 'failed', end.report, 'crash'));
    expect(commands.sent).toHaveLength(6);
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
      expect(heartbeatBodySchema.parse({ s: '12.5', t: 'later', hull: null, paused: 'yes', route: 42, night: 1 })).toEqual({ s: 12.5, t: null, hull: null, paused: false, route: null, night: false });
      expect(heartbeatBodySchema.parse({ s: 1, route: 'x'.repeat(100) }).route).toHaveLength(64);
    });
    it('end is LENIENT: garbled values are dropped, never an error – but the outcome must be known', () => {
      expect(endRideBodySchema.parse({ outcome: 'shift', s: 'NaN', t: 'x', hull: 'y', reason: 42 })).toEqual({ outcome: 'shift', reason: null, report: { s: null, t: null, hull: null, paused: false, route: null, night: false } });
      expect(endRideBodySchema.parse({ outcome: 'failed', s: -5 }).report.s).toBeNull();
      expect(endRideBodySchema.parse({ outcome: 'failed', reason: 'r'.repeat(300) }).reason).toHaveLength(200);
      expect(endRideBodySchema.safeParse({ outcome: 'won' }).success).toBe(false);
    });
  });
});
