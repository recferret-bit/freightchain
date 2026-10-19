import { z } from 'zod';
import { COSMETIC_SLOTS } from '../../../domain/economy/cosmetics.js';

const part = z.string().trim().min(1).max(32);
/** The parts the player picked: any subset of the slots, nothing else (an unknown slot is a 400, not silently ignored). */
export const saveGarageBodySchema = z.object({
  loadout: z.object(Object.fromEntries(COSMETIC_SLOTS.map((slot) => [slot, part.optional()])) as Record<(typeof COSMETIC_SLOTS)[number], z.ZodOptional<typeof part>>).strict(),
});
export type SaveGarageBody = z.infer<typeof saveGarageBodySchema>;
