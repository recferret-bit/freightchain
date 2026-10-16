import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import { bestByWallet, rankedAttemptScore } from '../../../../domain/prize/prize-pool.js';
import { prizePhase, prizeWeek, seasonOf, type PrizePhase, type PrizeTier } from '../../../../domain/prize/prize-rules.js';
import { RideRepositoryPort } from '../../../ports/rides/ride.repository.port.js';
import { ClockPort } from '../../../ports/shared/clock.port.js';
import { GetPrizeBoardQuery } from './get-prize-board.query.js';

export interface PrizeBoardRow {
  place: number;
  wallet: string;
  bps: number;
  corrections: number;
  submittedAt: number;
  /** Always false until a KYC vendor exists. The place stays; a settlement would roll the cents. */
  payout: boolean;
}

export interface PrizeBoardDto {
  weekId: string;
  tier: PrizeTier;
  /** Monday 00:00 UTC. */
  starts: number;
  /** Sunday 12:00 UTC, when ranked starts close. */
  ends: number;
  phase: PrizePhase;
  verifyEnds: number;
  appealsEnd: number;
  payoutAt: number;
  season: number;
  seasonWeek: number;
  liveFinal: boolean;
  board: PrizeBoardRow[];
}

/** Ended ranked rides of one tier, best clean share per wallet. Free rides are not on these boards. Corrections are not measured yet. */
@QueryHandler(GetPrizeBoardQuery)
export class GetPrizeBoardHandler implements IQueryHandler<GetPrizeBoardQuery, PrizeBoardDto> {
  constructor(private readonly rides: RideRepositoryPort, private readonly clock: ClockPort) {}

  async execute({ tier, at }: GetPrizeBoardQuery): Promise<PrizeBoardDto> {
    const now = at ?? this.clock.now();
    const week = prizeWeek(now);
    const season = seasonOf(week.id);
    const rides = await this.rides.listRankedEnded(tier, week.start, week.end);
    const board = bestByWallet(rides.map((ride) => rankedAttemptScore({
      wallet: ride.wallet,
      cleanMetres: ride.cleanMetres,
      distance: ride.distance,
      completeMetres: ride.completeDist,
      submittedAt: ride.endedAt?.getTime() ?? ride.startedAt?.getTime() ?? now.getTime(),
      payout: false,
    }))).map((row, i) => ({ place: i + 1, wallet: row.wallet, bps: row.bps, corrections: row.corrections, submittedAt: row.submittedAt, payout: row.payout }));
    return {
      weekId: week.id, tier, starts: week.start.getTime(), ends: week.end.getTime(), phase: prizePhase(now),
      verifyEnds: week.verifyEnd.getTime(), appealsEnd: week.appealsEnd.getTime(), payoutAt: week.payoutAt.getTime(),
      season: season.season, seasonWeek: season.week, liveFinal: season.liveFinal, board,
    };
  }
}
