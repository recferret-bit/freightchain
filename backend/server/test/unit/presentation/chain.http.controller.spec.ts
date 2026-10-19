import { ChainHttpController } from '../../../src/presentation/chain/chain.http.controller.js';
import { GetChainFeesQuery } from '../../../src/application/use-cases/chain/get-chain-fees/get-chain-fees.query.js';
import { chainFeesQuerySchema } from '../../../src/presentation/chain/dto/chain.dto.js';
import { busMock } from '../../support/bus.js';

describe('ChainHttpController', () => {
  it('fees → GetChainFeesQuery with the pool (or none)', async () => {
    const queries = busMock({ priorityMicrolamports: 1 });
    const c = new ChainHttpController(queries.bus);
    expect(await c.fees({ poolId: 3 })).toEqual({ priorityMicrolamports: 1 });
    expect(queries.last()).toEqual(new GetChainFeesQuery(3));
    await c.fees({});
    expect(queries.last()).toEqual(new GetChainFeesQuery(null));
  });

  it('?poolId: optional, a whole u32 (query strings arrive as text)', () => {
    expect(chainFeesQuerySchema.parse({})).toEqual({});
    expect(chainFeesQuerySchema.parse({ poolId: '' })).toEqual({});
    expect(chainFeesQuerySchema.parse({ poolId: '7' })).toEqual({ poolId: 7 });
    for (const bad of ['x', '-1', '1.5', String(2 ** 32)]) expect(chainFeesQuerySchema.safeParse({ poolId: bad }).success, bad).toBe(false);
    expect(chainFeesQuerySchema.safeParse({ poolId: 'x' }).error?.issues[0]?.message).toBe('poolId must be a pool id');
  });
});
