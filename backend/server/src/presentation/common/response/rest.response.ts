import { z } from 'zod';
import { bool, num, obj, str, strOrNull } from './wire.js';

const linked = obj({ type: z.enum(['transaction', 'external-link', 'post']), label: str, href: str });
const completed = obj({ type: z.literal('completed'), icon: str, title: str, description: str, label: str });
const next = obj({ next: obj({ type: z.literal('inline'), action: completed }) });
export const actionsJsonResponse = obj({ rules: z.array(obj({ pathPattern: str, apiPath: str })) });
export const actionCardResponse = obj({ type: z.literal('action'), icon: str, title: str, description: str, label: str, links: obj({ actions: z.array(linked) }) });
export const actionPostResponse = obj({ type: z.literal('post'), message: str, links: next });
export const actionTxResponse = obj({ type: z.literal('transaction'), transaction: str, message: str, links: next });
export const actionLinkResponse = obj({ type: z.literal('external-link'), externalLink: str, message: str });

export const snsReverseResponse = obj({ wallet: str, domain: strOrNull });
export const snsResolveResponse = obj({ domain: str, wallet: strOrNull });
export const solanaPayLinkResponse = obj({ label: str, icon: str });
export const solanaPayTxResponse = obj({ transaction: str, message: str });
export const telemetryAckResponse = obj({ enabled: bool, accepted: num, dropped: num });
export const clientErrorAckResponse = obj({ enabled: bool, accepted: num });
export const chainFeesResponse = obj({ priorityMicrolamports: num, computeUnits: num, estimatedFeeLamports: num, blockhashTtlSeconds: num });
export const chainWebhookResponse = obj({ received: num, settled: num, pending: num });
const convoyPolicy = obj({ m1Amount: num, m1Weeks: num, m2Amount: num, m2Weeks: num, minTrust: num, promoRanked: num });
const convoyInvite = obj({ policy: convoyPolicy, wallet: str, status: str, at: str, expiresAt: str, weeks: num, tasksComplete: bool, m1: bool, m2: bool, promo: str });
export const referralViewResponse = obj({
  rules: convoyPolicy.and(obj({ pendingHours: num, windowDays: num, activityDays: num })),
  code: str, capacity: num, used: num, pending: num, available: num, max: num, gift: str, referredBy: strOrNull, invites: z.array(convoyInvite), inbound: convoyInvite.nullable(), hidden: bool, legacyQualified: num, trustEligible: bool,
  rewards: z.array(obj({ kind: str, referee: str, amount: num, paidUnits: str, state: str, at: str, releaseAt: strOrNull, signature: strOrNull, reason: strOrNull })),
});
export const honkAccountResponse = obj({
  balance: str, minted: str, burned: str, visuals: z.array(obj({ id: str, slot: str, item: str, name: str })), chain: obj({ programId: str }).nullable(),
});
export const honkCatalogResponse = z.array(obj({ slot: str, item: str, name: str, description: str, price: strOrNull, isDefault: bool }));
export const honkBurnResponse = obj({ balance: str, pays: str });
export const honkVisualResponse = obj({ nft: obj({ id: str, slot: str, item: str, name: str, burned: str }), balance: str, chain: obj({ mint: str, signature: strOrNull }).nullable() });
export const honkTimeResponse = obj({ balance: str, pays: str, phase: z.enum(['day', 'night']) });
export const honkWeatherResponse = obj({ balance: str, pays: str, weather: z.enum(['snow', 'clear']) });
const prizeRow = obj({ place: num, wallet: str, bps: num, corrections: num, submittedAt: num, payout: bool });
const prizeSettlement = obj({ weekId: str, phase: z.enum(['ranked', 'verification', 'appeals', 'payout']), verifyEnds: num, appealsEnd: num, payoutAt: num, payoutEnds: num });
export const prizeBoardResponse = obj({
  weekId: str, tier: z.enum(['1h', '4h', '8h']), starts: num, ends: num, phase: z.enum(['ranked', 'verification', 'appeals', 'payout']), verifyEnds: num, appealsEnd: num, payoutAt: num, season: num, seasonWeek: num, liveFinal: bool, settlement: prizeSettlement.nullable(), board: z.array(prizeRow),
});
