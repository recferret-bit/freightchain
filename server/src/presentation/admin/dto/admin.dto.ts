import { z } from 'zod';
import { ADMIN_LIST_MAX, type AdminRideFilter } from '../../../domain/admin/admin.dto.js';
import { LOG_LEVELS, type LogFilter } from '../../../domain/ops/log-entry.js';
import { RideStatus } from '../../../domain/rides/ride-status.js';
import { NOTE_MAX_LENGTH } from '../../../domain/verdict/ride-verdict.entity.js';
import { VerdictStatus, type VerdictDecision } from '../../../domain/verdict/verdict.dto.js';
import { walletAddressSchema } from '../../common/dto/common.dto.js';

const limit = (fallback: number) => z.coerce.number().int().min(1).max(ADMIN_LIST_MAX).default(fallback);
const optionalText = (max: number) => z.preprocess((v) => (v === '' ? undefined : v), z.string().max(max).optional());


export const adminRidesQuerySchema = z
  .object({
    wallet: z.preprocess((v) => (v === '' ? undefined : v), walletAddressSchema.optional()),
    status: z.preprocess((v) => (v === '' ? undefined : v), z.nativeEnum(RideStatus).optional()),
    verdict: z.preprocess((v) => (v === '' ? undefined : v), z.enum(['pending', 'verified', 'flagged', 'rejected', 'none']).optional()),
    limit: limit(50),
  })
  .transform((q): AdminRideFilter => ({ limit: q.limit, ...(q.wallet ? { wallet: q.wallet } : {}), ...(q.status ? { status: q.status } : {}), ...(q.verdict ? { verdict: q.verdict } : {}) }));
export type AdminRidesQuery = z.infer<typeof adminRidesQuerySchema>;

export const signInsQuerySchema = z.object({ wallet: z.preprocess((v) => (v === '' ? undefined : v), walletAddressSchema.optional()), limit: limit(100) });
export type SignInsQuery = z.infer<typeof signInsQuerySchema>;

export const actionsQuerySchema = z.object({ limit: limit(100) });
export type ActionsQuery = z.infer<typeof actionsQuerySchema>;

export const logsQuerySchema = z
  .object({ level: z.preprocess((v) => (v === '' ? undefined : v), z.enum(LOG_LEVELS as unknown as [string, ...string[]]).optional()), q: optionalText(200), limit: limit(200) })
  .transform((l): LogFilter => ({ limit: l.limit, ...(l.level ? { minLevel: l.level as LogFilter['minLevel'] } : {}), ...(l.q ? { text: l.q } : {}) }));
export type LogsQuery = z.infer<typeof logsQuerySchema>;

export const overrideBodySchema = z.object({
  decision: z.enum([VerdictStatus.Verified, VerdictStatus.Rejected]).transform((d) => d as VerdictDecision),
  note: z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), z.string().trim().max(NOTE_MAX_LENGTH).optional()).transform((n) => n ?? null),
});
export type OverrideBody = z.infer<typeof overrideBodySchema>;
