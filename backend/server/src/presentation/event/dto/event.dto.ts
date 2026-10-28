import { z } from 'zod';
import { walletAddressSchema } from '../../common/dto/common.dto.js';
import { bool, num, numOrNull, obj, str, strOrNull } from '../../common/response/wire.js';

const signature = z.string().min(1).max(200);
const note = z.string().trim().min(1).max(300).nullable();
/** A Solana transaction signature: 64 bytes in base58 is 87 or 88 characters. */
export const txSignatureSchema = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{87,88}$/, 'not a Solana transaction signature');
const cents = z.array(z.number().int().min(0).max(100_000_000)).min(1).max(20);

const reviewFields = { wallet: walletAddressSchema, disqualified: z.boolean(), prizeEligible: z.literal(false).nullable(), note };
const intents = {
  event_review: z.object({ action: z.literal('event_review'), ...reviewFields }).strict(),
  event_sanctions: z.object({ action: z.literal('event_sanctions'), wallet: walletAddressSchema }).strict(),
  event_prize_table: z.object({ action: z.literal('event_prize_table'), cents }).strict(),
  event_lock: z.object({ action: z.literal('event_lock') }).strict(),
  event_payout: z.object({ action: z.literal('event_payout'), wallet: walletAddressSchema, txSignature: txSignatureSchema }).strict(),
};
/** Step 1 of every signed event action: the admin page asks for the text it will sign. */
export const eventChallengeBodySchema = z.discriminatedUnion('action', [intents.event_review, intents.event_sanctions, intents.event_prize_table, intents.event_lock, intents.event_payout]);
export type EventChallengeBody = z.infer<typeof eventChallengeBodySchema>;

export const reviewBodySchema = z.object({ ...reviewFields, signature }).strict();
export const sanctionsBodySchema = z.object({ wallet: walletAddressSchema, signature }).strict();
export const prizeTableBodySchema = z.object({ cents, signature }).strict();
export const lockBodySchema = z.object({ signature }).strict();
export const payoutBodySchema = z.object({ wallet: walletAddressSchema, txSignature: txSignatureSchema, signature }).strict();

const candidate = obj({
  wallet: str, rideId: str, bps: num, rank: num, prizeEligible: bool, place: numOrNull, amountCents: num, country: strOrNull, region: strOrNull,
  geoAccess: z.enum(['eligible', 'play_only_no_prizes', 'no_prizes']), trustScore: num, trustBlocked: bool, attempts: num, endedAt: num,
  ipPrefixHmac: z.array(str), ipOverlaps: z.array(str), disqualified: bool, prizeEligibleOverride: z.literal(false).nullable(), note: strOrNull,
  sanctionsCheckedAt: numOrNull, sanctionsClean: z.boolean().nullable(), sanctionsFresh: bool,
});
const phase = z.enum(['pending', 'preliminary', 'final']);
export const adminEventResponse = obj({
  eventId: str, phase, now: num, reviewEnd: numOrNull, appealsEnd: numOrNull, prizeTableCents: z.array(num), tableIsDefault: bool, locked: bool, lockedAt: numOrNull, paidCents: num, organizerCents: num,
  candidates: z.array(candidate),
  winners: z.array(obj({ wallet: str, place: num, amountCents: num, bps: num, rideId: str, txSignature: strOrNull, paidAt: numOrNull })),
});
export const eventReviewResponse = obj({
  wallet: str, disqualified: bool, prizeEligibleOverride: z.literal(false).nullable(), note: strOrNull, sanctionsCheckedAt: numOrNull, sanctionsClean: z.boolean().nullable(), sanctionsRef: strOrNull, updatedBy: str, updatedAt: num,
});
export const eventPrizeTableResponse = obj({ prizeTableCents: z.array(num) });
export const eventLockedResponse = obj({ eventId: str, lockedAt: num, winners: num, paidCents: num, organizerCents: num });
export const eventPayoutResponse = obj({ wallet: str, place: num, amountCents: num, txSignature: str, solscanUrl: str });
export const publicEventResponse = obj({
  eventId: str, phase, reviewEnd: numOrNull, appealsEnd: numOrNull,
  rows: z.array(obj({ rank: num, place: numOrNull, wallet: str, bps: num, amountCents: num, prizeEligible: bool, txSignature: strOrNull, solscanUrl: strOrNull })),
});
