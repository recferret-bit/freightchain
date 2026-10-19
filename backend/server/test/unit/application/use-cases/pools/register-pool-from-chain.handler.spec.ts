import { RegisterPoolFromChainCommand } from '../../../../../src/application/use-cases/pools/register-pool-from-chain/register-pool-from-chain.command.js';
import { RegisterPoolFromChainHandler } from '../../../../../src/application/use-cases/pools/register-pool-from-chain/register-pool-from-chain.handler.js';
import { NotFoundError } from '../../../../../src/domain/shared/errors.js';
import { chainPool } from '../../../../support/pools.js';
import { unitContext } from '../../../../support/unit-context.js';

describe('RegisterPoolFromChainHandler', () => {
  const setup = () => {
    const ctx = unitContext();
    return { ctx, register: (id: number, label: string | null = null) => new RegisterPoolFromChainHandler(ctx.registry).execute(new RegisterPoolFromChainCommand(id, label)) };
  };

  it('reads the account and inserts the mirror row (default label), a second run with --label relabels it', async () => {
    const { ctx, register } = setup();
    ctx.poolChain.pools.set(4, chainPool(ctx.now(), { poolId: 4, ticketsSold: 3 }));
    expect(await register(4)).toMatchObject({ id: 4, label: '1H · pool 4', tier: '1h', status: 'open', sold: 3, vaultLamports: 150_000_000 });
    expect(await register(4, '1 HOUR · week 42')).toMatchObject({ id: 4, label: '1 HOUR · week 42' });
    expect((await ctx.pools.findById(4))?.snapshot()).toMatchObject({ label: '1 HOUR · week 42', syncedAt: ctx.now() });
  });

  it('no such pool on chain → 404; the RPC down → 503', async () => {
    const { ctx, register } = setup();
    await expect(register(9)).rejects.toThrow(new NotFoundError('no pool 9 on chain'));
    ctx.poolChain.rpcDown = true;
    await expect(register(9)).rejects.toMatchObject({ statusCode: 503 });
  });
});
