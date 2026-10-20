import { z } from 'zod';

const note = z.string().trim().max(300).nullable().transform((v) => (v ? v : null));
const signature = z.string().min(1).max(200);

export const poolHoldParamsSchema = z.object({ id: z.coerce.number().int().min(0).max(0xffff_ffff) }).strict();
export type PoolHoldParams = z.infer<typeof poolHoldParamsSchema>;

export const poolHoldChallengeBodySchema = z.object({ action: z.literal('pool_hold'), hold: z.boolean(), note }).strict();
export type PoolHoldChallengeBody = z.infer<typeof poolHoldChallengeBodySchema>;

export const poolHoldBodySchema = z.object({ hold: z.boolean(), note, signature }).strict();
export type PoolHoldBody = z.infer<typeof poolHoldBodySchema>;
