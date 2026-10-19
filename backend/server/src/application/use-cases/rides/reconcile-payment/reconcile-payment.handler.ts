import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { memoMentions, verifyPayment } from '../../../../domain/economy/payment-verification.js';
import { toRideDto } from '../../../../domain/rides/ride.dto.js';
import { RideStatus } from '../../../../domain/rides/ride-status.js';
import { utcDay } from '../../../../domain/shared/time.js';
import { AnalyticsPort } from '../../../ports/analytics/analytics.port.js';
import { RulesConfigPort } from '../../../ports/config/rules-config.port.js';
import { ChainPort } from '../../../ports/economy/chain.port.js';
import { PaymentRepositoryPort } from '../../../ports/economy/payment.repository.port.js';
import { ClockPort } from '../../../ports/shared/clock.port.js';
import { emitClosedRides, paymentConfirmed, paymentReconcileMissed } from '../../../services/analytics-events.js';
import { emitAnalytics } from '../../../services/analytics-emit.js';
import { isDemoWallet } from '../../../services/demo.js';
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
    private readonly clock: ClockPort,
    private readonly analytics: AnalyticsPort,
  ) {}

  async execute({ wallet, rideId }: ReconcilePaymentCommand): Promise<ReconcilePaymentResultDto> {
    const now = this.clock.now();
    const ride = await this.lookup.require(rideId, wallet);
    if (!ride.isInStatus(RideStatus.AwaitingPayment, RideStatus.Expired)) {
      return { status: ride.isInStatus(RideStatus.Created) && ride.paidAt ? 'paid' : ride.status, ride: toRideDto(ride) };
    }
    const treasury = this.rules.get().treasury;
    const expected = { wallet, treasury, lamports: ride.lamports, memo: ride.id, reference: ride.paymentReference };
    // A reference finds the payment however busy the wallet is. Orders from before reference keys still scan the last 25 signatures.
    const candidates = ride.paymentReference
      ? await this.chain.signaturesForAddress(ride.paymentReference, 10)
      : (await this.chain.recentSignatures(wallet, HISTORY_LIMIT)).filter((s) => memoMentions(s.memo, ride.id));
    for (const { signature } of candidates) {
      if (await this.payments.findBySignature(signature)) continue;
      const tx = await this.chain.getTransaction(signature);
      if (tx && !verifyPayment(tx, expected)) {
        const settled = await this.settlement.settle(ride.id, wallet, signature);
        if (settled.inserted && settled.paidAt) {
          const paidAt = settled.paidAt;
          const roundId = settled.ride.roundId;
          emitAnalytics(this.analytics, () => paymentConfirmed({
            wallet, signature, ride: ride.snapshot(), roundId, paidAt, via: 'reconcile', isDemo: isDemoWallet(this.rules.get(), wallet), quoteExpired: !ride.quoteIsLive(paidAt),
          }));
        }
        if (settled.inserted) emitClosedRides(this.analytics, () => isDemoWallet(this.rules.get(), wallet), settled);
        return { status: 'paid', ride: settled.ride };
      }
    }
    const day = utcDay(now);
    emitAnalytics(this.analytics, () => paymentReconcileMissed(ride.snapshot(), isDemoWallet(this.rules.get(), wallet), day));
    return { status: 'not_found' };
  }
}
