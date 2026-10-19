import { z } from 'zod';
import { ADMIN_LIST_MAX } from '../../../domain/admin/admin.dto.js';
import { walletAddressSchema } from '../../common/dto/common.dto.js';

const limit = (fallback: number) => z.coerce.number().int().min(1).max(ADMIN_LIST_MAX).default(fallback);
const blankIsNone = (v: unknown) => (v === '' ? undefined : v);

export const playersQuerySchema = z.object({ q: z.preprocess(blankIsNone, z.string().trim().min(1).max(44).regex(/^[1-9A-HJ-NP-Za-km-z]+$/, 'a wallet prefix (base58)').optional()), limit: limit(100) });
export type PlayersQuery = z.infer<typeof playersQuerySchema>;

export const walletParamsSchema = z.object({ wallet: walletAddressSchema });
export type WalletParams = z.infer<typeof walletParamsSchema>;

export const poolsQuerySchema = z.object({ limit: limit(100) });
export type PoolsQuery = z.infer<typeof poolsQuerySchema>;

/** the mirror's `Pool.id` is a PostgreSQL Int: a larger id cannot exist, so it is a 400, not a database range error */
export const poolIdParamsSchema = z.object({ id: z.coerce.number().int().min(0).max(0x7fff_ffff) });
export type PoolIdParams = z.infer<typeof poolIdParamsSchema>;

export const adminStatsQuerySchema = z.object({ days: z.coerce.number().int().min(1).max(365).default(30), top: z.coerce.number().int().min(1).max(100).default(20) });
export type AdminStatsQuery = z.infer<typeof adminStatsQuerySchema>;

export const sessionsQuerySchema = z.object({ days: z.coerce.number().int().min(1).max(30).default(7) });
export type SessionsQuery = z.infer<typeof sessionsQuerySchema>;
