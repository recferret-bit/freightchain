import { z } from 'zod';
import { DEFAULT_BOARD_LEVEL, LEADERBOARD_PAGES, type LeaderboardBoard, type LeaderboardSort } from '../../../domain/economy/economy.dto.js';
import { PAID_TIER_IDS, type PaidTierId } from '../../../domain/rides/ride-tier.js';
import { FREE_LEVEL_IDS, isFreeLevel, type FreeLevel } from '../../../domain/rides/ride-trip.js';

/** An unknown board falls back to the current round's, as before. An unknown sort falls back to distance.
    `level` (1 EASY · 2 CROSSROADS · 3 HARD) picks the free board's level – absent = HARD; a paid board refuses it (400).
    `tier` (1h / 4h / 8h) limits a paid board to that shift – absent = every paid shift; the free board refuses it (400).
    `page` is 1..4 (25 a page, the top 100). `me=1` asks for the signed-in rider's place. */
export const leaderboardQuerySchema = z.object({
  board: z.unknown().transform((v): LeaderboardBoard => (v === 'free' || v === 'all' ? v : 'round')),
  level: z.coerce.number().int().refine(isFreeLevel, `level must be one of ${FREE_LEVEL_IDS.join(', ')}`).optional(),
  tier: z.enum(PAID_TIER_IDS).optional(),
  sort: z.unknown().transform((v): LeaderboardSort => (v === 'time' || v === 'hull' || v === 'rides' ? v : 'distance')),
  page: z.coerce.number().int().min(1).max(LEADERBOARD_PAGES).optional(),
  me: z.literal('1').optional(),
}).superRefine((q, ctx) => {
  if (q.board !== 'free' && q.level !== undefined) ctx.addIssue({ code: 'custom', path: ['level'], message: 'level is for the free board only' });
  if (q.board === 'free' && q.tier !== undefined) ctx.addIssue({ code: 'custom', path: ['tier'], message: 'tier is for a paid board only' });
}).transform(({ board, level, tier, sort, page, me }) => ({
  board,
  level: board === 'free' ? ((level as FreeLevel | undefined) ?? DEFAULT_BOARD_LEVEL) : null,
  tier: board === 'free' ? null : ((tier as PaidTierId | undefined) ?? null),
  sort,
  page: page ?? 1,
  me: me === '1',
}));
export type LeaderboardQuery = z.infer<typeof leaderboardQuerySchema>;
