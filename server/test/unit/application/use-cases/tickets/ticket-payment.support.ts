import { Keypair } from '@solana/web3.js';
import { CommandBus } from '@nestjs/cqrs';
import { SettleChainSignatureHandler } from '../../../../../src/application/use-cases/chain/settle-chain-signature/settle-chain-signature.handler.js';
import { SettleChainSignatureCommand } from '../../../../../src/application/use-cases/chain/settle-chain-signature/settle-chain-signature.command.js';
import { TicketOrder } from '../../../../../src/domain/economy/ticket-order.entity.js';
import { FixedRules, unitContext, unitRules } from '../../../../support/unit-context.js';
import { aPool } from '../../../../support/pools.js';

/** Shared setup of the payment / confirm specs: a program-mode server, one open pool, a buyer with a real keypair and one live order. */
export async function paymentSetup(over: Parameters<typeof unitRules>[0] = {}) {
  const rules = unitRules({ paymentMode: 'program', programId: '9e7phdJzKMNJX8ZnqR8SdxNzafNJjYXeZNsjQze3BSvx', ...over });
  const ctx = unitContext(rules);
  const buyer = Keypair.generate();
  const wallet = buyer.publicKey.toBase58();
  await ctx.pools.upsert(aPool({ id: 1, minTickets: 2 }, ctx.now()));
  await ctx.player(wallet);
  const order = TicketOrder.create({ id: '00000000-0000-4000-8000-0000000000b1', wallet, pool: (await ctx.pools.findById(1))!, qty: 2, walletBought: 0, now: ctx.now() });
  await ctx.orders.insert(order);
  const settle = new SettleChainSignatureHandler(ctx.poolChain, ctx.chainEvents, ctx.ticketSettlement, ctx.registry, ctx.clock);
  /** a CommandBus that only knows SettleChainSignatureCommand */
  const bus = { execute: (c: unknown) => (c instanceof SettleChainSignatureCommand ? settle.execute(c) : Promise.reject(new Error('unexpected command'))) } as unknown as CommandBus;
  const purchaseOf = (orderId: string, over2: Record<string, unknown> = {}) => ({ kind: 'TicketBought' as const, poolId: 1, buyer: wallet, qty: 2, lamports: 100_000_000, orderId, ticketsSold: 2, activated: true, ...over2 });
  return { ctx, rules: new FixedRules(rules), buyer, wallet, order, bus, purchaseOf };
}
