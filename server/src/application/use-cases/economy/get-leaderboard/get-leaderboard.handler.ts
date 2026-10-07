import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import { LEADERBOARD_SIZE, PRIZE_RANKS, type LeaderboardDto } from '../../../../domain/economy/economy.dto.js';
import { RideQueryPort } from '../../../ports/rides/ride-query.port.js';
import { RoundService } from '../../../services/round.service.js';
import { GetLeaderboardQuery } from './get-leaderboard.query.js';

/** Completed rides ranked by total distance. 'round' = paid rides of the current round (the top 20 share the 20 % pot), 'all' = paid, all time, 'free' = free rides. */
@QueryHandler(GetLeaderboardQuery)
export class GetLeaderboardHandler implements IQueryHandler<GetLeaderboardQuery, LeaderboardDto> {
  constructor(
    private readonly roundService: RoundService,
    private readonly rideQuery: RideQueryPort,
  ) {}

  async execute(query: GetLeaderboardQuery): Promise<LeaderboardDto> {
    const round = await this.roundService.ensureRound();
    const rows = await this.rideQuery.leaderboard(query.board, query.board === 'round' ? round.id : null, LEADERBOARD_SIZE);
    return {
      board: query.board,
      round: { id: round.id, endsAt: round.endsAt.getTime() },
      prizeRanks: PRIZE_RANKS,
      rows: rows.map((r, i) => ({ rank: i + 1, wallet: r.wallet, distance: Math.round(r.distance), rides: r.rides })),
    };
  }
}
