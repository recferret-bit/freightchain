import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { LiveDonationService } from '../../../live/live-donation.service.js';
import { DonationOrder } from '../../../../domain/live/donation-order.entity.js';
import type { DonationOrderDto } from '../../../../domain/live/live.dto.js';
import { ChainPort } from '../../../ports/economy/chain.port.js';
import { DonationOrderRepositoryPort } from '../../../ports/live/donation-order.repository.port.js';
import { ClockPort } from '../../../ports/shared/clock.port.js';
import { EntropyPort } from '../../../ports/shared/entropy.port.js';
import { CreateDonationOrderCommand } from './create-donation-order.command.js';

/**
 * A replay tip: an order and an unsigned SOL transfer the spectator signs. 95% to the driver, 5% to the treasury, nothing to a referrer.
 * Nothing is in the feed until the transfer is confirmed. Gameplay effects are refused before an order exists.
 */
@CommandHandler(CreateDonationOrderCommand)
export class CreateDonationOrderHandler implements ICommandHandler<CreateDonationOrderCommand, DonationOrderDto> {
  constructor(
    private readonly donations: LiveDonationService,
    private readonly orders: DonationOrderRepositoryPort,
    private readonly chain: ChainPort,
    private readonly entropy: EntropyPort,
    private readonly clock: ClockPort,
  ) {}

  async execute({ wallet, rideId, effect, note, lamports }: CreateDonationOrderCommand): Promise<DonationOrderDto> {
    const now = this.clock.now();
    const prepared = await this.donations.prepare(wallet, rideId, effect, lamports, 'order');
    const order = DonationOrder.create({ id: this.entropy.uuid(), rideId, wallet, recipient: prepared.ride.wallet, effect: 'tip', note, now, lamports: prepared.lamports });
    if (prepared.treasuryLamports > 0) order.assignShare(prepared.treasury, prepared.treasuryLamports);
    order.assignReference(this.entropy.referenceKey());
    await this.orders.insert(order);
    const transaction = await this.chain.buildPaymentTransaction({
      payer: wallet, treasury: order.recipient, lamports: prepared.driverLamports, memo: order.memo, reference: order.paymentReference,
      ...(prepared.treasuryLamports > 0 ? { also: [{ to: prepared.treasury, lamports: prepared.treasuryLamports }] } : {}),
    });
    return { order: { id: order.id, effect: order.effect, lamports: order.lamports, to: order.recipient, memo: order.memo, reference: order.paymentReference }, transaction };
  }
}
