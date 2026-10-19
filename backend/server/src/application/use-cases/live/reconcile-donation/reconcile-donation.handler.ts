import { CommandBus, CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import type { ConfirmDonationResultDto } from '../../../../domain/live/live.dto.js';
import { BadRequestError, ConflictError, NotFoundError } from '../../../../domain/shared/errors.js';
import { ChainPort } from '../../../ports/economy/chain.port.js';
import { DonationOrderRepositoryPort } from '../../../ports/live/donation-order.repository.port.js';
import { ConfirmDonationCommand } from '../confirm-donation/confirm-donation.command.js';
import { ReconcileDonationCommand, type ReconcileDonationResultDto } from './reconcile-donation.command.js';

/** A signature that does not pay this donation is skipped. The first one that does is confirmed the usual way. */
@CommandHandler(ReconcileDonationCommand)
export class ReconcileDonationHandler implements ICommandHandler<ReconcileDonationCommand, ReconcileDonationResultDto> {
  constructor(
    private readonly orders: DonationOrderRepositoryPort,
    private readonly chain: ChainPort,
    private readonly commands: CommandBus,
  ) {}

  async execute({ wallet, rideId, orderId }: ReconcileDonationCommand): Promise<ReconcileDonationResultDto> {
    const order = await this.orders.findById(orderId);
    if (!order || order.wallet !== wallet || order.rideId !== rideId) throw new NotFoundError('donation not found');
    if (order.status === 'paid' && order.signature) {
      return this.commands.execute<ConfirmDonationCommand, ConfirmDonationResultDto>(new ConfirmDonationCommand(wallet, rideId, orderId, order.signature));
    }
    if (!order.paymentReference) return { status: 'not_found' };
    const sigs = await this.chain.signaturesForAddress(order.paymentReference, 10);
    if (sigs.length === 0) return { status: 'not_found' };
    let pending = false;
    for (const { signature } of sigs) {
      try {
        const result = await this.commands.execute<ConfirmDonationCommand, ConfirmDonationResultDto>(new ConfirmDonationCommand(wallet, rideId, orderId, signature));
        if (result.status === 'paid') return result;
        pending = true;
      } catch (error) {
        if (error instanceof ConflictError) {
          const again = await this.orders.findById(orderId); // the desktop confirm won the race
          if (again?.status === 'paid' && again.signature) return this.commands.execute<ConfirmDonationCommand, ConfirmDonationResultDto>(new ConfirmDonationCommand(wallet, rideId, orderId, again.signature));
        }
        if (!(error instanceof BadRequestError)) throw error; // a different transaction that merely mentions the reference
      }
    }
    return pending ? { status: 'pending' } : { status: 'not_found' };
  }
}
