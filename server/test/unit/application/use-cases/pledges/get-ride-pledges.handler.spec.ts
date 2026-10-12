import { describe, expect, it } from 'vitest';
import { GetRidePledgesQuery } from '../../../../../src/application/use-cases/pledges/get-ride-pledges/get-ride-pledges.query.js';
import { GetRidePledgesHandler } from '../../../../../src/application/use-cases/pledges/get-ride-pledges/get-ride-pledges.handler.js';
import { Pledge } from '../../../../../src/domain/economy/pledge.entity.js';
import { unitContext } from '../../../../support/unit-context.js';

describe('GetRidePledgesHandler', () => {
  it('returns all pledges for a ride mapped to DTOs', async () => {
    const ctx = unitContext();
    const handler = new GetRidePledgesHandler(ctx.pledges);

    const rideId = '00000000-0000-4000-8000-000000000010';
    const p1 = Pledge.create({
      id: '00000000-0000-4000-8000-000000000001',
      pdaAddress: 'PDA1',
      rideId,
      sponsor: 'Sponsor1',
      driver: 'Driver1',
      poolId: 1,
      lamportsPerKm: 1_000_000n,
      targetKm: 10,
      now: ctx.now(),
    });
    const p2 = Pledge.create({
      id: '00000000-0000-4000-8000-000000000002',
      pdaAddress: 'PDA2',
      rideId,
      sponsor: 'Sponsor2',
      driver: 'Driver1',
      poolId: 1,
      lamportsPerKm: 2_000_000n,
      targetKm: 20,
      now: ctx.now(),
    });
    await ctx.pledges.insert(p1);
    await ctx.pledges.insert(p2);

    const res = await handler.execute(new GetRidePledgesQuery(rideId));
    expect(res).toHaveLength(2);
    expect(res.map((x) => x.id)).toEqual([p1.id, p2.id]);
  });

  it('returns empty array when no pledges exist for the ride', async () => {
    const ctx = unitContext();
    const handler = new GetRidePledgesHandler(ctx.pledges);

    const res = await handler.execute(new GetRidePledgesQuery('empty-ride'));
    expect(res).toEqual([]);
  });
});
