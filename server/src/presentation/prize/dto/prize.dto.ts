import { z } from 'zod';
import { PRIZE_TIERS } from '../../../domain/prize/prize-rules.js';

/** `at`: an instant inside the prize week to read. Absent = now. */
export const prizeBoardQuerySchema = z.object({
  tier: z.enum(PRIZE_TIERS),
  at: z.string().datetime().optional(),
});
export type PrizeBoardQuery = z.infer<typeof prizeBoardQuerySchema>;
