import { RegisterPoolHandler } from '../../../../../src/application/use-cases/pools/register-pool/register-pool.handler.js';
import { RegisterPoolCommand } from '../../../../../src/application/use-cases/pools/register-pool/register-pool.command.js';
import { BadRequestError, ConflictError } from '../../../../../src/domain/shared/errors.js';
import { unitContext } from '../../../../support/unit-context.js';
import { poolProps } from '../../../../support/pools.js';

describe('RegisterPoolHandler', () => {
  it('validates the rules, inserts or overwrites by id, and returns the DTO', async () => {
    const ctx = unitContext();
    const handler = new RegisterPoolHandler(ctx.pools, ctx.entropy);
    expect(await handler.execute(new RegisterPoolCommand(poolProps({ id: 3 })))).toMatchObject({ id: 3, status: 'open' });
    expect(await handler.execute(new RegisterPoolCommand(poolProps({ id: 3, status: 'active', ticketsSold: 2 })))).toMatchObject({ id: 3, status: 'active', sold: 2 });
    expect((await ctx.pools.listLive()).map((p) => p.id)).toEqual([3]);
    await expect(handler.execute(new RegisterPoolCommand(poolProps({ id: 4, feeBps: 0 })))).rejects.toBeInstanceOf(BadRequestError);
  });

  it('a new pool draws its ride seed; registering it again keeps that seed (rides already driven in it stay on the same road)', async () => {
    const ctx = unitContext();
    const handler = new RegisterPoolHandler(ctx.pools, ctx.entropy);
    const { rideSeed: _ignored, ...props } = poolProps({ id: 5 });
    await handler.execute(new RegisterPoolCommand(props));
    const first = (await ctx.pools.findById(5))?.rideSeed;
    expect(first).toEqual(expect.any(Number));
    await handler.execute(new RegisterPoolCommand({ ...props, label: 'renamed' }));
    expect((await ctx.pools.findById(5))?.rideSeed).toBe(first);
    await handler.execute(new RegisterPoolCommand(poolProps({ id: 6 })));
    expect((await ctx.pools.findById(6))?.rideSeed).not.toBe(first);
  });

  it('one address, one pool id', async () => {
    const ctx = unitContext();
    const handler = new RegisterPoolHandler(ctx.pools, ctx.entropy);
    await handler.execute(new RegisterPoolCommand(poolProps({ id: 1, address: 'SamePda' })));
    await expect(handler.execute(new RegisterPoolCommand(poolProps({ id: 2, address: 'SamePda' })))).rejects.toThrow(new ConflictError('address SamePda already belongs to pool 1', 'pool_exists'));
  });
});
