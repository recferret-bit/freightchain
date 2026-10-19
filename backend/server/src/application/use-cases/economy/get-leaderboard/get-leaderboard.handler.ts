import { Optional } from '@nestjs/common';
import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import { DEFAULT_BOARD_LEVEL, LEADERBOARD_PAGE, LEADERBOARD_SIZE, PRIZE_RANKS, type LeaderboardDto, type LeaderboardStandingDto } from '../../../../domain/economy/economy.dto.js';
import { PAID_TIER_IDS } from '../../../../domain/rides/ride-tier.js';
import { FREE_LEVELS, FREE_LEVEL_IDS, type FreeLevel } from '../../../../domain/rides/ride-trip.js';
import type { LeaderboardEntry } from '../../../ports/rides/ride-query.port.js';
import { RulesConfigPort } from '../../../ports/config/rules-config.port.js';
import { RideQueryPort } from '../../../ports/rides/ride-query.port.js';
import { RoundService } from '../../../services/round.service.js';
import { NameServicePort } from '../../../ports/sns/name-service.port.js';
import { GetLeaderboardQuery } from './get-leaderboard.query.js';

const roundNum = (n: number) => Math.round(n);
const stats = (r: LeaderboardEntry) => ({ distance: roundNum(r.distance), seconds: roundNum(r.seconds), hull: r.hull == null ? null : roundNum(r.hull), rides: r.rides });

/** Completed rides grouped by wallet. 'round' = paid rides of the current round (the top 20 by distance share the 20 % pot), 'all' = paid, all time,
    'free' = completed free rides of ONE level (`level`, on that level's trip – a free ride from before the levels ranks on none).
    Paid boards count verified shifts only, unless VERDICT_ENFORCE=false (shadow mode). The list is the top 100, 25 a page, ordered by `sort`
    (distance is the prize order). `wallet` adds that rider's place in this sort, and their distance rank on every board. */
@QueryHandler(GetLeaderboardQuery)
export class GetLeaderboardHandler implements IQueryHandler<GetLeaderboardQuery, LeaderboardDto> {
  constructor(
    private readonly roundService: RoundService,
    private readonly rideQuery: RideQueryPort,
    private readonly rules: RulesConfigPort,
    @Optional() private readonly nameService?: NameServicePort,
  ) {}

  async execute(query: GetLeaderboardQuery): Promise<LeaderboardDto> {
    const round = await this.roundService.ensureRound();
    const verifiedOnly = this.rules.get().verdictEnforce;
    const level = query.board === 'free' ? query.level ?? DEFAULT_BOARD_LEVEL : null;
    const tier = query.board === 'free' ? null : query.tier;
    const trip = level === null ? null : FREE_LEVELS[level].trip;
    const offset = (query.page - 1) * LEADERBOARD_PAGE;
    const [page, standing] = await Promise.all([
      this.rideQuery.leaderboard(query.board, query.board === 'round' ? round.id : null, verifiedOnly, trip, tier, query.sort, offset, LEADERBOARD_PAGE, LEADERBOARD_SIZE),
      query.wallet ? this.standing(query.wallet, round.id, verifiedOnly) : Promise.resolve(null),
    ]);
    const me = query.wallet ? await this.me(query, round.id, verifiedOnly, trip, tier, standing) : null;
    const wallets = page.rows.map((r) => r.wallet);
    const snsMap = this.nameService ? await this.nameService.reverseBatch(wallets) : null;
    return {
      board: query.board, level, tier, round: { id: round.id, endsAt: round.endsAt.getTime() }, prizeRanks: PRIZE_RANKS, verifiedOnly,
      sort: query.sort, page: query.page, pageSize: LEADERBOARD_PAGE, total: Math.min(page.total, LEADERBOARD_SIZE),
      rows: page.rows.map((r) => ({
        rank: r.rank,
        wallet: r.wallet,
        ...stats(r),
        ...(snsMap ? { sns: snsMap.get(r.wallet) ?? null } : {}),
      })),
      me: me ? { rank: me.rank, ...stats(me) } : null,
      standing,
    };
  }

  /** distance rank on this round and all time (each paid shift) and each free level — the rating, whatever the list is sorted by */
  private async standing(wallet: string, roundId: number, verifiedOnly: boolean): Promise<LeaderboardStandingDto[]> {
    const boards: { board: 'round' | 'all' | 'free'; level: FreeLevel | null; tier: LeaderboardStandingDto['tier']; roundId: number | null; trip: string | null }[] = [
      ...PAID_TIER_IDS.map((tier) => ({ board: 'round' as const, level: null, tier, roundId, trip: null })),
      ...PAID_TIER_IDS.map((tier) => ({ board: 'all' as const, level: null, tier, roundId: null, trip: null })),
      ...FREE_LEVEL_IDS.map((level) => ({ board: 'free' as const, level, tier: null, roundId: null, trip: FREE_LEVELS[level].trip })),
    ];
    return Promise.all(boards.map(async (b) => {
      const place = await this.rideQuery.leaderboardPlace(b.board, b.roundId, verifiedOnly, b.trip, b.tier, wallet, 'distance');
      return { board: b.board, level: b.level, tier: b.tier, rank: place?.rank ?? null, ...(place ? stats(place) : { distance: 0, seconds: 0, hull: null, rides: 0 }) };
    }));
  }

  /** place in the current sort. The distance sort is already in `standing` for this board and shift. */
  private async me(query: GetLeaderboardQuery, roundId: number, verifiedOnly: boolean, trip: string | null, tier: LeaderboardStandingDto['tier'], standing: LeaderboardStandingDto[] | null): Promise<LeaderboardEntry | null> {
    if (query.sort === 'distance') {
      const level = query.board === 'free' ? query.level ?? DEFAULT_BOARD_LEVEL : null;
      const here = standing?.find((s) => s.board === query.board && s.level === level && s.tier === tier);
      return here?.rank == null ? null : { wallet: query.wallet ?? '', rank: here.rank, distance: here.distance, seconds: here.seconds, hull: here.hull, rides: here.rides };
    }
    return this.rideQuery.leaderboardPlace(query.board, query.board === 'round' ? roundId : null, verifiedOnly, trip, tier, query.wallet ?? '', query.sort);
  }
}
