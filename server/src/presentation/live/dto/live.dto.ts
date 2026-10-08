import { z } from 'zod';
import { walletAddressSchema } from '../../common/dto/common.dto.js';
import { TRANSACTION_SIGNATURE_MESSAGE, isTransactionSignature } from '../../../domain/economy/transaction-signature.js';
import { APPLIED_MAX_LAT, APPLIED_MAX_S, EFFECT_IDS, MESSAGE_MAX_LENGTH, NOTE_MAX_LENGTH } from '../../../domain/live/live-rules.js';

/* Live streams. The text limits here are generous on raw input (the domain cleans and re-checks the visible length). */
const cursor = z.coerce.number().int().min(0).max(2_147_483_647).default(0);

export const watchQuerySchema = z.object({
  from: cursor, // first recording batch seq wanted
  after: cursor, // last feed event id already seen
  since: z.coerce.number().int().min(0).max(8.64e15).default(0), // epoch ms: also return events stamped after it (0 = none)
  leave: z.literal('1').optional().catch(undefined).transform((v) => v === '1'), // the watch page is closing
  viewer: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, 'letters, digits, - and _ only').optional().transform((v) => v ?? ''), // '' = not counted
});
export type WatchQuery = z.infer<typeof watchQuerySchema>;

export const inboxQuerySchema = z.object({ after: cursor });
export type InboxQuery = z.infer<typeof inboxQuerySchema>;

export const messageBodySchema = z.object({ text: z.string().min(1).max(MESSAGE_MAX_LENGTH * 4) });
export type MessageBody = z.infer<typeof messageBodySchema>;

export const donationBodySchema = z.object({ effect: z.enum(EFFECT_IDS), note: z.string().max(NOTE_MAX_LENGTH * 4).nullish().transform((v) => v ?? null) });
export type DonationBody = z.infer<typeof donationBodySchema>;

export const effectParamsSchema = z.object({ id: z.string().min(1).max(64), eventId: z.coerce.number().int().positive().max(2_147_483_647) });
export type EffectParams = z.infer<typeof effectParamsSchema>;

export const orderParamsSchema = z.object({ id: z.string().min(1).max(64), orderId: z.string().uuid() });
export type OrderParams = z.infer<typeof orderParamsSchema>;

export const confirmDonationBodySchema = z.object({ signature: z.string().refine(isTransactionSignature, TRANSACTION_SIGNATURE_MESSAGE) });
export type ConfirmDonationBody = z.infer<typeof confirmDonationBodySchema>;

export const muteBodySchema = z.object({ wallet: walletAddressSchema, muted: z.boolean() });
export type MuteBody = z.infer<typeof muteBodySchema>;

export const appliedBodySchema = z.object({
  t: z.number().finite().min(0).max(1e7),
  s: z.number().finite().min(0).max(APPLIED_MAX_S),
  lat: z.number().finite().min(-APPLIED_MAX_LAT).max(APPLIED_MAX_LAT).nullish().transform((v) => v ?? null),
  missed: z.boolean().optional().default(false), // an obstacle the game found no room for
});
export type AppliedBody = z.infer<typeof appliedBodySchema>;
