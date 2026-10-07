import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import type { PoolDto } from '../../../../domain/economy/economy.dto.js';
import { LAMPORTS_PER_SOL, splitPool } from '../../../../domain/economy/prize-split.js';
import { PriceQuotePort } from '../../../ports/economy/price-quote.port.js';
import { RoundRepositoryPort } from '../../../ports/economy/round.repository.port.js';
import { RoundService } from '../../../services/round.service.js';
import { GetPoolQuery } from './get-pool.query.js';

/** The current prize pool. Lamports are the truth; the usd figures are "≈ at the current price". Accounting only – the grand prize shown is what has ACCRUED. */
@QueryHandler(GetPoolQuery)
export class GetPoolHandler implements IQueryHandler<GetPoolQuery, PoolDto> {
  constructor(
    private readonly roundService: RoundService,
    private readonly rounds: RoundRepositoryPort,
    private readonly price: PriceQuotePort,
  ) {}

  async execute(): Promise<PoolDto> {
    const round = await this.roundService.ensureRound();
    const entries = await this.rounds.entriesOf(round.id);
    const split = splitPool(entries.lamports, round.carry);
    const quote = await this.price.solUsd().catch(() => null);
    const usd = (lamports: number): number | null => (quote ? Math.round((lamports / LAMPORTS_PER_SOL) * quote.usd * 100) / 100 : null);
    return {
      round: { id: round.id, startsAt: round.startsAt.getTime(), endsAt: round.endsAt.getTime() },
      entries: entries.count, split, settled: false, solUsd: quote?.usd ?? null,
      usd: { grand: usd(split.grand), top20: usd(split.top20), nextSeed: usd(split.nextSeed), fees: usd(split.fees), entries: usd(split.entries) },
    };
  }
}
