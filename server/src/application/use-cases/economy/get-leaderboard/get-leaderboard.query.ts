import type { LeaderboardBoard } from '../../../../domain/economy/economy.dto.js';

export class GetLeaderboardQuery {
  constructor(public readonly board: LeaderboardBoard) {}
}
