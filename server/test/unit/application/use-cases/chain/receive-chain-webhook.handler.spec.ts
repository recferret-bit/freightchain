import { ReceiveChainWebhookCommand } from '../../../../../src/application/use-cases/chain/receive-chain-webhook/receive-chain-webhook.command.js';
import { ReceiveChainWebhookHandler } from '../../../../../src/application/use-cases/chain/receive-chain-webhook/receive-chain-webhook.handler.js';
import { SettleChainSignatureCommand } from '../../../../../src/application/use-cases/chain/settle-chain-signature/settle-chain-signature.command.js';
import { SettleChainSignatureHandler } from '../../../../../src/application/use-cases/chain/settle-chain-signature/settle-chain-signature.handler.js';
import { TREASURY } from '../../../../support/fake-chain.js';
import { aPool } from '../../../../support/pools.js';
import { unitContext } from '../../../../support/unit-context.js';

describe('ReceiveChainWebhookHandler', () => {
  const setup = async () => {
    const ctx = unitContext();
    const settle = new SettleChainSignatureHandler(ctx.poolChain, ctx.chainEvents, ctx.ticketSettlement, ctx.registry, ctx.clock);
    const sent: string[] = [];
    const bus = { execute: async (c: SettleChainSignatureCommand) => { sent.push(c.signature); return settle.execute(c); } };
    await ctx.pools.upsert(aPool({ id: 1, status: 'open', minTickets: 10 }, ctx.now()));
    const handler = new ReceiveChainWebhookHandler(bus as never);
    return { ctx, sent, receive: (sigs: string[]) => handler.execute(new ReceiveChainWebhookCommand(sigs)) };
  };

  it('settles each signature in order from the chain; counts settled, pending and the rest', async () => {
    const { ctx, sent, receive } = await setup();
    const a = ctx.poolChain.addEvent('TicketBought', { poolId: 1, buyer: TREASURY, qty: 1, lamports: 50_000_000, orderId: '', ticketsSold: 1, activated: false });
    ctx.poolChain.events.set('bad', { invalid: 'transaction failed' });
    expect(await receive([a, 'later', 'bad'])).toEqual({ received: 3, settled: 1, pending: 1 });
    expect(sent).toEqual([a, 'later', 'bad']);
    expect((await ctx.tickets.find(TREASURY, 1))?.balance).toBe(1);
    expect(await receive([a])).toEqual({ received: 1, settled: 1, pending: 0 }); // a re-delivery: settled again, credited once
    expect((await ctx.tickets.find(TREASURY, 1))?.balance).toBe(1);
  });

  it('an empty delivery settles nothing; the RPC down fails the delivery (the provider re-delivers)', async () => {
    const { ctx, receive } = await setup();
    expect(await receive([])).toEqual({ received: 0, settled: 0, pending: 0 });
    ctx.poolChain.rpcDown = true;
    await expect(receive(['x'])).rejects.toMatchObject({ statusCode: 503 });
  });
});
