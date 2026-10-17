import { Injectable } from '@nestjs/common';
import type { Player } from '../../domain/players/player.entity.js';
import { prizeAccess, prizeWeek } from '../../domain/prize/prize-rules.js';
import type { PaidTierId } from '../../domain/rides/ride-tier.js';
import { WeeklyTicketRepositoryPort, type WeeklyTicketRecord } from '../ports/prize/weekly-ticket.repository.port.js';
import { GeoLocatorPort, type GeoHeaders } from '../ports/prize/geo-locator.port.js';
import { PrizeGeoPort } from '../ports/prize/prize-geo.port.js';
import type { TransactionHandle } from '../ports/shared/transaction.port.js';
import { GameSettingsService } from './game-settings.service.js';

const tierOf = (hours: number): PaidTierId => (hours === 4 ? '4h' : hours === 8 ? '8h' : '1h');

/**
 * One granted paid ticket per wallet per prize week. Not purchased. It expires at Sunday 12:00 UTC and does not stack.
 * Issued only to a signed-in wallet that is 18+ and prize-geo eligible. A guest session never receives one.
 * Ordering the configured tier spends it. Ranked use takes a paid slot. The ride does not mint TEN4.
 */
@Injectable()
export class WeeklyTicketService {
  constructor(
    private readonly tickets: WeeklyTicketRepositoryPort,
    private readonly settings: GameSettingsService,
    private readonly geo: GeoLocatorPort,
    private readonly lists: PrizeGeoPort,
  ) {}

  async configuredTier(): Promise<PaidTierId> {
    return tierOf((await this.settings.current()).weeklyTicketHours);
  }

  /** The live unspent ticket, after issuing this week's row when the wallet is eligible. */
  async offer(player: Player, headers: GeoHeaders, now: Date, tx?: TransactionHandle): Promise<WeeklyTicketRecord | null> {
    if (!this.eligible(player, headers)) return null;
    const week = prizeWeek(now);
    if (now.getTime() < week.end.getTime()) {
      const tier = tierOf((await this.settings.current()).weeklyTicketHours);
      await this.tickets.ensure({ wallet: player.wallet, weekId: week.id, tier, expiresAt: week.end, now }, tx);
    }
    return this.tickets.current(player.wallet, now, tx);
  }

  /** Spend this week's ticket on `rideId` when the ordered tier matches. False when there is no ticket to take. */
  async claim(player: Player, headers: GeoHeaders, tier: PaidTierId, rideId: string, now: Date, tx: TransactionHandle): Promise<boolean> {
    if (!(await this.offer(player, headers, now, tx))) return false;
    return this.tickets.claim(player.wallet, tier, rideId, now, tx);
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
