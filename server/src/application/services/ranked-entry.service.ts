import { Injectable } from '@nestjs/common';
import { FREE_RANKED_STARTS, PAID_RANKED_STARTS, prizeAccess, prizeWeek } from '../../domain/prize/prize-rules.js';
import type { Player } from '../../domain/players/player.entity.js';
import type { Ride } from '../../domain/rides/ride.entity.js';
import { ConflictError } from '../../domain/shared/errors.js';
import { GeoLocatorPort, type GeoFix } from '../ports/prize/geo-locator.port.js';
import type { GeoHeaders } from '../ports/prize/geo-locator.port.js';
import { PrizeGeoPort } from '../ports/prize/prize-geo.port.js';
import { RideRepositoryPort } from '../ports/rides/ride.repository.port.js';
import type { TransactionHandle } from '../ports/shared/transaction.port.js';

/**
 * The ranked declaration, under the same player-row lock as the start. A refusal is a 409: the ride stays unstarted and the caller can start it unranked.
 * Age is the wallet's existing 18+ stamp. Country comes from the edge headers. Unknown country fails closed. KYC is not required to start.
 */
@Injectable()
export class RankedEntryService {
  constructor(
    private readonly rides: RideRepositoryPort,
    private readonly geo: GeoLocatorPort,
    private readonly lists: PrizeGeoPort,
  ) {}

  async claim(player: Player, ride: Ride, headers: GeoHeaders, now: Date, tx?: TransactionHandle): Promise<GeoFix & { country: string }> {
    const fix = this.geo.locate(headers);
    const access = prizeAccess({
      age18: player.age18At !== null,
      country: fix.country,
      usState: fix.country === 'US' ? fix.region : null,
      kyc: false,
    }, this.lists.rules());
    if (!access.ranked || !fix.country) {
      const why = access.reasons.filter((r) => r !== 'kyc').join(', ') || 'ineligible';
      throw new ConflictError(`ranked entry refused (${why})`, 'ranked_ineligible');
    }
    const week = prizeWeek(now);
    const used = await this.rides.countRankedStarts(player.wallet, week.start, week.end, tx);
    if (ride.isFree && used.free >= FREE_RANKED_STARTS) throw new ConflictError('this week already has 2 ranked free starts', 'ranked_free_cap');
    if (!ride.isFree && used.paid >= PAID_RANKED_STARTS) throw new ConflictError('this week already has 5 ranked paid starts', 'ranked_paid_cap');
    return { country: fix.country, region: fix.region };
  }
}
