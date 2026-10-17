import { z } from 'zod';
import { walletAddressSchema } from '../../common/dto/common.dto.js';
import type { ChallengeDto } from '../../../application/use-cases/auth/request-challenge/request-challenge.command.js';

/** 1-click SIWS challenge request schema: wallet is optional prior to wallet connection. Accepts {} or { wallet }. */
export const requestChallengeBodySchema = z.object({
  wallet: z.preprocess((v) => (v === '' ? undefined : v), walletAddressSchema.optional()),
});
export type RequestChallengeBody = z.infer<typeof requestChallengeBodySchema>;

/** Legacy challenge body schema: wallet is required (also consumed by AdminHttpController). */
export const challengeBodySchema = z.object({
  wallet: walletAddressSchema,
});
export type ChallengeBody = z.infer<typeof challengeBodySchema>;

/**
 * Sign-in verification payload:
 * - Legacy: { wallet, signature }
 * - Native 1-click SIWS: { wallet, signature, message?, nonce? }
 * The signature is checked cryptographically by the handler (a wrong one is a 401, not a 400).
 */
export const verifyBodySchema = z.object({
  wallet: walletAddressSchema,
  signature: z.string().min(1).max(200),
  message: z.string().min(1).max(2000).optional(),
  nonce: z.string().min(8).max(64).optional(),
});
export type VerifyBody = z.infer<typeof verifyBodySchema>;

export const pairParamsSchema = z.object({ id: z.string().regex(/^[0-9a-f]{32}$/, 'pair id') });
export type PairParams = z.infer<typeof pairParamsSchema>;

export type { ChallengeDto };
