import { z } from 'zod';
import { DEFAULT_BOARD_LEVEL, type LeaderboardBoard } from '../../../domain/economy/economy.dto.js';
import { FREE_LEVEL_IDS, isFreeLevel, type FreeLevel } from '../../../domain/rides/ride-trip.js';

/** An unknown board falls back to the current round's, as before. `level` (1 EASY · 2 CROSSROADS · 3 HARD) picks the free board's level – absent = HARD;
    a paid board refuses it (400). */
export const leaderboardQuerySchema = z.object({
  board: z.unknown().transform((v): LeaderboardBoard => (v === 'free' || v === 'all' ? v : 'round')),
  level: z.coerce.number().int().refine(isFreeLevel, `level must be one of ${FREE_LEVEL_IDS.join(', ')}`).optional(),
}).superRefine((q, ctx) => {
  if (q.board !== 'free' && q.level !== undefined) ctx.addIssue({ code: 'custom', path: ['level'], message: 'level is for the free board only' });
}).transform(({ board, level }) => ({ board, level: board === 'free' ? ((level as FreeLevel | undefined) ?? DEFAULT_BOARD_LEVEL) : null }));
export type LeaderboardQuery = z.infer<typeof leaderboardQuerySchema>;
