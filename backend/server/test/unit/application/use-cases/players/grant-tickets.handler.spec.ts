import { GrantTicketsHandler } from '../../../../../src/application/use-cases/players/grant-tickets/grant-tickets.handler.js';
import { GrantTicketsCommand } from '../../../../../src/application/use-cases/players/grant-tickets/grant-tickets.command.js';
import { BadRequestError, ConflictError, NotFoundError } from '../../../../../src/domain/shared/errors.js';
import { TREASURY } from '../../../../support/fake-chain.js';
import { unitContext } from '../../../../support/unit-context.js';
import { aPool } from '../../../../support/pools.js';

const WALLET = TREASURY; // any valid base58 address

describe('GrantTicketsHandler', () => {
  const setup = () => {
    const ctx = unitContext();
    const handler = new GrantTicketsHandler(ctx.players, ctx.pools, ctx.poolTickets, ctx.sessions, ctx.transactions, ctx.clock);
    return { ctx, grant: (poolId: number, count: number, wallet = WALLET) => handler.execute(new GrantTicketsCommand(wallet, poolId, count, 'beta tester')) };
  };

  it('registers an unknown wallet, grants up to the cap and writes an admin audit line', async () => {
    const { ctx, grant } = setup();
    await ctx.pools.upsert(aPool({ id: 1, status: 'open', maxPerWallet: 3 }));
    expect(await grant(1, 2)).toEqual({ wallet: WALLET, poolId: 1, added: 2, balance: 2, cap: 3 });
    expect(await grant(1, 5)).toMatchObject({ added: 1, balance: 3 });
    expect(await ctx.storedPlayer(WALLET)).toBeTruthy();
    expect((await ctx.tickets.recentGrants(WALLET, 5)).map((g) => [g.source, g.delta, g.ref])).toEqual([['admin', 1, 'beta tester'], ['admin', 2, 'beta tester']]);
  });

  it('refuses a bad wallet or count, an unknown pool and a pool that is no longer live', async () => {
    const { ctx, grant } = setup();
    await ctx.pools.upsert(aPool({ id: 2, status: 'settled' }));
    await expect(grant(1, 1, 'not-a-wallet')).rejects.toBeInstanceOf(BadRequestError);
    await expect(grant(1, 0)).rejects.toThrow(new BadRequestError('grant at least 1 ticket'));
    await expect(grant(1, 1)).rejects.toThrow(new NotFoundError('no pool 1'));
    await expect(grant(2, 1)).rejects.toThrow(new ConflictError('pool 2 is settled', 'pool_closed'));
  });
});
