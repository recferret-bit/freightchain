import { z } from 'zod';
import { ADMIN_LIST_MAX } from '../../../domain/admin/admin.dto.js';
import { COSMETIC_SLOTS } from '../../../domain/economy/cosmetics.js';
import type { PromoCreateInput, PromoState } from '../../../domain/economy/promo.types.js';
import { PAID_TIER_IDS } from '../../../domain/rides/ride-tier.js';
import { walletAddressSchema } from '../../common/dto/common.dto.js';

const blank = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const nullable = <T extends z.ZodTypeAny>(inner: T) => z.preprocess((v) => (v === undefined ? null : blank(v) ?? null), inner.nullable());
/** epoch milliseconds (what the admin page sends; it converts its datetime-local fields) */
const epochMs = z.number().int().min(0).max(8_640_000_000_000_000).transform((n) => new Date(n));

const effect = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('ride'), tier: z.enum(PAID_TIER_IDS) }).strict(),
  z.object({ kind: z.literal('tickets'), tier: z.enum(PAID_TIER_IDS), poolId: nullable(z.number().int().min(0).max(4_294_967_295)), credits: z.number().int().min(1).max(100) }).strict(),
  z.object({ kind: z.literal('cosmetic'), slot: z.enum(COSMETIC_SLOTS), item: z.string().trim().min(1).max(32) }).strict(),
]);

/** A new promo code exactly as `PromoCreateInput` – parsed ONE way for the text to sign and for the change itself, or the two would not match. Range checks beyond shape are the entity's (a 400 `bad_promo_code`). */
export const promoBodySchema = z.object({
  code: z.string().trim().min(1).max(64),
  effect,
  description: nullable(z.string().trim().max(1_000)),
  maxRedemptions: nullable(z.number().int().min(1).max(1_000_000_000)),
  perWallet: z.number().int().min(1).max(1_000_000).default(1),
  startsAt: nullable(epochMs),
  expiresAt: nullable(epochMs),
  note: nullable(z.string().trim().max(1_000)),
}).strict().transform((p): PromoCreateInput => p);
export type PromoBody = z.infer<typeof promoBodySchema>;

/** the wallet's signature (base58) – checked cryptographically by the handler (a wrong one is a 401, not a 400) */
const signature = z.string().min(1).max(200);

export const createPromoBodySchema = z.object({ promo: promoBodySchema, signature }).strict();
export type CreatePromoBody = z.infer<typeof createPromoBodySchema>;

export const disablePromoBodySchema = z.object({ signature }).strict();
export type DisablePromoBody = z.infer<typeof disablePromoBodySchema>;

export const promoCodeParamsSchema = z.object({ code: z.string().trim().min(1).max(64) }).strict();
export type PromoCodeParams = z.infer<typeof promoCodeParamsSchema>;

/** POST promos/challenge – which change the text to sign must describe */
export const promoChallengeBodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('promo_create'), promo: promoBodySchema }).strict(),
  z.object({ action: z.literal('promo_disable'), code: z.string().trim().min(1).max(64) }).strict(),
]);
export type PromoChallengeBody = z.infer<typeof promoChallengeBodySchema>;

const PROMO_STATES = ['scheduled', 'active', 'ended', 'exhausted', 'disabled'] as const;
export const promosQuerySchema = z.object({ state: z.preprocess(blank, z.enum(PROMO_STATES).optional()) }).strict().transform((q) => ({ state: (q.state ?? null) as PromoState | null }));
export type PromosQuery = z.infer<typeof promosQuerySchema>;

export const promoRedemptionsQuerySchema = z.object({
  code: z.preprocess(blank, z.string().trim().max(64).optional()),
  wallet: z.preprocess(blank, walletAddressSchema.optional()),
  limit: z.coerce.number().int().min(1).max(ADMIN_LIST_MAX).default(200),
}).strict();
export type PromoRedemptionsQuery = z.infer<typeof promoRedemptionsQuerySchema>;
