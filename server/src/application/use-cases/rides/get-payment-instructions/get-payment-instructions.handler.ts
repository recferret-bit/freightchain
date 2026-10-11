import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import { RideStatus } from '../../../../domain/rides/ride-status.js';
import { ConflictError, NotFoundError, ServiceUnavailableError } from '../../../../domain/shared/errors.js';
import { RulesConfigPort } from '../../../ports/config/rules-config.port.js';
import { ChainPort } from '../../../ports/economy/chain.port.js';
import { PlayerRepositoryPort } from '../../../ports/players/player.repository.port.js';
import { RideRepositoryPort } from '../../../ports/rides/ride.repository.port.js';
import { ClockPort } from '../../../ports/shared/clock.port.js';
import { EntropyPort } from '../../../ports/shared/entropy.port.js';
import { TransactionPort } from '../../../ports/shared/transaction.port.js';
import { GetPaymentInstructionsQuery, type PaymentInstructionsDto } from './get-payment-instructions.query.js';

/** The unsigned payment transaction – built per click (a blockhash lives ~60–90 s). An EXPIRED quote stops new transactions here, and only here.
 *  The reference is stored once, under the player lock, before the RPC build, and reused when the blockhash is refreshed. */
@QueryHandler(GetPaymentInstructionsQuery)
export class GetPaymentInstructionsHandler implements IQueryHandler<GetPaymentInstructionsQuery, PaymentInstructionsDto> {
  constructor(
    private readonly rides: RideRepositoryPort,
    private readonly chain: ChainPort,
    private readonly rules: RulesConfigPort,
    private readonly clock: ClockPort,
    private readonly players: PlayerRepositoryPort,
    private readonly transactions: TransactionPort,
    private readonly entropy: EntropyPort,
  ) {}

  async execute({ wallet, rideId }: GetPaymentInstructionsQuery): Promise<PaymentInstructionsDto> {
    const { treasury } = this.rules.get();
    if (!treasury) throw new ServiceUnavailableError('no treasury configured');
    const locked = await this.transactions.run(async (handle) => {
      const player = await this.players.findByWalletForUpdate(wallet, handle);
      if (!player) throw new NotFoundError('player not found');
      player.requirePaidPlay(); // the unsigned memo transaction. Confirming one already sent is not this query.
      const ride = await this.rides.findById(rideId, handle);
      if (!ride || ride.wallet !== wallet) throw new NotFoundError('ride not found');
      if (!ride.isInStatus(RideStatus.AwaitingPayment)) throw new ConflictError(`ride is ${ride.status}`);
      if (!ride.quoteIsLive(this.clock.now())) throw new ConflictError('the price quote expired – create the ride again');
      if (ride.assignPaymentReference(this.entropy.referenceKey())) await this.rides.save(ride, handle);
      return { lamports: ride.lamports, memo: ride.id, quoteExpiresAt: ride.quoteExpiresAt?.getTime() ?? null, reference: ride.paymentReference ?? '' };
    });
    const tx = await this.chain.buildPaymentTransaction({ payer: wallet, treasury, lamports: locked.lamports, memo: locked.memo, reference: locked.reference });
    return { treasury, ...locked, blockhash: tx.blockhash, lastValidBlockHeight: tx.lastValidBlockHeight, transaction: tx.transaction };
  }
}
