import { CommandBus, CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { toTicketOrderDto } from '../../../../domain/economy/ticket-order.dto.js';
import { BadRequestError, NotFoundError } from '../../../../domain/shared/errors.js';
import { RulesConfigPort } from '../../../ports/config/rules-config.port.js';
import { TicketOrderRepositoryPort } from '../../../ports/economy/ticket-order.repository.port.js';
import { SettleChainSignatureCommand, type SettledSignatureDto } from '../../chain/settle-chain-signature/settle-chain-signature.command.js';
import { ConfirmTicketOrderCommand, type ConfirmTicketOrderResultDto } from './confirm-ticket-order.command.js';

/**
 * The fast path after the wallet sent the transaction: settle its signature now instead of waiting for the watcher (the same idempotent settlement – a race
 * with the watcher answers `paid` on both sides). 400 when the transaction failed or did not pay THIS order (a purchase it made is still credited).
 */
@CommandHandler(ConfirmTicketOrderCommand)
export class ConfirmTicketOrderHandler implements ICommandHandler<ConfirmTicketOrderCommand, ConfirmTicketOrderResultDto> {
  constructor(
    private readonly orders: TicketOrderRepositoryPort,
    private readonly commands: CommandBus,
    private readonly rules: RulesConfigPort,
  ) {}

  async execute({ wallet, orderId, signature }: ConfirmTicketOrderCommand): Promise<ConfirmTicketOrderResultDto> {
    const order = await this.orders.findById(orderId);
    if (!order || order.wallet !== wallet) throw new NotFoundError('no such order');
    const ttl = this.rules.get().orderTtlMs;
    if (order.status === 'paid' && order.signature === signature) return { status: 'paid', order: toTicketOrderDto(order, ttl) };
    const settled = await this.commands.execute<SettleChainSignatureCommand, SettledSignatureDto>(new SettleChainSignatureCommand(signature));
    if (settled.status === 'pending') return { status: 'pending', order: toTicketOrderDto(order, ttl) };
    if (settled.status === 'invalid') throw new BadRequestError(`that transaction did not buy tickets: ${settled.detail ?? 'failed'}`, 'transaction_invalid');
    const paid = (await this.orders.findById(orderId))!;
    if (paid.status === 'paid' && paid.signature === signature) return { status: 'paid', order: toTicketOrderDto(paid, ttl) };
    throw new BadRequestError('that transaction does not pay this order (any tickets it bought were credited to their buyer)', 'transaction_mismatch');
  }
}
