import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { paymentRejectCode } from '../../../../domain/economy/payment-reject-code.js';
import { verifyPayment } from '../../../../domain/economy/payment-verification.js';
import { toRideDto } from '../../../../domain/rides/ride.dto.js';
import type { Ride } from '../../../../domain/rides/ride.entity.js';
import { RideStatus } from '../../../../domain/rides/ride-status.js';
import { BadRequestError, ConflictError } from '../../../../domain/shared/errors.js';
import { AnalyticsPort } from '../../../ports/analytics/analytics.port.js';
import { RulesConfigPort } from '../../../ports/config/rules-config.port.js';
import { ChainPort } from '../../../ports/economy/chain.port.js';
import { PaymentRepositoryPort } from '../../../ports/economy/payment.repository.port.js';
import { ClockPort } from '../../../ports/shared/clock.port.js';
import { emitClosedRides, paymentConflict, paymentConfirmed, paymentRejected } from '../../../services/analytics-events.js';
import { emitAnalytics } from '../../../services/analytics-emit.js';
import { isDemoWallet } from '../../../services/demo.js';
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
    private readonly clock: ClockPort,
    private readonly analytics: AnalyticsPort,
  ) {}

  async execute({ wallet, rideId, signature }: ConfirmPaymentCommand): Promise<ConfirmPaymentResultDto> {
    const now = this.clock.now();
    const ride = await this.lookup.require(rideId, wallet);
    const paid = await this.payments.findByRide(ride.id);
    if (paid) {
      if (paid.signature === signature) return { status: 'paid', ride: toRideDto(ride) };
      this.emitConflict(wallet, ride, signature, 'already_paid', now);
      throw new ConflictError('this ride is already paid');
    }
    if (!ride.isInStatus(RideStatus.AwaitingPayment, RideStatus.Expired)) {
      this.emitConflict(wallet, ride, signature, 'bad_status', now);
      throw new ConflictError(`ride is ${ride.status}`);
    }
    if (await this.payments.findBySignature(signature)) {
      this.emitConflict(wallet, ride, signature, 'signature_reused', now);
      throw new ConflictError('this transaction already paid for a ride');
    }

    const tx = await this.chain.getTransaction(signature);
    if (!tx) return { status: 'pending' };
    const why = verifyPayment(tx, { wallet, treasury: this.rules.get().treasury, lamports: ride.lamports, memo: ride.id });
    if (why) {
      const reasonCode = paymentRejectCode(why);
      if (reasonCode) emitAnalytics(this.analytics, () => paymentRejected({ wallet, signature, ride: ride.snapshot(), reasonCode, isDemo: isDemoWallet(this.rules.get(), wallet), now }));
      throw new BadRequestError(why);
    }
    const settled = await this.settlement.settle(ride.id, wallet, signature);
    if (settled.inserted && settled.paidAt) {
      const paidAt = settled.paidAt;
      const roundId = settled.ride.roundId;
      emitAnalytics(this.analytics, () => paymentConfirmed({
        wallet, signature, ride: ride.snapshot(), roundId, paidAt, via: 'confirm', isDemo: isDemoWallet(this.rules.get(), wallet), quoteExpired: !ride.quoteIsLive(paidAt),
      }));
    }
    if (settled.inserted) emitClosedRides(this.analytics, () => isDemoWallet(this.rules.get(), wallet), settled);
    return { status: 'paid', ride: settled.ride };
  }

  private emitConflict(wallet: string, ride: Ride, signature: string, reasonCode: 'already_paid' | 'signature_reused' | 'bad_status', now: Date): void {
    emitAnalytics(this.analytics, () => paymentConflict({ wallet, signature, ride: ride.snapshot(), reasonCode, isDemo: isDemoWallet(this.rules.get(), wallet), now }));
  }
}
