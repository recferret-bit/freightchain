import { Optional } from '@nestjs/common';
import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import { poolPayouts, TOP20_SIZE } from '../../../../domain/economy/pool-payouts.js';
import type { PoolStandingsDto, StandingRankDto } from '../../../../domain/economy/pool-standings.dto.js';
import { prizeBound } from '../../../../domain/economy/vault-split.js';
import { NotFoundError } from '../../../../domain/shared/errors.js';
import { PoolPayoutRepositoryPort } from '../../../ports/economy/pool-payout.repository.port.js';
import { PoolRepositoryPort } from '../../../ports/economy/pool.repository.port.js';
import { RideQueryPort } from '../../../ports/rides/ride-query.port.js';
import { ReferralPayoutService } from '../../../services/referral-payout.service.js';
import { GetPoolStandingsQuery } from './get-pool-standings.query.js';

/** under-review rides counted for the public number (the exact count above this is not interesting) */
const UNDER_REVIEW_LIMIT = 100;

/**
 * A pool's winners list, public. Provisional until the payout job writes its plan: the pool's ranking over VERIFIED rides (the same the payout job pays by),
 * divided with pool-payouts.ts at today's pot. After the plan: the planned ranks, amounts and what was paid. A rider's distance is summed from that wallet's
 * verified rides of the pool.
 */
@QueryHandler(GetPoolStandingsQuery)
export class GetPoolStandingsHandler implements IQueryHandler<GetPoolStandingsQuery, PoolStandingsDto> {
  constructor(
    private readonly pools: PoolRepositoryPort,
    private readonly payouts: PoolPayoutRepositoryPort,
    private readonly rides: RideQueryPort,
    @Optional() private readonly referralPayout?: ReferralPayoutService,
  ) {}

  async execute({ poolId }: GetPoolStandingsQuery): Promise<PoolStandingsDto> {
    const pool = await this.pools.findById(poolId);
    if (!pool) throw new NotFoundError('no such pool');
    const s = pool.snapshot();
    const prizeLamports = prizeBound({ priceLamports: s.priceLamports, ticketsSold: s.ticketsSold, sponsored: s.sponsored, prizeBps: s.prizeBps, seedBps: s.seedBps });
    const [ranking, plan, underReview] = await Promise.all([
      this.rides.poolRanking(poolId, TOP20_SIZE, true),
      this.payouts.listByPool(poolId),
      this.rides.poolUnreviewed(poolId, UNDER_REVIEW_LIMIT),
    ]);
    const byWallet = new Map(ranking.map((r) => [r.wallet, r]));
    const riderPlan = plan.filter((p) => (p.kind ?? 'rider') === 'rider');
    const rowOf = (p: { rank: number; wallet: string; lamports: number }, paid: boolean, signature: string | null): StandingRankDto => ({
      rank: p.rank, wallet: p.wallet, distance: Math.round(byWallet.get(p.wallet)?.distance ?? 0), rides: byWallet.get(p.wallet)?.rides ?? 0, lamports: p.lamports, paid, signature,
    });
    const ranks: StandingRankDto[] = riderPlan.length
      ? riderPlan.map((p) => rowOf(p, p.status === 'paid', p.signature))
      : this.referralPayout
        ? (await this.referralPayout.leaves(pool)).filter((p) => (p.kind ?? 'rider') === 'rider').map((p) => rowOf(p, false, null))
        : (() => {
          const amounts = new Map(poolPayouts(prizeLamports, ranking.map((r) => r.wallet)).map((p) => [p.wallet, p.lamports]));
          return ranking.map((r, i) => ({ rank: i + 1, wallet: r.wallet, distance: Math.round(r.distance), rides: r.rides, lamports: amounts.get(r.wallet) ?? 0, paid: false, signature: null }));
        })();
    return {
      poolId, tier: s.tier, label: s.label, playDeadline: s.playDeadline.getTime(), payoutAt: s.payoutAt.getTime(), prizeLamports, final: plan.length > 0,
      payout: { state: s.payoutState, note: s.payoutNote, held: s.hold !== null }, underReview: underReview.length, ranks,
    };
  }
}
