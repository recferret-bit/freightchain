import type { LeaderboardBoard, LeaderboardSort } from '../../../../domain/economy/economy.dto.js';
import type { PaidTierId } from '../../../../domain/rides/ride-tier.js';
import type { FreeLevel } from '../../../../domain/rides/ride-trip.js';

/** `level`: the free board's level (the controller defaults it to HARD); null on the paid boards.
    `tier`: a paid board's shift (1h / 4h / 8h); null = every paid shift, and always null on the free board.
    `wallet`: the signed-in rider when the request asked for their place (`me=1`); null skips that work. */
export class GetLeaderboardQuery {
  constructor(
    public readonly board: LeaderboardBoard,
    public readonly level: FreeLevel | null = null,
    public readonly sort: LeaderboardSort = 'distance',
    public readonly page: number = 1,
    public readonly wallet: string | null = null,
    public readonly tier: PaidTierId | null = null,
  ) {}
}
