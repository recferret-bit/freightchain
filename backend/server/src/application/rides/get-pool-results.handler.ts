import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import { SCORE_FORMULA_VERSION, effectiveDurationMs, rankRideResults } from '../../domain/pool/pool-ranking.js';
import { NotFoundError } from '../../domain/shared/errors.js';
import { PoolRepositoryPort } from '../ports/economy/pool.repository.port.js';
import { ClockPort } from '../ports/shared/clock.port.js';
import { RideResultRepositoryPort, type RideResultRow } from './ride-result.port.js';
import { GetPoolResultsQuery, type PoolResultsDto } from './get-pool-results.query.js';

@QueryHandler(GetPoolResultsQuery)
export class GetPoolResultsHandler implements IQueryHandler<GetPoolResultsQuery, PoolResultsDto> {
  constructor(
    private readonly pools: PoolRepositoryPort,
    private readonly results: RideResultRepositoryPort,
    private readonly clock: ClockPort,
  ) {}

  async execute({ poolId, wallet }: GetPoolResultsQuery): Promise<PoolResultsDto> {
    const pool = await this.pools.findById(poolId);
    if (!pool) throw new NotFoundError('no such pool');
    const rows = rankRideResults(await this.results.listByPool(poolId), SCORE_FORMULA_VERSION);
    const revealed = this.clock.now().getTime() >= pool.payoutAt.getTime();
    const mine = wallet ? rows.find((row) => row.wallet === wallet) ?? null : null;
    return {
      poolId,
      revealed,
      payoutAt: pool.payoutAt.getTime(),
      scoreFormulaVersion: SCORE_FORMULA_VERSION,
      participants: rows.length,
      mine: mine ? { rideId: mine.rideId, effectiveDurationMs: effectiveDurationMs(mine), finished: mine.finished, damageTotal: mine.damageTotal } : null,
      ranks: revealed ? rows.map((row, index) => rankView(row, index + 1)) : [],
    };
  }
}

function rankView(row: RideResultRow, rank: number) {
  return {
    rank, rideId: row.rideId, wallet: row.wallet, effectiveDurationMs: effectiveDurationMs(row), finished: row.finished, damageTotal: row.damageTotal,
    damageHoles: row.damageHoles, damageVehicles: row.damageVehicles, damageProps: row.damageProps, damageCold: row.damageCold, damageOther: row.damageOther,
    redLights: row.redLights, mgWrong: row.mgWrong, mgMissed: row.mgMissed, mgPenaltySeconds: row.mgPenaltySeconds, scoreFormulaVersion: row.scoreFormulaVersion,
  };
}
