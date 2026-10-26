import { GameSettingsService } from './game-settings.service.js';
import { PRESEASON_PROMO_CODE, eventWindow } from '../../domain/settings/preseason-event.js';
import { resolveSettings } from '../../domain/settings/game-settings.js';
import { CONVOY_PROMO_CODE } from '../../domain/economy/promo-code.entity.js';
import { ConvoyRepositoryPort } from '../referral/convoy.repository.port.js';
import { Injectable, Optional } from '@nestjs/common';
import { PAID_RANKED_STARTS, PROMO_RANKED_STARTS, nominalShiftSeconds, prizeAccess, prizeWeek, rankedStartFits } from '../../domain/prize/prize-rules.js';
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
    @Optional() private readonly settings?: GameSettingsService,
    @Optional() private readonly convoy?: ConvoyRepositoryPort,
  ) {}

  async claim(player: Player, ride: Ride, headers: GeoHeaders, now: Date, tx?: TransactionHandle): Promise<GeoFix & { country: string }> {
    if (player.guest) throw new ConflictError('a guest session can only play the EASY run', 'guest_easy_only');
    if (ride.isFree && !ride.isPromo) throw new ConflictError('a training ride is not ranked', 'ranked_training');
    if (ride.snapshot().promoCode === CONVOY_PROMO_CODE && (await this.convoy?.getByReferee(player.wallet, tx))?.policy?.promoRanked !== 1) throw new ConflictError('this Convoy promo was granted unranked', 'convoy_promo_unranked');
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
    if (!rankedStartFits(now, nominalShiftSeconds(ride))) {
      throw new ConflictError('a ranked start must be able to finish by Sunday 12:00 UTC', 'ranked_window');
    }
    const settings = await this.settings?.current(tx) ?? resolveSettings([]);
    if (settings.eventModeEnabled === 1 || ride.promoCode === PRESEASON_PROMO_CODE) {
      const window = eventWindow(settings);
      if (!window || now < window.start || now > window.lastStart) throw new ConflictError('the event start window is closed', 'event_closed');
      if (ride.promoCode !== PRESEASON_PROMO_CODE || ride.tier !== '1h') throw new ConflictError('only the campaign attempt can enter this event', 'event_attempt_required');
      const eventUsed = await this.rides.countRankedStarts(player.wallet, window.start, window.end, tx);
      if (eventUsed.paid + eventUsed.promo > 0) throw new ConflictError('your event attempt has been used', 'event_attempt_used');
    }
    const week = prizeWeek(now);
    const used = await this.rides.countRankedStarts(player.wallet, week.start, week.end, tx);
    if (ride.isPromo && used.promo >= PROMO_RANKED_STARTS) throw new ConflictError('this week already has its ranked promo start', 'ranked_promo_cap');
    if (!ride.isPromo && used.paid >= PAID_RANKED_STARTS) throw new ConflictError('this week already has 5 ranked paid starts', 'ranked_paid_cap');
    return { country: fix.country, region: fix.region };
  }
}
