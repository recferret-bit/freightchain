import { QueryBus, CommandHandler, QueryHandler, type ICommandHandler, type IQueryHandler } from '@nestjs/cqrs';
import { rideCard, rideLink, sellableOffers, watchLink, type ActionCard, type ActionLink } from '../../../domain/actions/action-card.js';
import type { PublicRideDto } from '../../../domain/rides/public-ride.dto.js';
import { RulesConfigPort } from '../../ports/config/rules-config.port.js';
import { PoolRepositoryPort } from '../../ports/economy/pool.repository.port.js';
import { ClockPort } from '../../ports/shared/clock.port.js';
import { GetPublicRideQuery } from '../rides/get-public-ride/get-public-ride.query.js';
import { GetRideActionQuery } from './get-ride-action.query.js';
import { OpenRideActionCommand } from './open-ride-action.command.js';

@QueryHandler(GetRideActionQuery)
export class GetRideActionHandler implements IQueryHandler<GetRideActionQuery, ActionCard> {
  constructor(private readonly queries: QueryBus, private readonly rules: RulesConfigPort, private readonly pools: PoolRepositoryPort, private readonly clock: ClockPort) {}

  async execute({ rideId }: GetRideActionQuery): Promise<ActionCard> {
    const ride = await this.queries.execute<GetPublicRideQuery, PublicRideDto>(new GetPublicRideQuery(rideId));
    const rules = this.rules.get();
    const offers = rules.paymentMode === 'program' && rules.programId ? sellableOffers(await this.pools.listLive(), this.clock.now()) : [];
    return rideCard(rules.appOrigin, {
      id: ride.id, route: ride.route, tier: ride.tier, status: ride.status, km: ride.km, reason: ride.reason, verdictRejected: ride.verdict?.status === 'rejected',
    }, offers);
  }
}

@CommandHandler(OpenRideActionCommand)
export class OpenRideActionHandler implements ICommandHandler<OpenRideActionCommand, ActionLink> {
  constructor(private readonly queries: QueryBus, private readonly rules: RulesConfigPort) {}

  async execute({ rideId, target }: OpenRideActionCommand): Promise<ActionLink> {
    const ride = await this.queries.execute<GetPublicRideQuery, PublicRideDto>(new GetPublicRideQuery(rideId));
    const rules = this.rules.get();
    return target === 'watch' ? watchLink(rules.appOrigin, rules.gameOrigin ?? rules.appOrigin, ride) : rideLink(rules.appOrigin, ride.id);
  }
}
