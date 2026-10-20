import { z } from 'zod';
import { ADMIN_LIST_MAX, type AdminReplayFilter, type AdminRideFilter } from '../../../domain/admin/admin.dto.js';
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
    review: z.preprocess((v) => (v === '' ? undefined : v), z.enum(['under_review']).optional()),
    pool: z.preprocess((v) => (v === '' ? undefined : v), z.coerce.number().int().min(0).max(0xffff_ffff).optional()),
    limit: limit(50),
  })
  .strict()
  .transform((q): AdminRideFilter => ({
    limit: q.limit, ...(q.wallet ? { wallet: q.wallet } : {}), ...(q.status ? { status: q.status } : {}), ...(q.verdict ? { verdict: q.verdict } : {}),
    ...(q.review ? { review: q.review } : {}), ...(q.pool !== undefined ? { poolId: q.pool } : {}),
  }));
export type AdminRidesQuery = z.infer<typeof adminRidesQuerySchema>;

export const adminReplaysQuerySchema = z
  .object({
    status: z.preprocess((v) => (v === '' ? undefined : v), z.enum(['pending', 'verified', 'flagged', 'rejected']).optional()),
    paid: z.preprocess((v) => (v === '' ? undefined : v), z.enum(['true', 'false']).optional()),
    limit: limit(50),
  })
  .strict()
  .transform((q): AdminReplayFilter => ({
    limit: q.limit,
    ...(q.status ? { status: q.status } : {}),
    ...(q.paid !== undefined ? { isPaid: q.paid === 'true' } : {}),
  }));
export type AdminReplaysQuery = z.infer<typeof adminReplaysQuerySchema>;

export const signInsQuerySchema = z.object({ wallet: z.preprocess((v) => (v === '' ? undefined : v), walletAddressSchema.optional()), limit: limit(100) }).strict();
export type SignInsQuery = z.infer<typeof signInsQuerySchema>;

export const actionsQuerySchema = z.object({ limit: limit(100) }).strict();
export type ActionsQuery = z.infer<typeof actionsQuerySchema>;

export const logsQuerySchema = z
  .object({ level: z.preprocess((v) => (v === '' ? undefined : v), z.enum(LOG_LEVELS as unknown as [string, ...string[]]).optional()), q: optionalText(200), limit: limit(200) })
  .strict()
  .transform((l): LogFilter => ({ limit: l.limit, ...(l.level ? { minLevel: l.level as LogFilter['minLevel'] } : {}), ...(l.q ? { text: l.q } : {}) }));
export type LogsQuery = z.infer<typeof logsQuerySchema>;

const decision = z.enum([VerdictStatus.Verified, VerdictStatus.Rejected]).transform((d) => d as VerdictDecision);
/** a blank note is no note – normalised the SAME way for the text to sign and for the change, or they would not match */
const note = z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), z.string().trim().max(NOTE_MAX_LENGTH).optional()).transform((n) => n ?? null);
/** the wallet's signature (base58) – checked cryptographically by the handler (a wrong one is a 401, not a 400) */
const signature = z.string().min(1).max(200);

export const overrideBodySchema = z.object({ decision, note, signature }).strict();
export type OverrideBody = z.infer<typeof overrideBodySchema>;

export const rejudgeBodySchema = z.object({ signature }).strict();
export type RejudgeBody = z.infer<typeof rejudgeBodySchema>;

/** POST rides/:id/challenge – which change the text to sign must describe */
export const actionChallengeBodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('override'), decision, note }).strict(),
  z.object({ action: z.literal('rejudge') }).strict(),
]);
export type ActionChallengeBody = z.infer<typeof actionChallengeBodySchema>;
