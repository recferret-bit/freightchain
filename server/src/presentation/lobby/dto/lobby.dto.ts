import { z } from 'zod';
import { REPLAYS_MAX_PAGE, REPLAYS_PAGE } from '../../../domain/lobby/lobby.dto.js';
import { walletAddressSchema } from '../../common/dto/common.dto.js';

/* The live feed's optional presence query: lenient – a bad value only means the page is not counted, never a 400 (every page polls this). */
export const liveQuerySchema = z.object({
  visitor: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/).optional().catch(undefined).transform((v) => v ?? ''),
  page: z.enum(['landing', 'lobby']).optional().catch(undefined).transform((v) => v ?? ''),
});
export type LiveQuery = z.infer<typeof liveQuerySchema>;

/* The replays history: `before` = the previous page's `next` ("<endedAt ms>_<seq>"), `wallet` = one driver's rides, `status` = one outcome. */
export const replaysQuerySchema = z.object({
  before: z.string().regex(/^\d{1,15}_\d{1,19}$/, 'the `next` value of the previous page').optional()
    .transform((v) => (v ? { endedAt: new Date(Number(v.split('_')[0])), seq: BigInt(v.split('_')[1] ?? '0') } : null)),
  limit: z.coerce.number().int().min(1).max(REPLAYS_MAX_PAGE).default(REPLAYS_PAGE),
  wallet: walletAddressSchema.optional().transform((v) => v ?? null),
  status: z.enum(['completed', 'abandoned', 'failed']).optional().transform((v) => v ?? null),
});
export type ReplaysQuery = z.infer<typeof replaysQuerySchema>;
