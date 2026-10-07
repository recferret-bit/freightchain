import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import { RECENT_RIDES_LIMIT, type ProfileDto } from '../../../../domain/lobby/lobby.dto.js';
import { RulesConfigPort } from '../../../ports/config/rules-config.port.js';
import { PaymentRepositoryPort } from '../../../ports/economy/payment.repository.port.js';
import { RideQueryPort } from '../../../ports/rides/ride-query.port.js';
import { AchievementService } from '../../../services/achievement.service.js';
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
  ) {}

  async execute(query: GetProfileQuery): Promise<ProfileDto> {
    const { wallet } = query;
    const player = await this.sessions.touch(wallet);
    const { facts, stats } = await this.rideQuery.summary(wallet);
    await this.achievements.evaluate(wallet, null, facts); // catch-up: rides that ended by timeout never went through /end
    const [spent, recent, achievements] = await Promise.all([this.payments.totalsOf(wallet), this.rideQuery.recent(wallet, RECENT_RIDES_LIMIT), this.achievements.list(wallet)]);
    const rules = this.rules.get();
    return {
      wallet, createdAt: player.createdAt.getTime(), freeRides: player.freeRides, demo: isDemoWallet(rules, wallet), demoScale: demoScaleOf(rules),
      stats: { rides: stats.started, completed: stats.completed, metres: Math.round(stats.metres), bestMetres: Math.round(stats.best), paidRides: spent.count, spentLamports: spent.lamports },
      recent: recent.map((r) => ({
        tier: r.tier, status: r.status, distance: Math.round(r.lastS), hull: r.hull === null ? null : Math.round(r.hull), route: r.route, timeScale: r.timeScale,
        startedAt: r.startedAt.getTime(), endedAt: r.endedAt?.getTime() ?? null,
      })),
      achievements,
    };
  }
}
