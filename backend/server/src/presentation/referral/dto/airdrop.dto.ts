import { z } from 'zod';
import { bool, obj, str, strOrNull } from '../../common/response/wire.js';

const token = z.string().max(2048).optional();

export const verifyTelegramBodySchema = z.object({
  telegramUserId: z.string().trim().regex(/^\d{1,32}$/),
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
