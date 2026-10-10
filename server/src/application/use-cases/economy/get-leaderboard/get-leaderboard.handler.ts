import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import { DEFAULT_BOARD_LEVEL, LEADERBOARD_SIZE, PRIZE_RANKS, type LeaderboardDto } from '../../../../domain/economy/economy.dto.js';
import { FREE_LEVELS } from '../../../../domain/rides/ride-trip.js';
import { RulesConfigPort } from '../../../ports/config/rules-config.port.js';
import { RideQueryPort } from '../../../ports/rides/ride-query.port.js';
import { RoundService } from '../../../services/round.service.js';
import { GetLeaderboardQuery } from './get-leaderboard.query.js';

/** Completed rides ranked by total distance (paid boards: verified shifts only, unless VERDICT_ENFORCE=false – shadow mode). 'round' = paid rides of the current round (the top 20 share the 20 % pot), 'all' = paid, all time, 'free' = completed free rides of ONE level (`level`, on that level's trip – a free ride from before the levels ranks on none). */
@QueryHandler(GetLeaderboardQuery)
export class GetLeaderboardHandler implements IQueryHandler<GetLeaderboardQuery, LeaderboardDto> {
  constructor(
    private readonly roundService: RoundService,
    private readonly rideQuery: RideQueryPort,
    private readonly rules: RulesConfigPort,
  ) {}

  async execute(query: GetLeaderboardQuery): Promise<LeaderboardDto> {
    const round = await this.roundService.ensureRound();
    const verifiedOnly = this.rules.get().verdictEnforce;
    const level = query.board === 'free' ? query.level ?? DEFAULT_BOARD_LEVEL : null;
    const trip = level === null ? null : FREE_LEVELS[level].trip;
    const rows = await this.rideQuery.leaderboard(query.board, query.board === 'round' ? round.id : null, LEADERBOARD_SIZE, verifiedOnly, trip);
    return {
      board: query.board,
      level,
      round: { id: round.id, endsAt: round.endsAt.getTime() },
      prizeRanks: PRIZE_RANKS,
      verifiedOnly,
      rows: rows.map((r, i) => ({ rank: i + 1, wallet: r.wallet, distance: Math.round(r.distance), rides: r.rides })),
    };
  }
}
