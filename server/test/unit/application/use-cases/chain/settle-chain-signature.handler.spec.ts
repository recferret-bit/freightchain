import { SettleChainSignatureHandler } from '../../../../../src/application/use-cases/chain/settle-chain-signature/settle-chain-signature.handler.js';
import { SettleChainSignatureCommand } from '../../../../../src/application/use-cases/chain/settle-chain-signature/settle-chain-signature.command.js';
import { TicketOrder } from '../../../../../src/domain/economy/ticket-order.entity.js';
import { TREASURY } from '../../../../support/fake-chain.js';
import { unitContext } from '../../../../support/unit-context.js';
import { aPool, chainPool } from '../../../../support/pools.js';

const BUYER = TREASURY;

describe('SettleChainSignatureHandler', () => {
  const setup = () => {
    const ctx = unitContext();
    const handler = new SettleChainSignatureHandler(ctx.poolChain, ctx.chainEvents, ctx.ticketSettlement, ctx.registry, ctx.clock);
    return { ctx, settle: (sig: string) => handler.execute(new SettleChainSignatureCommand(sig)) };
  };
  const purchase = (orderId = '', over: Record<string, unknown> = {}) => ({ poolId: 1, buyer: BUYER, qty: 2, lamports: 100_000_000, orderId, ticketsSold: 2, activated: false, ...over });

  it('pays the order, records every event of the transaction in the log, and is idempotent', async () => {
    const { ctx, settle } = setup();
    await ctx.pools.upsert(aPool({ id: 1, minTickets: 2 }, ctx.now()));
    await ctx.player(BUYER);
    const order = TicketOrder.create({ id: '00000000-0000-4000-8000-0000000000aa', wallet: BUYER, pool: (await ctx.pools.findById(1))!, qty: 2, walletBought: 0, now: ctx.now() });
    await ctx.orders.insert(order);
    const sig = ctx.poolChain.addTransaction([{ kind: 'TicketBought', ...purchase(order.id, { activated: true }) }, { kind: 'PoolActivated', poolId: 1, ticketsSold: 2 }]);
    const r = await settle(sig);
    expect(r).toMatchObject({ status: 'done', events: [{ index: 0, kind: 'TicketBought', outcome: 'settled', orderId: order.id }, { index: 1, kind: 'PoolActivated', outcome: 'applied' }] });
    expect(await ctx.chainEvents.find(sig, 0)).toMatchObject({ kind: 'TicketBought', poolId: 1, wallet: BUYER, orderId: order.id, lamports: 100_000_000, outcome: 'settled' });
    expect((await ctx.pools.findById(1))?.status).toBe('active');
    expect((await settle(sig)).events[0]).toMatchObject({ outcome: 'duplicate', orderId: order.id });
    expect((await ctx.tickets.find(BUYER, 1))?.balance).toBe(2);
  });

  it('a pool the mirror has not seen is registered from its account and the event retried', async () => {
    const { ctx, settle } = setup();
    ctx.poolChain.pools.set(1, chainPool(ctx.now(), { ticketsSold: 0, buyers: 0, escrowLamports: 0 }));
    const sig = ctx.poolChain.addEvent('TicketBought', purchase());
    expect((await settle(sig)).events[0]).toMatchObject({ outcome: 'applied', detail: 'no order' });
    expect((await ctx.pools.findById(1))?.snapshot()).toMatchObject({ ticketsSold: 2 });
  });

  it('still unknown on chain → recorded as unmatched; not visible yet → pending; failed transaction → invalid', async () => {
    const { ctx, settle } = setup();
    const sig = ctx.poolChain.addEvent('TicketBought', purchase('', { poolId: 9 }));
    expect((await settle(sig)).events[0]).toMatchObject({ outcome: 'unmatched', detail: 'pool 9 is not registered' });
    expect((await ctx.chainEvents.find(sig, 0))?.outcome).toBe('unmatched');
    ctx.poolChain.events.set('later', 'pending');
    expect(await settle('later')).toEqual({ signature: 'later', status: 'pending', detail: null, events: [] });
    ctx.poolChain.events.set('bad', { invalid: 'transaction failed' });
    expect(await settle('bad')).toMatchObject({ status: 'invalid', detail: 'transaction failed' });
  });

  it('PoolFailed then a Refunded: tickets voided, then the refund lands', async () => {
    const { ctx, settle } = setup();
    await ctx.pools.upsert(aPool({ id: 1, minTickets: 5 }, ctx.now()));
    await settle(ctx.poolChain.addEvent('TicketBought', purchase()));
    expect((await settle(ctx.poolChain.addEvent('PoolFailed', { poolId: 1, ticketsSold: 2 }))).events[0]).toMatchObject({ outcome: 'applied' });
    await settle(ctx.poolChain.addEvent('Refunded', { poolId: 1, buyer: BUYER, rentPayer: BUYER, qty: 2, lamports: 100_000_000, refundedTotal: 100_000_000 }));
    expect((await ctx.tickets.find(BUYER, 1))?.snapshot()).toMatchObject({ balance: 0, bought: 0 });
    expect((await ctx.orders.totalsOf(BUYER)).lamports).toBe(0);
  });
});
