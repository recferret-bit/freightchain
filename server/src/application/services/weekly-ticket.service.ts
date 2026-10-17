import { Injectable } from '@nestjs/common';
import type { Player } from '../../domain/players/player.entity.js';
import { grantSlot } from '../../domain/prize/grant-schedule.js';
import { PRIZE_TIERS, prizeAccess, prizeWeek, type PrizeWeek } from '../../domain/prize/prize-rules.js';
import type { PaidTierId } from '../../domain/rides/ride-tier.js';
import { tierGrant } from '../../domain/settings/game-settings.js';
import { WeeklyTicketRepositoryPort, type WeeklyTicketRecord } from '../ports/prize/weekly-ticket.repository.port.js';
import { GeoLocatorPort, type GeoHeaders } from '../ports/prize/geo-locator.port.js';
import { PrizeGeoPort } from '../ports/prize/prize-geo.port.js';
import type { TransactionHandle } from '../ports/shared/transaction.port.js';
import { GameSettingsService } from './game-settings.service.js';

/**
 * One granted paid ticket per enabled tier per interval. Not purchased. Does not mint TEN4.
 * An unused grant expires at the next interval of that tier, or at Sunday 12:00 UTC, whichever is earlier.
 * A still-unspent grant blocks the next one, so a shorter interval cannot stack on top of it.
 * Issued only inside the ranked window, to a signed-in wallet that is 18+ and prize-geo eligible. A guest never receives one.
 * Ordering that tier spends it. Ranked use takes a paid slot. The ranked-start deadlines per tier are unchanged.
 */
@Injectable()
export class WeeklyTicketService {
  constructor(
    private readonly tickets: WeeklyTicketRepositoryPort,
    private readonly settings: GameSettingsService,
    private readonly geo: GeoLocatorPort,
    private readonly lists: PrizeGeoPort,
  ) {}

  /** Live unspent grants, after issuing every enabled tier whose interval is due. */
  async offer(player: Player, headers: GeoHeaders, now: Date, tx?: TransactionHandle): Promise<WeeklyTicketRecord[]> {
    if (this.eligible(player, headers)) {
      const week = prizeWeek(now);
      if (now.getTime() >= week.start.getTime() && now.getTime() < week.end.getTime()) await this.issue(player.wallet, week, now, tx);
    }
    return this.tickets.live(player.wallet, now, tx);
  }

  /** Spend the live grant of `tier` on `rideId`. False when that tier has nothing to take. */
  async claim(player: Player, headers: GeoHeaders, tier: PaidTierId, rideId: string, now: Date, tx: TransactionHandle): Promise<boolean> {
    await this.offer(player, headers, now, tx);
    return this.tickets.claim(player.wallet, tier, rideId, now, tx);
  }

  private async issue(wallet: string, week: PrizeWeek, now: Date, tx?: TransactionHandle): Promise<void> {
    const settings = await this.settings.current();
    const open = await this.tickets.live(wallet, now, tx);
    for (const tier of PRIZE_TIERS) {
      const spec = tierGrant(settings, tier);
      if (!spec.enabled || open.some((row) => row.tier === tier)) continue; // one unspent grant per tier
      const slot = grantSlot(now, spec.days);
      const expiresAt = new Date(Math.min(slot.end.getTime(), week.end.getTime()));
      if (expiresAt.getTime() <= now.getTime()) continue;
      if (await this.tickets.hasPeriod(wallet, tier, slot.start, tx)) continue;
      await this.tickets.ensure({ wallet, weekId: week.id, tier, periodStart: slot.start, expiresAt, now }, tx);
    }
  }

  private eligible(player: Player, headers: GeoHeaders): boolean {
    if (player.guest || player.age18At === null) return false;
    const fix = this.geo.locate(headers);
    const access = prizeAccess({
      age18: true,
      country: fix.country,
      usState: fix.country === 'US' ? fix.region : null,
      kyc: false,
    }, this.lists.rules());
    return access.ranked && fix.country !== null;
  }
}
