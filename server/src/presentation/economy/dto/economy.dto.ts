import { z } from 'zod';
import type { LeaderboardBoard } from '../../../domain/economy/economy.dto.js';

/** An unknown board falls back to the current round's, as before. */
export const leaderboardQuerySchema = z.object({
  board: z.unknown().transform((v): LeaderboardBoard => (v === 'free' || v === 'all' ? v : 'round')),
});
export type LeaderboardQuery = z.infer<typeof leaderboardQuerySchema>;
