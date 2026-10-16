import { Logger } from '@nestjs/common';
import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { verifyDonation, type DonationOrder } from '../../../../domain/live/donation-order.entity.js';
import { liveFeatures } from '../../../../domain/live/live-features.js';
import { EFFECTS, EFFECT_WINDOW_MS, NOTE_MAX_LENGTH, type EffectId } from '../../../../domain/live/live-rules.js';
import { toRideEventDto, type ConfirmDonationResultDto } from '../../../../domain/live/live.dto.js';
import { RideEvent } from '../../../../domain/live/ride-event.entity.js';
import { RideStatus } from '../../../../domain/rides/ride-status.js';
import { BadRequestError, ConflictError, NotFoundError } from '../../../../domain/shared/errors.js';
import { RulesConfigPort } from '../../../ports/config/rules-config.port.js';
import { ChainPort } from '../../../ports/economy/chain.port.js';
import { DonationOrderRepositoryPort } from '../../../ports/live/donation-order.repository.port.js';
import { RideEventRepositoryPort } from '../../../ports/live/ride-event.repository.port.js';
import { RideRepositoryPort } from '../../../ports/rides/ride.repository.port.js';
import { ClockPort } from '../../../ports/shared/clock.port.js';
import { StatsService } from '../../../services/stats.service.js';
import { ConfirmDonationCommand } from './confirm-donation.command.js';

/**
 * Step 2 of a PAID donation. Lock-free and race-safe: the transfer is checked on chain, then the order is CLAIMED with one conditional update (pending →
 * paid, the signature unique) and only the claimer creates the feed event (the event's signature is unique too). Money that moved is never refused: if
 * the ride's effect window is taken by now, effects are off, or the ride ended, the donation is delivered as a TIP and its text says why. A confirm that
 * finds the order already claimed by this transfer answers with its event (or 'pending' while the claimer is still writing it).
 */
@CommandHandler(ConfirmDonationCommand)
export class ConfirmDonationHandler implements ICommandHandler<ConfirmDonationCommand, ConfirmDonationResultDto> {
  private readonly logger = new Logger(ConfirmDonationHandler.name);

  constructor(
    private readonly orders: DonationOrderRepositoryPort,
    private readonly events: RideEventRepositoryPort,
    private readonly rides: RideRepositoryPort,
    private readonly chain: ChainPort,
    private readonly rules: RulesConfigPort,
    private readonly clock: ClockPort,
    private readonly stats: StatsService,
  ) {}

  async execute({ wallet, rideId, orderId, signature }: ConfirmDonationCommand): Promise<ConfirmDonationResultDto> {
    const order = await this.orders.findById(orderId);
    if (!order || order.wallet !== wallet || order.rideId !== rideId) throw new NotFoundError('donation not found');
    if (order.status === 'paid') return this.alreadyPaid(order, signature);
    const used = await this.events.findBySignature(signature);
    if (used) throw new ConflictError('this transaction already paid a donation', 'signature_reused');
    const tx = await this.chain.getTransaction(signature);
    if (!tx) return { status: 'pending' };
    const why = verifyDonation(tx, order);
    if (why) throw new BadRequestError(why, 'bad_donation_payment');
    const now = this.clock.now();
    if (!(await this.orders.claim(order.id, signature, now))) {
      const again = await this.orders.findById(order.id);
      if (again?.status === 'paid' && again.signature === signature) return this.alreadyPaid(again, signature);
      throw new ConflictError('this transaction already paid a donation', 'signature_reused');
    }
    return { status: 'paid', event: toRideEventDto(await this.deliver(order, signature, now)) };
  }

  private async alreadyPaid(order: DonationOrder, signature: string): Promise<ConfirmDonationResultDto> {
    if (order.signature !== signature) throw new ConflictError('this donation is already paid', 'already_paid');
    const event = await this.events.findBySignature(signature) ?? await this.deliver(order, signature, this.clock.now());   // the claimer died before writing it
    return { status: 'paid', event: toRideEventDto(event) };
  }

  /** the paid order becomes a feed event – its effect if it can still happen, otherwise a tip saying why */
  private async deliver(order: DonationOrder, signature: string, now: Date): Promise<RideEvent> {
    const ride = await this.rides.findById(order.rideId);
    const live = !!ride && ride.isInStatus(RideStatus.Running) && !ride.isStaleRunning(now, this.rules.get());
    const rankedBlocks = !!ride?.ranked && EFFECTS[order.effect].game;
    const effectsOn = !!ride && liveFeatures(this.rules.get().live, ride).effects && !rankedBlocks;
    const paid = { orderId: order.id, signature, lamports: order.lamports };
    const make = (effect: EffectId, note: string | null) => RideEvent.donation({ rideId: order.rideId, wallet: order.wallet, effect, note, now, paid });
    const tipWhy = !live ? 'arrived after the ride ended' : rankedBlocks ? 'is off on a ranked ride' : 'is off on this ride';
    const asTip = (reason: string) => make('tip', `${order.note ? `${order.note} – ` : ''}${EFFECTS[order.effect].game ? `${order.effect} ${reason}, delivered as a tip` : ''}`.slice(0, NOTE_MAX_LENGTH) || null);
    let event: RideEvent | null = null;
    if (EFFECTS[order.effect].game && live && effectsOn) {
      event = await this.events.insert(make(order.effect, order.note), EFFECT_WINDOW_MS);
      if (!event) { const dup = await this.events.findBySignature(signature); if (dup) return dup; }
      if (!event) event = await this.events.insert(asTip('came inside another effect\'s 20 s'));
    } else event = await this.events.insert(EFFECTS[order.effect].game ? asTip(tipWhy) : make(order.effect, order.note));
    const inserted = event !== null;   // this call wrote the event (a racing delivery of the same transfer finds it below and counts nothing)
    event ??= await this.events.findBySignature(signature);   // a racing delivery of the same transfer won
    if (!event) throw new ConflictError('the donation could not be recorded – confirm again', 'retry');
    await this.orders.setEvent(order.id, event.id ?? 0);
    if (inserted && ride) await this.stats.recordDonation(ride.wallet, order.lamports, true, event.snapshot().createdAt).catch((e: unknown) => this.logger.warn(`donation statistics deferred to stats:reconcile: ${e instanceof Error ? e.message : String(e)}`));   // the DRIVER's totals: money that moved
    this.logger.log({ event: 'live-donation', msg: `paid donation ${event.effect} on ride ${order.rideId}`, rideId: order.rideId, wallet: order.wallet, effect: event.effect, signature });
    return event;
  }
}
