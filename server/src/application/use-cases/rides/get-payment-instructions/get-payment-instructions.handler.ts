import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import { RideStatus } from '../../../../domain/rides/ride-status.js';
import { ConflictError, ServiceUnavailableError } from '../../../../domain/shared/errors.js';
import { RulesConfigPort } from '../../../ports/config/rules-config.port.js';
import { ChainPort } from '../../../ports/economy/chain.port.js';
import { ClockPort } from '../../../ports/shared/clock.port.js';
import { RideLookupService } from '../../../services/ride-lookup.service.js';
import { GetPaymentInstructionsQuery, type PaymentInstructionsDto } from './get-payment-instructions.query.js';

/** The unsigned payment transaction – built per click (a blockhash lives ~60–90 s). An EXPIRED quote stops new transactions here, and only here. */
@QueryHandler(GetPaymentInstructionsQuery)
export class GetPaymentInstructionsHandler implements IQueryHandler<GetPaymentInstructionsQuery, PaymentInstructionsDto> {
  constructor(
    private readonly lookup: RideLookupService,
    private readonly chain: ChainPort,
    private readonly rules: RulesConfigPort,
    private readonly clock: ClockPort,
  ) {}

  async execute({ wallet, rideId }: GetPaymentInstructionsQuery): Promise<PaymentInstructionsDto> {
    const ride = await this.lookup.require(rideId, wallet);
    const { treasury } = this.rules.get();
    if (!treasury) throw new ServiceUnavailableError('no treasury configured');
    if (!ride.isInStatus(RideStatus.AwaitingPayment)) throw new ConflictError(`ride is ${ride.status}`);
    if (!ride.quoteIsLive(this.clock.now())) throw new ConflictError('the price quote expired – create the ride again');
    const tx = await this.chain.buildPaymentTransaction({ payer: wallet, treasury, lamports: ride.lamports, memo: ride.id });
    return {
      treasury, lamports: ride.lamports, memo: ride.id, quoteExpiresAt: ride.quoteExpiresAt?.getTime() ?? null,
      blockhash: tx.blockhash, lastValidBlockHeight: tx.lastValidBlockHeight, transaction: tx.transaction,
    };
  }
}
