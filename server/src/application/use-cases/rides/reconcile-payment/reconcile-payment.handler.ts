import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { memoMentions, verifyPayment } from '../../../../domain/economy/payment-verification.js';
import { toRideDto } from '../../../../domain/rides/ride.dto.js';
import { RideStatus } from '../../../../domain/rides/ride-status.js';
import { RulesConfigPort } from '../../../ports/config/rules-config.port.js';
import { ChainPort } from '../../../ports/economy/chain.port.js';
import { PaymentRepositoryPort } from '../../../ports/economy/payment.repository.port.js';
import { PaymentSettlementService } from '../../../services/payment-settlement.service.js';
import { RideLookupService } from '../../../services/ride-lookup.service.js';
import { ReconcilePaymentCommand, type ReconcilePaymentResultDto } from './reconcile-payment.command.js';

const HISTORY_LIMIT = 25;

/** The buyer paid but the confirm call never came (tab closed, network drop): look through the wallet's recent transactions for one that pays this order. */
@CommandHandler(ReconcilePaymentCommand)
export class ReconcilePaymentHandler implements ICommandHandler<ReconcilePaymentCommand, ReconcilePaymentResultDto> {
  constructor(
    private readonly lookup: RideLookupService,
    private readonly payments: PaymentRepositoryPort,
    private readonly chain: ChainPort,
    private readonly settlement: PaymentSettlementService,
    private readonly rules: RulesConfigPort,
  ) {}

  async execute({ wallet, rideId }: ReconcilePaymentCommand): Promise<ReconcilePaymentResultDto> {
    const ride = await this.lookup.require(rideId, wallet);
    if (!ride.isInStatus(RideStatus.AwaitingPayment, RideStatus.Expired)) {
      return { status: ride.isInStatus(RideStatus.Created) && ride.paidAt ? 'paid' : ride.status, ride: toRideDto(ride) };
    }
    const treasury = this.rules.get().treasury;
    for (const { signature, memo } of await this.chain.recentSignatures(wallet, HISTORY_LIMIT)) {
      if (!memoMentions(memo, ride.id)) continue; // only a transaction carrying this ride id can be its payment – usually 0–1 fetches instead of up to 25
      if (await this.payments.findBySignature(signature)) continue;
      const tx = await this.chain.getTransaction(signature);
      if (tx && !verifyPayment(tx, { wallet, treasury, lamports: ride.lamports, memo: ride.id })) {
        return { status: 'paid', ride: await this.settlement.settle(ride.id, wallet, signature) };
      }
    }
    return { status: 'not_found' };
  }
}
