import { PledgesHttpController } from '../../../src/presentation/economy/pledges.http.controller.js';
import { CreatePledgeCommand } from '../../../src/application/use-cases/pledges/create-pledge/create-pledge.command.js';
import { SettlePledgeCommand } from '../../../src/application/use-cases/pledges/settle-pledge/settle-pledge.command.js';
import { GetRidePledgesQuery } from '../../../src/application/use-cases/pledges/get-ride-pledges/get-ride-pledges.query.js';
import { GetPledgeQuery } from '../../../src/application/use-cases/pledges/get-pledge/get-pledge.query.js';
import {
  createPledgeBodySchema,
  pledgeIdParamsSchema,
  pledgeRideIdParamsSchema,
  settlePledgeBodySchema,
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

  it('dispatches SettlePledgeCommand with pledgeId and optional settlement details', async () => {
    const commands = busMock(dummyPledge);
    const queries = busMock();
    const c = new PledgesHttpController(commands.bus, queries.bus);

    await c.settle({ id: 'p1' }, { signature: 'sig123', slot: 100n });
    expect(commands.last()).toEqual(new SettlePledgeCommand('p1', 'sig123', 100n));

    await c.settle({ id: 'p1' }, {});
    expect(commands.last()).toEqual(new SettlePledgeCommand('p1', undefined, undefined));
  });

  it('dispatches GetPledgeQuery by id', async () => {
    const commands = busMock();
    const queries = busMock(dummyPledge);
    const c = new PledgesHttpController(commands.bus, queries.bus);

    const res = await c.get({ id: 'p1' });
    expect(res).toEqual(dummyPledge);
    expect(queries.last()).toEqual(new GetPledgeQuery('p1'));
  });

  it('validates createPledgeBodySchema, settlePledgeBodySchema, and param schemas', () => {
    // Valid create body
    const valid = createPledgeBodySchema.parse({
      rideId: 'r1',
      lamportsPerKm: '1000000',
      targetKm: '10',
    });
    expect(valid.lamportsPerKm).toBe(1_000_000n);
    expect(valid.targetKm).toBe(10);

    // Extraneous sponsor field is stripped
    const stripped = createPledgeBodySchema.parse({
      sponsor: 'SpoofedWallet111111111111111111111111111111',
      rideId: 'r1',
      lamportsPerKm: 10n,
      targetKm: 1,
    }) as any;
    expect(stripped.sponsor).toBeUndefined();

    // Non-positive lamports
    expect(createPledgeBodySchema.safeParse({ rideId: 'r1', lamportsPerKm: 0, targetKm: 1 }).success).toBe(false);
    expect(createPledgeBodySchema.safeParse({ rideId: 'r1', lamportsPerKm: -5, targetKm: 1 }).success).toBe(false);

    // Non-positive targetKm
    expect(createPledgeBodySchema.safeParse({ rideId: 'r1', lamportsPerKm: 100n, targetKm: 0 }).success).toBe(false);

    // Settle body defaults and types
    expect(settlePledgeBodySchema.parse({})).toEqual({});
    expect(pledgeIdParamsSchema.safeParse({ id: '' }).success).toBe(false);
    expect(pledgeRideIdParamsSchema.safeParse({ id: '' }).success).toBe(false);
  });
});
