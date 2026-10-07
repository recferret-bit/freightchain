import { z } from 'zod';

/** A pool id is the on-chain u32. */
export const poolIdParamsSchema = z.object({ id: z.coerce.number().int().min(0).max(4_294_967_295) });
export type PoolIdParams = z.infer<typeof poolIdParamsSchema>;

/** Typed by people: case and spaces are forgiven later (PromoCode.normalize); the length bound only keeps junk out. */
export const redeemPromoBodySchema = z.object({ code: z.string().trim().min(1).max(64) });
export type RedeemPromoBody = z.infer<typeof redeemPromoBodySchema>;
