import { z } from 'zod';

/** `?poolId=<u32>` (optional): the pool whose accounts the purchase writes. */
export const chainFeesQuerySchema = z.object({
  poolId: z.preprocess((v) => (v === '' ? undefined : v), z.coerce.number({ message: 'poolId must be a pool id' }).int('poolId must be a pool id').min(0, 'poolId must be a pool id').max(0xffff_ffff, 'poolId must be a pool id').optional()),
});
export type ChainFeesQuery = z.infer<typeof chainFeesQuerySchema>;
