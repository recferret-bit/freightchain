import { z } from 'zod';
import { bool, obj, str, strOrNull } from '../../common/response/wire.js';

const token = z.string().max(2048).optional();

export const verifyTelegramBodySchema = z.object({
  telegramUserId: z.string().trim().regex(/^\d{1,32}$/),
  proof: z.object({
    id: z.union([z.string().regex(/^\d{1,32}$/), z.number().int().positive().safe()]),
    auth_date: z.number().int().nonnegative().safe(), hash: z.string().regex(/^[0-9a-f]{64}$/),
    first_name: z.string().max(256), last_name: z.string().max(256).optional(),
    username: z.string().max(256).optional(), photo_url: z.string().max(2048).optional(),
  }).strict().optional(),
  turnstileToken: token,
}).strict();
export type VerifyTelegramBody = z.infer<typeof verifyTelegramBodySchema>;

export const verifyXBodySchema = z.object({
  handle: z.string().trim().regex(/^@?[A-Za-z0-9_]{1,15}$/),
  postId: z.string().trim().regex(/^\d{1,30}$/),
  turnstileToken: token,
}).strict();
export type VerifyXBody = z.infer<typeof verifyXBodySchema>;

export const claimAirdropBodySchema = z.object({ turnstileToken: token }).strict();
export type ClaimAirdropBody = z.infer<typeof claimAirdropBodySchema>;

export const airdropStatusResponse = obj({
  campaign: z.literal('preseason'),
  code: str,
  rideUnlocked: bool,
  telegram: obj({ bound: bool, member: bool }),
  x: obj({ bound: bool, ageOk: bool, followersOk: bool, follows: bool, quoteOk: bool }),
  turnstile: obj({ required: bool, passed: bool }),
  claimed: bool,
  claimedAt: strOrNull,
  settlement: z.literal('ledger'),
});
