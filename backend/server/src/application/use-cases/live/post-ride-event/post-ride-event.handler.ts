import { Logger } from '@nestjs/common';
import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { RideEvent } from '../../../../domain/live/ride-event.entity.js';
import { EFFECT_WINDOW_MS, LINE_WINDOW_MS } from '../../../../domain/live/live-rules.js';
import { toRideEventDto, type RideEventDto } from '../../../../domain/live/live.dto.js';
import { ForbiddenError, TooManyRequestsError } from '../../../../domain/shared/errors.js';
import { RideEventRepositoryPort } from '../../../ports/live/ride-event.repository.port.js';
import { ClockPort } from '../../../ports/shared/clock.port.js';
import { LiveAccessService } from '../../../services/live-access.service.js';
import { StatsService } from '../../../services/stats.service.js';
import { PostRideEventCommand } from './post-ride-event.command.js';

/**
 * A signed-in spectator writes to a ride that is on the road (LiveAccessService: not your own, live, the feature on, not muted). Chat lines / MOCK tips:
 * ONE insert, rate-limited by a unique time bucket in the table. Game effects: a sliding EFFECT_WINDOW_MS gap per ride, checked + inserted under a per-ride
 * advisory lock in the repository – two racing posts never both pass, the loser is a 429 with Retry-After. A mock donation charges nothing; when donations
 * must be paid (LIVE_FREE_DONATIONS=off) this route refuses them – they go through a donation order (create-donation-order). A post that races the ride's
 * end lands on an ended ride, where the driver's game simply never applies it.
 */
@CommandHandler(PostRideEventCommand)
export class PostRideEventHandler implements ICommandHandler<PostRideEventCommand, RideEventDto> {
  private readonly logger = new Logger(PostRideEventHandler.name);

  constructor(
    private readonly access: LiveAccessService,
    private readonly events: RideEventRepositoryPort,
    private readonly clock: ClockPort,
    private readonly stats: StatsService,
  ) {}

  async execute({ wallet, rideId, input }: PostRideEventCommand): Promise<RideEventDto> {
    const now = this.clock.now();
    const { ride, features } = await this.access.requirePostable(rideId, wallet, input, now);
    if (input.kind === 'donation' && features.payment === 'chain') throw new ForbiddenError('donations are paid with a real transfer here – use a donation order', 'payment_required');
    const event = input.kind === 'message'
      ? RideEvent.message({ rideId, wallet, text: input.text, now })
      : RideEvent.donation({ rideId, wallet, effect: input.effect, note: input.note, now });
    const stored = await this.events.insert(event, event.needsGame ? EFFECT_WINDOW_MS : undefined);
    if (!stored) throw await effectBusy(this.events, event, now);
    if (stored.kind === 'donation') await this.stats.recordDonation(ride.wallet, 0, false, stored.snapshot().createdAt).catch((e: unknown) => this.logger.warn(`donation statistics deferred to stats:reconcile: ${e instanceof Error ? e.message : String(e)}`));   // a mock tip: counted, no lamports
    if (stored.kind === 'donation') this.logger.log({ event: 'live-donation', msg: `mock donation ${stored.effect} on ride ${rideId}`, rideId, wallet, effect: stored.effect });
    return toRideEventDto(stored);
  }
}

/** The 429 for a refused line or effect, with the real wait (sliding window for effects, the bucket for lines). */
export async function effectBusy(events: RideEventRepositoryPort, event: RideEvent, now: Date): Promise<TooManyRequestsError> {
  const last = event.needsGame ? await events.lastEffectAt(event.rideId) : null;
  const waitMs = last ? EFFECT_WINDOW_MS - (now.getTime() - last.getTime()) : RideEvent.retryAfterMs(event.slotKey, now);
  const wait = Math.max(1, Math.ceil(waitMs / 1000));
  return new TooManyRequestsError(event.needsGame
    ? `one effect per ${EFFECT_WINDOW_MS / 1000} s on this ride – someone was quicker; the next in ${wait} s`
    : `one line per ${LINE_WINDOW_MS / 1000} s – try again in ${wait} s`, 'live_rate_limited', wait);
}
