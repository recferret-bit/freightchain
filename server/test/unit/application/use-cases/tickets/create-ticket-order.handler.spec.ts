import { CreateTicketOrderHandler } from '../../../../../src/application/use-cases/tickets/create-ticket-order/create-ticket-order.handler.js';
import { CreateTicketOrderCommand } from '../../../../../src/application/use-cases/tickets/create-ticket-order/create-ticket-order.command.js';
import { ConflictError, NotFoundError, ServiceUnavailableError } from '../../../../../src/domain/shared/errors.js';
import { FixedRules, unitContext, unitRules } from '../../../../support/unit-context.js';
import { aPool } from '../../../../support/pools.js';

const PROGRAM = unitRules({ paymentMode: 'program', programId: '9e7phdJzKMNJX8ZnqR8SdxNzafNJjYXeZNsjQze3BSvx' });

describe('CreateTicketOrderHandler', () => {
  const setup = async (rules = PROGRAM) => {
    const ctx = unitContext(rules);
    await ctx.pools.upsert(aPool({ id: 1, maxPerWallet: 5 }, ctx.now()));
    await ctx.pools.upsert(aPool({ id: 2, tier: '4h' }, ctx.now()));
    const handler = new CreateTicketOrderHandler(ctx.players, ctx.pools, ctx.tickets, ctx.orders, ctx.sessions, new FixedRules(rules), ctx.transactions, ctx.clock, ctx.entropy);
    return { ctx, order: (poolId: number, qty: number, wallet = 'w') => handler.execute(new CreateTicketOrderCommand(wallet, poolId, qty)) };
  };

  it('an order priced by the pool, expiring after the TTL; the same request hands it back', async () => {
    const { ctx, order } = await setup();
    const o = await order(1, 2);
    expect(o).toMatchObject({ poolId: 1, qty: 2, lamports: 100_000_000, status: 'awaiting_payment', expiresAt: ctx.clock.ms + 3_600_000, paidAt: null, signature: null });
    expect((await order(1, 2)).id).toBe(o.id);
  });

  it('a different pool or quantity, or a lapsed order, lets the old one expire', async () => {
    const { ctx, order } = await setup();
    const a = await order(1, 2);
    const b = await order(2, 1);
    expect((await ctx.orders.findById(a.id))?.status).toBe('expired');
    ctx.clock.advance(3600);
    const c = await order(2, 1);
    expect(c.id).not.toBe(b.id);
    expect((await ctx.orders.findById(b.id))?.status).toBe('expired');
  });

  it('refuses: no program (503), unknown pool (404), over the per-wallet cap counting what was bought (409)', async () => {
    await expect((await setup(unitRules())).order(1, 1)).rejects.toBeInstanceOf(ServiceUnavailableError);
    const { ctx, order } = await setup();
    await expect(order(9, 1)).rejects.toThrow(new NotFoundError('no such pool'));
    await ctx.player('w');
    const t = await ctx.tickets.open('w', 1); t.recordPurchase(4); await ctx.tickets.save(t);
    await expect(order(1, 2)).rejects.toThrow(new ConflictError('at most 5 tickets per wallet in this pool', 'not_sellable'));
    expect(await order(1, 1)).toMatchObject({ qty: 1 });
  });
});
