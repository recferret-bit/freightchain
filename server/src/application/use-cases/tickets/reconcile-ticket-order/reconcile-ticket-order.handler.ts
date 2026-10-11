import { CommandBus, CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { toTicketOrderDto } from '../../../../domain/economy/ticket-order.dto.js';
import { NotFoundError } from '../../../../domain/shared/errors.js';
import { RulesConfigPort } from '../../../ports/config/rules-config.port.js';
import { ChainPort } from '../../../ports/economy/chain.port.js';
import { TicketOrderRepositoryPort } from '../../../ports/economy/ticket-order.repository.port.js';
import { SettleChainSignatureCommand, type SettledSignatureDto } from '../../chain/settle-chain-signature/settle-chain-signature.command.js';
import { ReconcileTicketOrderCommand, type ReconcileTicketOrderResultDto } from './reconcile-ticket-order.command.js';

/** Same settlement as confirm, but the signature is found from the order's reference instead of posted by the browser that signed. */
@CommandHandler(ReconcileTicketOrderCommand)
export class ReconcileTicketOrderHandler implements ICommandHandler<ReconcileTicketOrderCommand, ReconcileTicketOrderResultDto> {
  constructor(
    private readonly orders: TicketOrderRepositoryPort,
    private readonly chain: ChainPort,
    private readonly commands: CommandBus,
    private readonly rules: RulesConfigPort,
  ) {}

  async execute({ wallet, orderId }: ReconcileTicketOrderCommand): Promise<ReconcileTicketOrderResultDto> {
    const order = await this.orders.findById(orderId);
    if (!order || order.wallet !== wallet) throw new NotFoundError('no such order');
    const ttl = this.rules.get().orderTtlMs;
    if (order.status === 'paid') return { status: 'paid', order: toTicketOrderDto(order, ttl) };
    if (!order.paymentReference) return { status: 'not_found', order: toTicketOrderDto(order, ttl) };
    const sigs = await this.chain.signaturesForAddress(order.paymentReference, 10);
    if (sigs.length === 0) return { status: 'not_found', order: toTicketOrderDto(order, ttl) };
    let pending = false;
    let latest = order;
    for (const { signature } of sigs) {
      const settled = await this.commands.execute<SettleChainSignatureCommand, SettledSignatureDto>(new SettleChainSignatureCommand(signature));
      const fresh = await this.orders.findById(orderId);
      if (fresh) latest = fresh;
      if (latest.status === 'paid') return { status: 'paid', order: toTicketOrderDto(latest, ttl) };
      if (settled.status === 'pending') pending = true;
    }
    return { status: pending ? 'pending' : 'not_found', order: toTicketOrderDto(latest, ttl) };
  }
}
