import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import { nextFreeRideAt } from '../../../../domain/players/player.dto.js';
import { RECENT_RIDES_LIMIT, RECENT_GRANTS_LIMIT, type ProfileDto } from '../../../../domain/lobby/lobby.dto.js';
import { toTicketGrantDto } from '../../../../domain/economy/prize-pool.dto.js';
import { AnalyticsPort } from '../../../ports/analytics/analytics.port.js';
import { RideTicketRepositoryPort } from '../../../ports/players/ride-ticket.repository.port.js';
import { TicketOrderRepositoryPort } from '../../../ports/economy/ticket-order.repository.port.js';
import { PoolTicketsService } from '../../../services/pool-tickets.service.js';
import { RulesConfigPort } from '../../../ports/config/rules-config.port.js';
import { PaymentRepositoryPort } from '../../../ports/economy/payment.repository.port.js';
import { ClockPort } from '../../../ports/shared/clock.port.js';
import { RideQueryPort } from '../../../ports/rides/ride-query.port.js';
import { AchievementService } from '../../../services/achievement.service.js';
import { achievementUnlocked } from '../../../services/analytics-events.js';
import { emitAnalytics } from '../../../services/analytics-emit.js';
import { PlayerSessionService } from '../../../services/player-session.service.js';
import { demoScaleOf, isDemoWallet } from '../../../services/demo.js';
import { GetProfileQuery } from './get-profile.query.js';

@QueryHandler(GetProfileQuery)
export class GetProfileHandler implements IQueryHandler<GetProfileQuery, ProfileDto> {
  constructor(
    private readonly sessions: PlayerSessionService,
    private readonly achievements: AchievementService,
    private readonly rideQuery: RideQueryPort,
    private readonly payments: PaymentRepositoryPort,
    private readonly rules: RulesConfigPort,
    private readonly clock: ClockPort,
    private readonly poolTickets: PoolTicketsService,
    private readonly tickets: RideTicketRepositoryPort,
    private readonly orders: TicketOrderRepositoryPort,
    private readonly analytics: AnalyticsPort,
  ) {}

  async execute(query: GetProfileQuery): Promise<ProfileDto> {
    const { wallet } = query;
    const now = this.clock.now();
    const player = await this.sessions.touch(wallet, now);
    const { facts, stats } = await this.rideQuery.summary(wallet);
    const unlocked = await this.achievements.evaluate(wallet, null, facts); // catch-up: rides that ended by timeout never went through /end
    for (const unlock of unlocked) {
      if (unlock.id === 'top-20') continue;
      emitAnalytics(this.analytics, () => achievementUnlocked(wallet, unlock.id, unlock.earnedAt, null, isDemoWallet(this.rules.get(), wallet)));
    }
    const [spent, recent, achievements, tickets, grants, ordered] = await Promise.all([
      this.payments.totalsOf(wallet), this.rideQuery.recent(wallet, RECENT_RIDES_LIMIT), this.achievements.list(wallet), this.poolTickets.balances(wallet), this.tickets.recentGrants(wallet, RECENT_GRANTS_LIMIT), this.orders.totalsOf(wallet),
    ]);
    const rules = this.rules.get();
    return {
      wallet, createdAt: player.createdAt.getTime(), freeRides: player.freeRides, freeRidesMax: player.freeRidesMax, nextFreeRideAt: nextFreeRideAt(player, now), demo: isDemoWallet(rules, wallet), demoScale: demoScaleOf(rules),
      stats: { rides: stats.started, completed: stats.completed, metres: Math.round(stats.metres), bestMetres: Math.round(stats.best), paidRides: spent.count, spentLamports: spent.lamports + ordered.lamports, ticketsBought: ordered.tickets },
      recent: recent.map((r) => ({
        tier: r.tier, status: r.status, distance: Math.round(r.lastS), hull: r.hull === null ? null : Math.round(r.hull), route: r.route, timeScale: r.timeScale,
        startedAt: r.startedAt.getTime(), endedAt: r.endedAt?.getTime() ?? null, verdict: r.verdict,
      })),
      achievements,
      tickets,
      grants: grants.map(toTicketGrantDto),
    };
  }
}
