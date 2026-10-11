import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { TicketOrder } from '../../../../domain/economy/ticket-order.entity.js';
import { toTicketOrderDto, type TicketOrderDto } from '../../../../domain/economy/ticket-order.dto.js';
import { NotFoundError, ServiceUnavailableError } from '../../../../domain/shared/errors.js';
import { RulesConfigPort } from '../../../ports/config/rules-config.port.js';
import { PoolRepositoryPort } from '../../../ports/economy/pool.repository.port.js';
import { TicketOrderRepositoryPort } from '../../../ports/economy/ticket-order.repository.port.js';
import { PlayerRepositoryPort } from '../../../ports/players/player.repository.port.js';
import { RideTicketRepositoryPort } from '../../../ports/players/ride-ticket.repository.port.js';
import { ClockPort } from '../../../ports/shared/clock.port.js';
import { EntropyPort } from '../../../ports/shared/entropy.port.js';
import { TransactionPort } from '../../../ports/shared/transaction.port.js';
import { PlayerSessionService } from '../../../services/player-session.service.js';
import { CreateTicketOrderCommand } from './create-ticket-order.command.js';

/**
 * "n tickets of pool X" – priced by the pool (no quote to expire). A wallet has at most ONE order awaiting payment: asking again for the same pool and quantity
 * hands it back, anything else lets it lapse (a late payment of a lapsed order is still honoured by the settlement). Runs under the wallet's player lock.
 * The program enforces the per-wallet cap and the sale window again; this only gives a readable 409 first.
 */
@CommandHandler(CreateTicketOrderCommand)
export class CreateTicketOrderHandler implements ICommandHandler<CreateTicketOrderCommand, TicketOrderDto> {
  constructor(
    private readonly players: PlayerRepositoryPort,
    private readonly pools: PoolRepositoryPort,
    private readonly tickets: RideTicketRepositoryPort,
    private readonly orders: TicketOrderRepositoryPort,
    private readonly sessions: PlayerSessionService,
    private readonly rules: RulesConfigPort,
    private readonly transactions: TransactionPort,
    private readonly clock: ClockPort,
    private readonly entropy: EntropyPort,
  ) {}

  async execute({ wallet, poolId, qty }: CreateTicketOrderCommand): Promise<TicketOrderDto> {
    const rules = this.rules.get();
    if (rules.paymentMode !== 'program' || !rules.programId) throw new ServiceUnavailableError('ticket sales are not configured on this server (no pool program)');
    await this.sessions.touch(wallet);
    return this.transactions.run(async (tx) => {
      const now = this.clock.now();
      const player = await this.players.findByWalletForUpdate(wallet, tx);
      if (!player) throw new NotFoundError('player not found');
      player.requirePaidPlay(); // before a new order and before handing back the live one
      const pool = await this.pools.findById(poolId, tx);
      if (!pool) throw new NotFoundError('no such pool');
      const live = await this.orders.findAwaitingByWallet(wallet, tx);
      if (live?.isLive(now, rules.orderTtlMs) && live.poolId === poolId && live.qty === qty) return toTicketOrderDto(live, rules.orderTtlMs);
      if (live) { live.expire(); await this.orders.save(live, tx); }
      const walletBought = (await this.tickets.find(wallet, poolId, tx))?.bought ?? 0;
      const order = TicketOrder.create({ id: this.entropy.uuid(), wallet, pool, qty, walletBought, now });
      await this.orders.insert(order, tx);
      return toTicketOrderDto(order, rules.orderTtlMs);
    });
  }
}
