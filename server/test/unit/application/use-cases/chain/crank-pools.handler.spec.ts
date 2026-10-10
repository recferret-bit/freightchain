import type { CommandBus } from '@nestjs/cqrs';
import { CrankPoolsHandler } from '../../../../../src/application/use-cases/chain/crank-pools/crank-pools.handler.js';
import { SettleChainSignatureCommand } from '../../../../../src/application/use-cases/chain/settle-chain-signature/settle-chain-signature.command.js';
import { SettleChainSignatureHandler } from '../../../../../src/application/use-cases/chain/settle-chain-signature/settle-chain-signature.handler.js';
import { SETTLE_GRACE_MS } from '../../../../../src/domain/economy/pool-crank.js';
import { FakePoolCrankChain } from '../../../../support/fake-pool-crank-chain.js';
import { chainPool } from '../../../../support/pools.js';
import { unitContext } from '../../../../support/unit-context.js';

describe('CrankPoolsHandler', () => {
  const setup = () => {
    const ctx = unitContext();
    const crank = new FakePoolCrankChain(ctx.poolChain);
    crank.crankAddress = 'Crank1111111111111111111111111111111111111';
    crank.now = ctx.now();
    const settle = new SettleChainSignatureHandler(ctx.poolChain, ctx.chainEvents, ctx.ticketSettlement, ctx.registry, ctx.clock);
    const settled: string[] = [];
    const bus = { execute: async (c: object) => { if (!(c instanceof SettleChainSignatureCommand)) throw new Error('unexpected command'); settled.push(c.signature); return settle.execute(c); } };
    const handler = new CrankPoolsHandler(crank, ctx.poolChain, bus as unknown as CommandBus);
    const tickets = (n: number, price: number) => Array.from({ length: n }, (_, i) => ({ buyer: `Buyer${i}`, rentPayer: i % 2 ? 'Sponsor' : `Buyer${i}`, lamports: price }));
    return { ctx, crank, handler, settled, tickets, run: () => handler.execute() };
  };

  it('without CRANK_SECRET it does nothing (the lobby\'s CLAIM REFUND still works)', async () => {
    const { crank, run } = setup();
    crank.crankAddress = null;
    expect(await run()).toEqual({ enabled: false, crank: null, chainNow: null, actions: [] });
    expect(crank.sent).toEqual([]);
  });

  it('a pool that missed its goal: fail_pool, every ticket refunded in batches of 8, then closed – each step settled into the mirror', async () => {
    const { ctx, crank, run, settled, tickets } = setup();
    ctx.poolChain.pools.set(1, chainPool(ctx.now(), { poolId: 1, status: 'open', prepDeadline: new Date(ctx.now().getTime() - 1), ticketsSold: 10, minTickets: 20, priceLamports: 50_000_000 }));
    crank.tickets.set(1, tickets(10, 50_000_000));
    const pass = await run();
    expect(pass).toMatchObject({ enabled: true, crank: crank.crankAddress, chainNow: ctx.now().getTime() });
    expect(pass.actions.map((a) => [a.step, a.tickets, a.error])).toEqual([['fail_pool', 0, null], ['refund', 8, null], ['refund', 2, null], ['close_pool', 0, null]]);
    expect(pass.actions.every((a) => a.settled === 'done')).toBe(true);
    expect(settled).toHaveLength(4);
    expect(ctx.poolChain.pools.get(1)).toMatchObject({ status: 'cancelled', refunded: 500_000_000 });
    expect((await ctx.pools.findById(1))?.snapshot().status).toBe('cancelled'); // the mirror followed (registered from chain on the first event)
    expect(await run()).toMatchObject({ actions: [] }); // nothing left: a second pass is a no-op
  });

  it('an active pool 14 days past its play deadline with no prize paid expires and refunds; one that paid a prize is left to the admin', async () => {
    const { ctx, crank, run, tickets } = setup();
    const old = new Date(ctx.now().getTime() - SETTLE_GRACE_MS - 1);
    ctx.poolChain.pools.set(2, chainPool(ctx.now(), { poolId: 2, status: 'active', playDeadline: old, prepDeadline: old, ticketsSold: 2, minTickets: 1, priceLamports: 50_000_000 }));
    ctx.poolChain.pools.set(3, chainPool(ctx.now(), { poolId: 3, status: 'active', playDeadline: old, prepDeadline: old, ticketsSold: 1, minTickets: 1, prizesPaid: 10_000_000 }));
    crank.tickets.set(2, tickets(2, 50_000_000));
    const pass = await run();
    expect(pass.actions.map((a) => `${a.step}#${a.poolId}`)).toEqual(['expire_pool#2', 'refund#2', 'close_pool#2']);
    expect(ctx.poolChain.pools.get(2)?.status).toBe('cancelled');
    expect(ctx.poolChain.pools.get(3)?.status).toBe('active');
  });

  it('judges deadlines by the CHAIN clock, not the server\'s', async () => {
    const { ctx, crank, run } = setup();
    ctx.poolChain.pools.set(1, chainPool(ctx.now(), { poolId: 1, status: 'open', prepDeadline: ctx.now(), ticketsSold: 1, minTickets: 5 }));
    crank.now = new Date(ctx.now().getTime() - 1_000); // the chain is a second behind the server
    expect((await run()).actions).toEqual([]);
  });

  it('a step the chain refuses stops that pool for this pass (reported, retried next pass); other pools still get cranked', async () => {
    const { ctx, crank, run, tickets } = setup();
    for (const id of [4, 5]) ctx.poolChain.pools.set(id, chainPool(ctx.now(), { poolId: id, status: 'refunding', ticketsSold: 1, priceLamports: 50_000_000, refunded: 0 }));
    crank.tickets.set(4, tickets(1, 50_000_000)); crank.tickets.set(5, tickets(1, 50_000_000));
    crank.failing.add('refund@4');
    const pass = await run();
    expect(pass.actions.map((a) => [a.step, a.poolId, a.error === null])).toEqual([['refund', 4, false], ['refund', 5, true], ['close_pool', 5, true]]);
    expect(pass.actions[0]?.error).toMatch(/would fail/);
    expect(ctx.poolChain.pools.get(4)?.status).toBe('refunding');
  });

  it('a refused read of one pool\'s tickets (getProgramAccounts) stops that pool only: the pass does not throw and the pools after it are still cranked', async () => {
    const { ctx, crank, run, tickets } = setup();
    ctx.poolChain.pools.set(7, chainPool(ctx.now(), { poolId: 7, status: 'refunding', ticketsSold: 2, priceLamports: 50_000_000, refunded: 0 }));
    ctx.poolChain.pools.set(8, chainPool(ctx.now(), { poolId: 8, status: 'refunding', ticketsSold: 0, priceLamports: 50_000_000, refunded: 0 }));
    crank.tickets.set(7, tickets(2, 50_000_000));
    crank.unreadable.add(7);
    const pass = await run();
    expect(pass.actions.map((a) => [a.step, a.poolId, a.error === null])).toEqual([['refund', 7, false], ['close_pool', 8, true]]);
    expect(pass.actions[0]?.error).toMatch(/unavailable/);
    expect(ctx.poolChain.pools.get(7)?.status).toBe('refunding'); // retried next pass
    crank.unreadable.clear();
    expect((await run()).actions.map((a) => a.step)).toEqual(['refund', 'close_pool']); // the next pass finishes it
  });

  it('a refunding pool that owes refunds but has no Ticket account left is reported, not looped on', async () => {
    const { ctx, crank, run } = setup();
    ctx.poolChain.pools.set(6, chainPool(ctx.now(), { poolId: 6, status: 'refunding', ticketsSold: 2, priceLamports: 50, refunded: 50 }));
    const pass = await run();
    expect(pass.actions).toHaveLength(1);
    expect(pass.actions[0]).toMatchObject({ poolId: 6, step: 'refund', signature: null });
    expect(crank.sent).toEqual([]);
  });
});
