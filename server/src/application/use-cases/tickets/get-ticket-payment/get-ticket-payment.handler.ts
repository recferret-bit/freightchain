import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import type { TicketOrder } from '../../../../domain/economy/ticket-order.entity.js';
import { ConflictError, NotFoundError } from '../../../../domain/shared/errors.js';
import { RulesConfigPort } from '../../../ports/config/rules-config.port.js';
import { PoolChainPort } from '../../../ports/economy/pool-chain.port.js';
import { TicketOrderRepositoryPort } from '../../../ports/economy/ticket-order.repository.port.js';
import { PlayerRepositoryPort } from '../../../ports/players/player.repository.port.js';
import { ClockPort } from '../../../ports/shared/clock.port.js';
import { TransactionPort, type TransactionHandle } from '../../../ports/shared/transaction.port.js';
import { GetTicketPaymentQuery, type TicketPaymentDto } from './get-ticket-payment.query.js';

/**
 * Builds the order's buy_ticket transaction (a fresh blockhash per call, the wallet is the fee payer and the Ticket rent payer) and keeps its message on the order.
 * The RPC call happens OUTSIDE the player lock; the message is attached under it, after re-checking the order is still live.
 */
@QueryHandler(GetTicketPaymentQuery)
export class GetTicketPaymentHandler implements IQueryHandler<GetTicketPaymentQuery, TicketPaymentDto> {
  constructor(
    private readonly orders: TicketOrderRepositoryPort,
    private readonly players: PlayerRepositoryPort,
    private readonly chain: PoolChainPort,
    private readonly rules: RulesConfigPort,
    private readonly transactions: TransactionPort,
    private readonly clock: ClockPort,
  ) {}

  async execute({ wallet, orderId }: GetTicketPaymentQuery): Promise<TicketPaymentDto> {
    const rules = this.rules.get();
    const order = this.mustBeLive(await this.orders.findById(orderId), wallet);
    await this.requirePaidPlay(wallet); // before the RPC build, and again under the lock before the message is attached
    const tx = await this.chain.buildBuyTransaction({ payer: wallet, poolId: order.poolId, qty: order.qty, orderId: order.id });
    await this.transactions.run(async (handle) => {
      await this.requirePaidPlay(wallet, handle);
      const fresh = this.mustBeLive(await this.orders.findById(orderId, handle), wallet);
      fresh.attachTransaction(tx.message, tx.lastValidBlockHeight);
      await this.orders.save(fresh, handle);
    });
    return {
      orderId: order.id, mode: 'program', programId: rules.programId, poolId: order.poolId, lamports: order.lamports, transaction: tx.transaction, message: tx.message,
      feePayer: tx.feePayer, computeUnits: tx.computeUnits, priorityMicrolamports: tx.priorityMicrolamports, blockhash: tx.blockhash,
      lastValidBlockHeight: tx.lastValidBlockHeight,
    };
  }

  private async requirePaidPlay(wallet: string, tx?: TransactionHandle) {
    const player = tx ? await this.players.findByWalletForUpdate(wallet, tx) : await this.players.findByWallet(wallet);
    if (!player) throw new NotFoundError('player not found');
    player.requirePaidPlay();
  }

  private mustBeLive(order: TicketOrder | null, wallet: string): TicketOrder {
    if (!order || order.wallet !== wallet) throw new NotFoundError('no such order');
    if (!order.isLive(this.clock.now(), this.rules.get().orderTtlMs)) throw new ConflictError(`order is ${order.status === 'awaiting_payment' ? 'expired' : order.status}`, 'order_closed');
    return order;
  }
}
