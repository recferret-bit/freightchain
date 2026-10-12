import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { DonationOrder } from '../../../../domain/live/donation-order.entity.js';
import { EFFECTS, EFFECT_WINDOW_MS } from '../../../../domain/live/live-rules.js';
import type { DonationOrderDto } from '../../../../domain/live/live.dto.js';
import { ConflictError, TooManyRequestsError } from '../../../../domain/shared/errors.js';
import { ChainPort } from '../../../ports/economy/chain.port.js';
import { DonationOrderRepositoryPort } from '../../../ports/live/donation-order.repository.port.js';
import { RideEventRepositoryPort } from '../../../ports/live/ride-event.repository.port.js';
import { ClockPort } from '../../../ports/shared/clock.port.js';
import { EntropyPort } from '../../../ports/shared/entropy.port.js';
import { LiveAccessService } from '../../../services/live-access.service.js';
import { CreateDonationOrderCommand } from './create-donation-order.command.js';

/**
 * Step 1 of a PAID donation: the same gate as any post, then an order and an unsigned SOL transfer FROM the spectator TO the driver (memo fc-donation:<id>)
 * that the wallet signs and sends. Nothing is in the feed yet. A game effect whose window is visibly taken is refused here (429) so nobody pays for an
 * effect that can't happen; it is checked again when the payment is confirmed.
 */
@CommandHandler(CreateDonationOrderCommand)
export class CreateDonationOrderHandler implements ICommandHandler<CreateDonationOrderCommand, DonationOrderDto> {
  constructor(
    private readonly access: LiveAccessService,
    private readonly orders: DonationOrderRepositoryPort,
    private readonly events: RideEventRepositoryPort,
    private readonly chain: ChainPort,
    private readonly entropy: EntropyPort,
    private readonly clock: ClockPort,
  ) {}

  async execute({ wallet, rideId, effect, note }: CreateDonationOrderCommand): Promise<DonationOrderDto> {
    const now = this.clock.now();
    const { ride, features } = await this.access.requirePostable(rideId, wallet, { kind: 'donation', effect }, now);
    if (features.payment !== 'chain') throw new ConflictError('donations are free (mock) on this server – post them directly', 'payment_not_needed');
    if (EFFECTS[effect].game) {
      const last = await this.events.lastEffectAt(rideId);
      const left = last ? EFFECT_WINDOW_MS - (now.getTime() - last.getTime()) : 0;
      if (left > 0) throw new TooManyRequestsError(`one effect per ${EFFECT_WINDOW_MS / 1000} s on this ride – the next in ${Math.ceil(left / 1000)} s`, 'live_rate_limited', left / 1000);
    }
    const order = DonationOrder.create({ id: this.entropy.uuid(), rideId, wallet, recipient: ride.wallet, effect, note, now });
    order.assignReference(this.entropy.referenceKey());
    const transaction = await this.chain.buildPaymentTransaction({ payer: wallet, treasury: order.recipient, lamports: order.lamports, memo: order.memo, reference: order.paymentReference });
    await this.orders.insert(order);
    return { order: { id: order.id, effect: order.effect, lamports: order.lamports, to: order.recipient, memo: order.memo, reference: order.paymentReference }, transaction };
  }
}
