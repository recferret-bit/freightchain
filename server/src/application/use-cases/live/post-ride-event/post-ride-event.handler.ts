import { Logger } from '@nestjs/common';
import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { RideStatus } from '../../../../domain/rides/ride-status.js';
import { RideEvent } from '../../../../domain/live/ride-event.entity.js';
import { EFFECT_WINDOW_MS, LINE_WINDOW_MS } from '../../../../domain/live/live-rules.js';
import { toRideEventDto, type RideEventDto } from '../../../../domain/live/live.dto.js';
import { ConflictError, ForbiddenError, NotFoundError, TooManyRequestsError } from '../../../../domain/shared/errors.js';
import { RideEventRepositoryPort } from '../../../ports/live/ride-event.repository.port.js';
import { RideRepositoryPort } from '../../../ports/rides/ride.repository.port.js';
import { RulesConfigPort } from '../../../ports/config/rules-config.port.js';
import { ClockPort } from '../../../ports/shared/clock.port.js';
import { PostRideEventCommand } from './post-ride-event.command.js';

/**
 * A signed-in spectator writes to a ride that is on the road. Chat lines / tips: ONE insert, rate-limited by a unique time bucket in the table. Game effects:
 * a sliding EFFECT_WINDOW_MS gap per ride, checked + inserted under a per-ride advisory lock in the repository – two racing posts never both pass, the loser
 * is a 429 with Retry-After. Nothing is charged (mock donation) and nothing of the ride changes, so the ride is read without its owner's player lock; a post
 * that races the ride's end lands on an ended ride, where the driver's game simply never applies it.
 */
@CommandHandler(PostRideEventCommand)
export class PostRideEventHandler implements ICommandHandler<PostRideEventCommand, RideEventDto> {
  private readonly logger = new Logger(PostRideEventHandler.name);

  constructor(
    private readonly rides: RideRepositoryPort,
    private readonly events: RideEventRepositoryPort,
    private readonly rules: RulesConfigPort,
    private readonly clock: ClockPort,
  ) {}

  async execute({ wallet, rideId, input }: PostRideEventCommand): Promise<RideEventDto> {
    const now = this.clock.now();
    const ride = await this.rides.findById(rideId);
    if (!ride || !ride.startedAt) throw new NotFoundError('ride not found');
    if (ride.wallet === wallet) throw new ForbiddenError('this is your own ride – spectators write here', 'own_ride');
    if (!ride.isInStatus(RideStatus.Running) || ride.isStaleRunning(now, this.rules.get())) throw new ConflictError(`the ride is ${ride.isInStatus(RideStatus.Running) ? 'off the air' : ride.status}`, 'ride_not_live');
    const event = input.kind === 'message'
      ? RideEvent.message({ rideId, wallet, text: input.text, now })
      : RideEvent.donation({ rideId, wallet, effect: input.effect, note: input.note, now });
    const stored = await this.events.insert(event, event.needsGame ? EFFECT_WINDOW_MS : undefined);
    if (!stored) {
      const last = event.needsGame ? await this.events.lastEffectAt(rideId) : null;
      const waitMs = last ? EFFECT_WINDOW_MS - (now.getTime() - last.getTime()) : RideEvent.retryAfterMs(event.slotKey, now);
      const wait = Math.max(1, Math.ceil(waitMs / 1000));
      throw new TooManyRequestsError(event.needsGame
        ? `one effect per ${EFFECT_WINDOW_MS / 1000} s on this ride – someone was quicker; the next in ${wait} s`
        : `one line per ${LINE_WINDOW_MS / 1000} s – try again in ${wait} s`, 'live_rate_limited', wait);
    }
    if (stored.kind === 'donation') this.logger.log({ event: 'live-donation', msg: `mock donation ${stored.effect} on ride ${rideId}`, rideId, wallet, effect: stored.effect });
    return toRideEventDto(stored);
  }
}
