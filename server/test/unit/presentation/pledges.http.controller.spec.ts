import { PledgesHttpController } from '../../../src/presentation/economy/pledges.http.controller.js';
import { CreatePledgeCommand } from '../../../src/application/use-cases/pledges/create-pledge/create-pledge.command.js';
import { ConfirmPledgeCommand } from '../../../src/application/use-cases/pledges/confirm-pledge/confirm-pledge.command.js';
import { GetRidePledgesQuery } from '../../../src/application/use-cases/pledges/get-ride-pledges/get-ride-pledges.query.js';
import { GetPledgeQuery } from '../../../src/application/use-cases/pledges/get-pledge/get-pledge.query.js';
import {
  createPledgeBodySchema,
  pledgeIdParamsSchema,
  pledgeRideIdParamsSchema,
  confirmPledgeBodySchema,
} from '../../../src/presentation/economy/dto/pledges.dto.js';
import { busMock } from '../../support/bus.js';

describe('PledgesHttpController', () => {
  const dummyPledge = {
    id: 'p1',
    sponsor: '11111111111111111111111111111111',
    rideId: 'r1',
    lamportsPerKm: 1_000_000n,
    targetKm: 10,
    maxLamports: 10_000_000n,
    driverEarned: 0n,
    sponsorRefund: 0n,
    status: 'active',
  };

  it('dispatches CreatePledgeCommand strictly with authenticated player wallet, ignoring any spoofed sponsor', async () => {
    const commands = busMock(dummyPledge);
    const queries = busMock();
    const c = new PledgesHttpController(commands.bus, queries.bus);

    const res1 = await c.create(
      { wallet: '11111111111111111111111111111111' },
      { rideId: 'r1', lamportsPerKm: 1_000_000n, targetKm: 10 },
    );
    expect(res1).toEqual(dummyPledge);
    expect(commands.last()).toEqual(
      new CreatePledgeCommand('11111111111111111111111111111111', 'r1', 1_000_000n, 10),
    );

    await c.create(
      { wallet: '11111111111111111111111111111111' },
      { rideId: 'r2', lamportsPerKm: 500_000n, targetKm: 20 } as any,
    );
    expect(commands.last()).toEqual(
      new CreatePledgeCommand('11111111111111111111111111111111', 'r2', 500_000n, 20),
    );
  });

  it('dispatches GetRidePledgesQuery for listing ride pledges', async () => {
    const commands = busMock();
    const queries = busMock([dummyPledge]);
    const c = new PledgesHttpController(commands.bus, queries.bus);

    const res = await c.listByRide({ id: 'r1' });
    expect(res).toEqual([dummyPledge]);
    expect(queries.last()).toEqual(new GetRidePledgesQuery('r1'));
  });

  it('dispatches ConfirmPledgeCommand with the signed-in wallet, the pledge id and the signature; there is no settle route', async () => {
    const commands = busMock(dummyPledge);
    const c = new PledgesHttpController(commands.bus, busMock().bus);
    const sig = '5'.repeat(88);
    expect(await c.confirm({ wallet: 'W1' }, { id: 'p1' }, { signature: sig })).toEqual(dummyPledge);
    expect(commands.last()).toEqual(new ConfirmPledgeCommand('W1', 'p1', sig));
    expect('settle' in c).toBe(false);
  });

  it('dispatches GetPledgeQuery by id', async () => {
    const commands = busMock();
    const queries = busMock(dummyPledge);
    const c = new PledgesHttpController(commands.bus, queries.bus);

    const res = await c.get({ id: 'p1' });
    expect(res).toEqual(dummyPledge);
    expect(queries.last()).toEqual(new GetPledgeQuery('p1'));
  });

  it('validates createPledgeBodySchema, confirmPledgeBodySchema, and param schemas', () => {
    const RIDE = '6ba7b810-9dad-41d1-80b4-00c04fd430c8';
    // Valid create body
    const valid = createPledgeBodySchema.parse({
      rideId: RIDE,
      lamportsPerKm: '1000000',
      targetKm: '10',
    });
    expect(valid.lamportsPerKm).toBe(1_000_000n);
    expect(valid.targetKm).toBe(10);

    // Extraneous sponsor field is stripped
    const stripped = createPledgeBodySchema.parse({
      sponsor: 'SpoofedWallet111111111111111111111111111111',
      rideId: RIDE,
      lamportsPerKm: 1_000n,
      targetKm: 1,
    }) as any;
    expect(stripped.sponsor).toBeUndefined();

    // a ride id is a uuid; at least 1 000 lamports a km, at most 1 SOL a km; 1..10 000 km
    expect(createPledgeBodySchema.safeParse({ rideId: 'r1', lamportsPerKm: 1_000, targetKm: 1 }).success).toBe(false);
    expect(createPledgeBodySchema.safeParse({ rideId: RIDE, lamportsPerKm: 999, targetKm: 1 }).success).toBe(false);
    expect(createPledgeBodySchema.safeParse({ rideId: RIDE, lamportsPerKm: -5, targetKm: 1 }).success).toBe(false);
    expect(createPledgeBodySchema.safeParse({ rideId: RIDE, lamportsPerKm: 1_000_000_001, targetKm: 1 }).success).toBe(false);
    expect(createPledgeBodySchema.safeParse({ rideId: RIDE, lamportsPerKm: 1_000, targetKm: 0 }).success).toBe(false);
    expect(createPledgeBodySchema.safeParse({ rideId: RIDE, lamportsPerKm: 1_000, targetKm: 10_001 }).success).toBe(false);

    // confirm needs a transaction signature
    expect(confirmPledgeBodySchema.safeParse({}).success).toBe(false);
    expect(confirmPledgeBodySchema.safeParse({ signature: 'nope' }).success).toBe(false);
    expect(confirmPledgeBodySchema.safeParse({ signature: '5'.repeat(88) }).success).toBe(true);
    expect(pledgeIdParamsSchema.safeParse({ id: '' }).success).toBe(false);
    expect(pledgeRideIdParamsSchema.safeParse({ id: '' }).success).toBe(false);
  });
});
