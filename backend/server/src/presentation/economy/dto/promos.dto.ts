import { z } from 'zod';
import { COSMETIC_SLOTS } from '../../../domain/economy/cosmetics.js';

export const equipCosmeticBodySchema = z.object({ slot: z.enum(COSMETIC_SLOTS), item: z.string().trim().min(1).max(32) });
export type EquipCosmeticBody = z.infer<typeof equipCosmeticBodySchema>;
