import { CommandBus, CommandHandler, QueryBus, QueryHandler, type ICommandHandler, type IQueryHandler } from '@nestjs/cqrs';
import { sellableOffers, shiftCard, buyTx, type ActionCard, type ActionTx, type SellableTier } from '../../../domain/actions/action-card.js';
import type { PaidTierId } from '../../../domain/rides/ride-tier.js';
import { ConflictError, ServiceUnavailableError } from '../../../domain/shared/errors.js';
import type { TicketOrderDto } from '../../../domain/economy/ticket-order.dto.js';
import { RulesConfigPort } from '../../ports/config/rules-config.port.js';
import { PoolRepositoryPort } from '../../ports/economy/pool.repository.port.js';
import { PlayerRepositoryPort } from '../../ports/players/player.repository.port.js';
import { ClockPort } from '../../ports/shared/clock.port.js';
import { CreateTicketOrderCommand } from '../tickets/create-ticket-order/create-ticket-order.command.js';
import { GetTicketPaymentQuery, type TicketPaymentDto } from '../tickets/get-ticket-payment/get-ticket-payment.query.js';
import { GetShiftActionQuery } from './get-shift-action.query.js';
import { PrepareShiftActionCommand } from './prepare-shift-action.command.js';

@QueryHandler(GetShiftActionQuery)
export class GetShiftActionHandler implements IQueryHandler<GetShiftActionQuery, ActionCard> {
  constructor(private readonly rules: RulesConfigPort, private readonly pools: PoolRepositoryPort, private readonly clock: ClockPort) {}

  async execute({ tier }: GetShiftActionQuery): Promise<ActionCard> {
    return shiftCard(this.rules.get().appOrigin, await offers(this.pools, this.clock, this.rules.get(), tier));
  }
}

@CommandHandler(PrepareShiftActionCommand)
export class PrepareShiftActionHandler implements ICommandHandler<PrepareShiftActionCommand, ActionTx> {
  constructor(
    private readonly rules: RulesConfigPort,
    private readonly pools: PoolRepositoryPort,
    private readonly clock: ClockPort,
    private readonly players: PlayerRepositoryPort,
    private readonly commands: CommandBus,
    private readonly queries: QueryBus,
  ) {}

  async execute({ account, tier }: PrepareShiftActionCommand): Promise<ActionTx> {
    const rules = this.rules.get();
    if (rules.paymentMode !== 'program' || !rules.programId) throw new ServiceUnavailableError('ticket sales are not configured on this server (no pool program)');
    const offer = (await offers(this.pools, this.clock, rules, tier))[0];
    if (!offer) throw new ConflictError('this pool is not selling tickets right now', 'not_sellable');
    // CreateTicketOrder touches the wallet first and would mint a player (and the signup grant) for a key that never signed in.
    const player = await this.players.findByWallet(account);
    if (!player?.paidPlayAllowed) throw new ConflictError('accept the 18+ and loss offer on your profile before a paid shift', 'agreements_required');
    const order = await this.commands.execute<CreateTicketOrderCommand, TicketOrderDto>(new CreateTicketOrderCommand(account, offer.poolId, 1));
    const payment = await this.queries.execute<GetTicketPaymentQuery, TicketPaymentDto>(new GetTicketPaymentQuery(account, order.id));
    return buyTx(rules.appOrigin, tier, offer.poolId, payment.transaction);
  }
}

async function offers(pools: PoolRepositoryPort, clock: ClockPort, rules: { paymentMode: string; programId: string }, tier: PaidTierId | null): Promise<SellableTier[]> {
  if (rules.paymentMode !== 'program' || !rules.programId) return [];
  return sellableOffers(await pools.listLive(), clock.now(), tier);
}
