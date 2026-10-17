import { Optional } from '@nestjs/common';
import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import { bestByWallet, rankedAttemptScore, ranksAbove } from '../../../../domain/prize/prize-pool.js';
import { openSettlement, prizePhase, prizeWeek, seasonOf, type PrizePhase, type PrizeTier } from '../../../../domain/prize/prize-rules.js';
import { RulesConfigPort } from '../../../ports/config/rules-config.port.js';
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

export interface PrizeSettlementDto {
  weekId: string;
  phase: PrizePhase;
  verifyEnds: number;
  appealsEnd: number;
  payoutAt: number;
  payoutEnds: number;
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
  /** The previous week while its verification, appeals, or Tuesday payout is still open. */
  settlement: PrizeSettlementDto | null;
  board: PrizeBoardRow[];
}

/** Ended ranked rides of one tier, best clean share per wallet. Free rides are not on these boards. Corrections are not measured yet. */
@QueryHandler(GetPrizeBoardQuery)
export class GetPrizeBoardHandler implements IQueryHandler<GetPrizeBoardQuery, PrizeBoardDto> {
  constructor(
    private readonly rides: RideRepositoryPort,
    private readonly clock: ClockPort,
    @Optional() private readonly rules?: RulesConfigPort,
  ) {}

  async execute({ tier, at }: GetPrizeBoardQuery): Promise<PrizeBoardDto> {
    const now = at ?? this.clock.now();
    const week = prizeWeek(now);
    const season = seasonOf(week.id);
    const verifiedOnly = this.rules ? this.rules.get().verdictEnforce : false;
    const rides = await this.rides.listRankedEnded(tier, week.start, week.end, undefined, { verifiedOnly });
    const prev = openSettlement(now);
    const settlement: PrizeSettlementDto | null = prev
      ? {
          weekId: prev.id,
          phase: now.getTime() < prev.verifyEnd.getTime() ? 'verification' : now.getTime() < prev.appealsEnd.getTime() ? 'appeals' : 'payout',
          verifyEnds: prev.verifyEnd.getTime(),
          appealsEnd: prev.appealsEnd.getTime(),
          payoutAt: prev.payoutAt.getTime(),
          payoutEnds: prev.payoutEnds.getTime(),
        }
      : null;
    const ranked = bestByWallet(rides.map((ride) => rankedAttemptScore({
      wallet: ride.wallet,
      cleanMetres: ride.cleanMetres,
      distance: ride.distance,
      completeMetres: ride.completeDist,
      submittedAt: ride.endedAt?.getTime() ?? ride.startedAt?.getTime() ?? now.getTime(),
      payout: false,
    })));
    let place = 1;
    const board = ranked.map((row, i) => {
      if (i > 0 && ranksAbove(ranked[i - 1]!, row)) place = i + 1;
      return { place, wallet: row.wallet, bps: row.bps, corrections: row.corrections, submittedAt: row.submittedAt, payout: row.payout };
    });
    return {
      weekId: week.id, tier, starts: week.start.getTime(), ends: week.end.getTime(), phase: prizePhase(now),
      verifyEnds: week.verifyEnd.getTime(), appealsEnd: week.appealsEnd.getTime(), payoutAt: week.payoutAt.getTime(),
      season: season.season, seasonWeek: season.week, liveFinal: season.liveFinal, settlement, board,
    };
  }
}
