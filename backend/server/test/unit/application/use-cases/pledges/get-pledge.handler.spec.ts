import { describe, expect, it } from 'vitest';
import { GetPledgeQuery } from '../../../../../src/application/use-cases/pledges/get-pledge/get-pledge.query.js';
import { GetPledgeHandler } from '../../../../../src/application/use-cases/pledges/get-pledge/get-pledge.handler.js';
import { Pledge } from '../../../../../src/domain/economy/pledge.entity.js';
import { NotFoundError } from '../../../../../src/domain/shared/errors.js';
import { unitContext } from '../../../../support/unit-context.js';

describe('GetPledgeHandler', () => {
  it('returns pledge by ID or PDA address', async () => {
    const ctx = unitContext();
    const handler = new GetPledgeHandler(ctx.pledges);

    const p = Pledge.create({
      id: '00000000-0000-4000-8000-000000000001',
      pdaAddress: 'PledgePDA111111111111111111111111111111111',
      rideId: '00000000-0000-4000-8000-000000000010',
      sponsor: 'Sponsor1',
      driver: 'Driver1',
      poolId: 1,
      lamportsPerKm: 1_000_000n,
      targetKm: 10,
      now: ctx.now(),
    });
    await ctx.pledges.insert(p);

    const byId = await handler.execute(new GetPledgeQuery(p.id));
    expect(byId.id).toBe(p.id);

    const byPda = await handler.execute(new GetPledgeQuery(p.pdaAddress));
    expect(byPda.id).toBe(p.id);
  });

  it('throws NotFoundError if pledge does not exist', async () => {
    const ctx = unitContext();
    const handler = new GetPledgeHandler(ctx.pledges);

    await expect(handler.execute(new GetPledgeQuery('nope'))).rejects.toThrow(NotFoundError);
  });
});
