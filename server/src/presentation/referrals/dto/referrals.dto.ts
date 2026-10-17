import { z } from 'zod';
import { GIFT_ITEMS, REFERRAL_CODE_ALPHABET, REFERRAL_CODE_LENGTH } from '../../../domain/referral/referral-rules.js';

export const bindReferralBodySchema = z.object({
  code: z.string().trim().toUpperCase().regex(new RegExp(`^[${REFERRAL_CODE_ALPHABET}]{${REFERRAL_CODE_LENGTH}}$`), 'a referral code is 8 letters or digits'),
});
export type BindReferralBody = z.infer<typeof bindReferralBodySchema>;

export const giftReferralBodySchema = z.object({ item: z.enum(GIFT_ITEMS) });
export type GiftReferralBody = z.infer<typeof giftReferralBodySchema>;
