import { z } from 'zod';
import { walletAddressSchema } from '../../common/dto/common.dto.js';

export const challengeBodySchema = z.object({ wallet: walletAddressSchema });
export type ChallengeBody = z.infer<typeof challengeBodySchema>;

/** The signature is checked cryptographically by the handler (a wrong one is a 401, not a 400) – here it only has to be a sane string. */
export const verifyBodySchema = z.object({ wallet: walletAddressSchema, signature: z.string().min(1).max(200) });
export type VerifyBody = z.infer<typeof verifyBodySchema>;
