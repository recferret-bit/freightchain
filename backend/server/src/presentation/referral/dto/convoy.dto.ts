import { z } from 'zod';
import { REFERRAL_CODE_ALPHABET, REFERRAL_CODE_LENGTH } from '../../../domain/referral/referral-rules.js';
import { bool, num, obj, str, strOrNull } from '../../common/response/wire.js';

export const convoyBindBodySchema = z.object({
  code: z.string().trim().toUpperCase().regex(new RegExp(`^[${REFERRAL_CODE_ALPHABET}]{${REFERRAL_CODE_LENGTH}}$`), 'a referral code is 8 letters or digits'),
}).strict();
export type ConvoyBindBody = z.infer<typeof convoyBindBodySchema>;

export const convoyPrivacyBodySchema = z.object({ convoyHidden: z.boolean() }).strict();
export type ConvoyPrivacyBody = z.infer<typeof convoyPrivacyBodySchema>;

const leaderRow = obj({ rank: num, wallet: strOrNull, displayName: str, qualified: num, active: num, hidden: bool });
export const convoyLeaderboardResponse = obj({ privacyColumn: z.enum(['present', 'missing']), rows: z.array(leaderRow), me: leaderRow });
export const convoyBindResponse = obj({
  referee: str, referrer: str, status: z.enum(['pending', 'active', 'qualified', 'expired']), expiresAt: str, pending: num, maxPending: num, idempotent: bool,
});
export const convoyPrivacyResponse = obj({ convoyHidden: bool, column: z.enum(['present', 'missing']) });
