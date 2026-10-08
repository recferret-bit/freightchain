import { FinalityService } from '../../../../src/application/services/finality.service.js';
import { SettleChainSignatureHandler } from '../../../../src/application/use-cases/chain/settle-chain-signature/settle-chain-signature.handler.js';
import { SettleChainSignatureCommand } from '../../../../src/application/use-cases/chain/settle-chain-signature/settle-chain-signature.command.js';
import { TicketOrder } from '../../../../src/domain/economy/ticket-order.entity.js';
import { TREASURY } from '../../../support/fake-chain.js';
import { aPool, chainPool } from '../../../support/pools.js';
import { unitContext } from '../../../support/unit-context.js';

const BUYER = TREASURY;

describe('FinalityService', () => {
  const setup = async () => {
    const ctx = unitContext();
    const finality = new FinalityService(ctx.poolChain, ctx.chainEvents, ctx.orders, ctx.players, ctx.pools, ctx.tickets, ctx.registry, ctx.transactions, ctx.clock);
    const handler = new SettleChainSignatureHandler(ctx.poolChain, ctx.chainEvents, ctx.ticketSettlement, ctx.registry, ctx.clock);
    const settle = (sig: string) => handler.execute(new SettleChainSignatureCommand(sig));
    await ctx.pools.upsert(aPool({ id: 1, status: 'active', minTickets: 2, ticketsSold: 2 }, ctx.now()));
    await ctx.player(BUYER);
    /** an order whose transaction the server built (last valid block height 250, the fake's default) */
    const order = async () => {
      const o = TicketOrder.create({ id: ctx.entropy.uuid(), wallet: BUYER, pool: (await ctx.pools.findById(1))!, qty: 2, walletBought: 0, now: ctx.now() });
      o.attachTransaction('bWVzc2FnZQ==', 250);
      await ctx.orders.insert(o);
      return o;
    };
    const buy = (orderId = '', sold = 4) => ctx.poolChain.addEvent('TicketBought', { poolId: 1, buyer: BUYER, qty: 2, lamports: 100_000_000, orderId, ticketsSold: sold, activated: false });
    return { ctx, finality, settle, order, buy };
  };

  it('finalized: every event of the transaction is stamped and leaves the work list', async () => {
    const { ctx, finality, settle, order, buy } = await setup();
    const sig = buy((await order()).id);
    await settle(sig);
    expect(await finality.pass()).toEqual({ checked: 1, finalized: 0, dropped: 0, waiting: 1 }); // confirmed / unknown: asked again
    ctx.poolChain.statuses.set(sig, 'finalized');
    expect(await finality.pass()).toEqual({ checked: 1, finalized: 1, dropped: 0, waiting: 0 });
    expect((await ctx.chainEvents.find(sig, 0))?.finalizedAt).toEqual(ctx.now());
    expect(await finality.pass()).toEqual({ checked: 0, finalized: 0, dropped: 0, waiting: 0 });
  });

  it('expired (judged by the order\'s block height): dropped, the order reopened, the tickets voided with an audit line, the pool re-synced from chain', async () => {
    const { ctx, finality, settle, order, buy } = await setup();
    const o = await order();
    const sig = buy(o.id);
    expect((await settle(sig)).events[0]?.outcome).toBe('settled');
    expect((await ctx.tickets.find(BUYER, 1))?.snapshot()).toMatchObject({ balance: 2, bought: 2 });
    ctx.poolChain.pools.set(1, chainPool(ctx.now(), { status: 'active', ticketsSold: 2, buyers: 1, minTickets: 2, escrowLamports: 100_000_000 }));
    ctx.poolChain.blockHeight = 251; // past 250, and the signature is unknown to the network
    expect(await finality.pass()).toEqual({ checked: 1, finalized: 0, dropped: 1, waiting: 0 });
    expect(await ctx.chainEvents.find(sig, 0)).toMatchObject({ outcome: 'dropped', finalizedAt: null });
    expect((await ctx.orders.findById(o.id))?.snapshot()).toMatchObject({ status: 'awaiting_payment', signature: null, paidAt: null });
    expect((await ctx.tickets.find(BUYER, 1))?.snapshot()).toMatchObject({ balance: 0, bought: 0 });
    expect((await ctx.tickets.recentGrants(BUYER, 1))[0]).toMatchObject({ delta: -2, source: 'void', ref: sig });
    expect((await ctx.pools.findById(1))?.snapshot()).toMatchObject({ ticketsSold: 2, syncedAt: ctx.now() });
    expect(await finality.pass()).toEqual({ checked: 0, finalized: 0, dropped: 0, waiting: 0 });
  });

  it('a ticket already ridden stays ridden; only the unused one is voided', async () => {
    const { ctx, finality, settle, order, buy } = await setup();
    const sig = buy((await order()).id);
    await settle(sig);
    const t = (await ctx.tickets.find(BUYER, 1))!;
    t.spend();
    await ctx.tickets.save(t);
    ctx.poolChain.blockHeight = 251;
    await finality.pass();
    expect((await ctx.tickets.find(BUYER, 1))?.snapshot()).toMatchObject({ balance: 0, bought: 0 });
    expect((await ctx.tickets.recentGrants(BUYER, 1))[0]).toMatchObject({ delta: -1, source: 'void' });
  });

  it('an adopted purchase (no matching order) is closed as expired, not reopened as a live order', async () => {
    const { ctx, finality, settle, buy } = await setup();
    const sig = buy();
    const r = await settle(sig);
    expect(r.events[0]).toMatchObject({ outcome: 'applied', detail: 'no order' });
    ctx.db.chainEvents[0]!.lastValidBlockHeight = 250; // events recorded with their height (a future settle path) are judged by it
    ctx.poolChain.blockHeight = 251;
    expect((await finality.pass()).dropped).toBe(1);
    expect((await ctx.orders.findById(r.events[0]!.orderId!))?.status).toBe('expired');
    expect((await ctx.orders.findAwaitingByWallet(BUYER))).toBeNull();
    expect((await ctx.tickets.find(BUYER, 1))?.snapshot()).toMatchObject({ balance: 0, bought: 0 });
  });

  it('no block height to judge expiry by (adopted purchase, pool events): never dropped, however high the chain gets', async () => {
    const { ctx, finality, settle, buy } = await setup();
    await settle(buy());
    await settle(ctx.poolChain.addEvent('Sponsored', { poolId: 1, sponsor: BUYER, lamports: 10, sponsoredTotal: 10 }));
    ctx.poolChain.blockHeight = 1e12;
    expect(await finality.pass()).toEqual({ checked: 2, finalized: 0, dropped: 0, waiting: 2 });
    expect((await ctx.tickets.find(BUYER, 1))?.balance).toBe(2);
  });

  it('a drop is idempotent: a second drop of the same rows changes nothing', async () => {
    const { ctx, finality, settle, order, buy } = await setup();
    const sig = buy((await order()).id);
    await settle(sig);
    const rows = await ctx.chainEvents.listUnfinalized(10);
    expect(await finality.drop(sig, rows)).toBe(2);
    expect(await finality.drop(sig, rows)).toBe(0);
    expect((await ctx.tickets.recentGrants(BUYER, 10)).filter((g) => g.source === 'void')).toHaveLength(1);
  });

  it('a pool event of a dropped transaction is dropped and the pool re-synced (the chain wins); a failed re-sync is left to the periodic sync', async () => {
    const { ctx, finality, settle } = await setup();
    const sig = ctx.poolChain.addEvent('Sponsored', { poolId: 1, sponsor: BUYER, lamports: 10, sponsoredTotal: 10 });
    await settle(sig);
    ctx.db.chainEvents[0]!.lastValidBlockHeight = 250;
    ctx.poolChain.blockHeight = 251;
    expect((await finality.pass()).dropped).toBe(1); // no account to read (readPool → null): nothing to sync, no error
    expect((await ctx.chainEvents.find(sig, 0))?.outcome).toBe('dropped');
  });

  it('the RPC down ends the pass with a 503 (asked again next poll)', async () => {
    const { ctx, finality, settle, order, buy } = await setup();
    await settle(buy((await order()).id));
    ctx.poolChain.rpcDown = true;
    await expect(finality.pass()).rejects.toMatchObject({ statusCode: 503 });
  });
});
