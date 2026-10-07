import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { verifyPayment } from '../../../../domain/economy/payment-verification.js';
import { toRideDto } from '../../../../domain/rides/ride.dto.js';
import { RideStatus } from '../../../../domain/rides/ride-status.js';
import { BadRequestError, ConflictError } from '../../../../domain/shared/errors.js';
import { RulesConfigPort } from '../../../ports/config/rules-config.port.js';
import { ChainPort } from '../../../ports/economy/chain.port.js';
import { PaymentRepositoryPort } from '../../../ports/economy/payment.repository.port.js';
import { PaymentSettlementService } from '../../../services/payment-settlement.service.js';
import { RideLookupService } from '../../../services/ride-lookup.service.js';
import { ConfirmPaymentCommand, type ConfirmPaymentResultDto } from './confirm-payment.command.js';

/**
 * The buyer says "I paid with this transaction". A matching payment is honoured EVEN AFTER the quote expired – money in flight must not be refused.
 * The signature is unique: one transaction pays one ride.
 */
@CommandHandler(ConfirmPaymentCommand)
export class ConfirmPaymentHandler implements ICommandHandler<ConfirmPaymentCommand, ConfirmPaymentResultDto> {
  constructor(
    private readonly lookup: RideLookupService,
    private readonly payments: PaymentRepositoryPort,
    private readonly chain: ChainPort,
    private readonly settlement: PaymentSettlementService,
    private readonly rules: RulesConfigPort,
  ) {}

  async execute({ wallet, rideId, signature }: ConfirmPaymentCommand): Promise<ConfirmPaymentResultDto> {
    const ride = await this.lookup.require(rideId, wallet);
    const paid = await this.payments.findByRide(ride.id);
    if (paid) {
      if (paid.signature === signature) return { status: 'paid', ride: toRideDto(ride) };
      throw new ConflictError('this ride is already paid');
    }
    if (!ride.isInStatus(RideStatus.AwaitingPayment, RideStatus.Expired)) throw new ConflictError(`ride is ${ride.status}`);
    if (await this.payments.findBySignature(signature)) throw new ConflictError('this transaction already paid for a ride');

    const tx = await this.chain.getTransaction(signature);
    if (!tx) return { status: 'pending' };
    const why = verifyPayment(tx, { wallet, treasury: this.rules.get().treasury, lamports: ride.lamports, memo: ride.id });
    if (why) throw new BadRequestError(why);
    return { status: 'paid', ride: await this.settlement.settle(ride.id, wallet, signature) };
  }
}
