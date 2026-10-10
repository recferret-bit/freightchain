import type { LeaderboardBoard } from '../../../../domain/economy/economy.dto.js';
import type { FreeLevel } from '../../../../domain/rides/ride-trip.js';

/** `level`: the free board's level (the controller defaults it to HARD); null on the paid boards */
export class GetLeaderboardQuery {
  constructor(public readonly board: LeaderboardBoard, public readonly level: FreeLevel | null = null) {}
}
