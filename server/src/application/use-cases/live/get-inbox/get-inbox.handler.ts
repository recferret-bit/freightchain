import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import { FEED_PAGE } from '../../../../domain/live/live-rules.js';
import { toRideEventDto, withoutMuted, type InboxDto } from '../../../../domain/live/live.dto.js';
import { liveFeatures } from '../../../../domain/live/live-features.js';
import { RideMuteRepositoryPort } from '../../../ports/live/ride-mute.repository.port.js';
import { RulesConfigPort } from '../../../ports/config/rules-config.port.js';
import { RideEventRepositoryPort } from '../../../ports/live/ride-event.repository.port.js';
import { ViewerPresencePort } from '../../../ports/live/viewer-presence.port.js';
import { ClockPort } from '../../../ports/shared/clock.port.js';
import { RideLookupService } from '../../../services/ride-lookup.service.js';
import { GetInboxQuery } from './get-inbox.query.js';

/** The owner's view of its ride's feed (messages to show, effects to apply) + how many are watching. A read: no lock. */
@QueryHandler(GetInboxQuery)
export class GetInboxHandler implements IQueryHandler<GetInboxQuery, InboxDto> {
  constructor(
    private readonly lookup: RideLookupService,
    private readonly events: RideEventRepositoryPort,
    private readonly viewers: ViewerPresencePort,
    private readonly mutes: RideMuteRepositoryPort,
    private readonly rules: RulesConfigPort,
    private readonly clock: ClockPort,
  ) {}

  async execute({ wallet, rideId, after }: GetInboxQuery): Promise<InboxDto> {
    const ride = await this.lookup.require(rideId, wallet);
    const now = this.clock.now();
    const [events, totals, muted, viewers] = await Promise.all([this.events.listAfter(ride.id, after, FEED_PAGE), this.events.totals(ride.id), this.mutes.list(ride.id), this.viewers.count(ride.id, now)]);
    return {
      now: now.getTime(), events: withoutMuted(events.map(toRideEventDto), muted), totals, viewers,
      features: liveFeatures(this.rules.get().live, ride), muted: [...muted],
    };
  }
}
