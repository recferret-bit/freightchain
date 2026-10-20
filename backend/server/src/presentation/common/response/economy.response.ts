import { z } from 'zod';
import {
  chainEventResponse, num, numOrNull, obj, prizePoolResponse, statsResponse, str, strOrNull, ticketBalanceResponse, ticketOrderResponse, bool,
} from './wire.js';
export { ticketOrderResponse };

const freeLevel = obj({ level: num, trip: str, name: str, seconds: num, completeDist: num, tutorial: bool, assist: bool });
const tierSchedule = obj({ saleHours: num, playHours: num, reviewHours: num });
export const tiersResponse = obj({
  solUsd: numOrNull, treasury: strOrNull, paymentMode: z.enum(['program', 'transfer']),
  tiers: z.array(obj({ id: str, usd: num, seconds: num, completeDist: num, lamports: numOrNull, available: bool, onSale: bool, schedule: tierSchedule.nullable(), pool: prizePoolResponse.nullable(), levels: z.array(freeLevel).optional() })),
});
const moneySplit = obj({ entries: num, carry: num, grand: num, top20: num, nextSeed: num, fees: num });
const usdSplit = obj({ grand: numOrNull, top20: numOrNull, nextSeed: numOrNull, fees: numOrNull, entries: numOrNull });
export const legacyPoolResponse = obj({ round: obj({ id: num, startsAt: num, endsAt: num }), entries: num, split: moneySplit, settled: bool, solUsd: numOrNull, usd: usdSplit, pools: z.array(prizePoolResponse) });
const lbRow = obj({ rank: num, wallet: str, distance: num, seconds: num, hull: numOrNull, rides: num, sns: strOrNull.optional() });
const standing = obj({ board: z.enum(['round', 'all', 'free']), level: numOrNull, tier: strOrNull, rank: numOrNull, distance: num, seconds: num, hull: numOrNull, rides: num });
export const leaderboardResponse = obj({
  board: z.enum(['round', 'all', 'free']), level: numOrNull, tier: strOrNull, round: obj({ id: num, endsAt: num }), prizeRanks: num, verifiedOnly: bool, sort: z.enum(['distance', 'time', 'hull', 'rides']),
  page: num, pageSize: num, total: num, rows: z.array(lbRow), me: obj({ rank: num, distance: num, seconds: num, hull: numOrNull, rides: num }).nullable(), standing: z.array(standing).nullable(),
});
export const poolListResponse = obj({ pools: z.array(prizePoolResponse), finished: z.array(prizePoolResponse) });
export const prizePoolDetailResponse = prizePoolResponse.and(obj({ recent: z.array(chainEventResponse) }));
const rank = obj({ rank: num, wallet: str, distance: num, rides: num, lamports: num, paid: bool, signature: strOrNull });
export const poolStandingsResponse = obj({
  poolId: num, tier: str, label: str, playDeadline: num, payoutAt: num, prizeLamports: num, final: bool, payout: obj({ state: str, note: strOrNull, held: bool }), underReview: num, ranks: z.array(rank),
});
const promoEffect = z.discriminatedUnion('kind', [
  obj({ kind: z.literal('ride'), tier: str }),
  obj({ kind: z.literal('tickets'), tier: str, poolId: numOrNull, credits: num }),
  obj({ kind: z.literal('free_rides'), count: num }),
  obj({ kind: z.literal('cosmetic'), slot: str, item: str }),
]);
export const promoResponse = obj({
  code: str, effect: promoEffect, label: str, description: strOrNull, state: str, maxRedemptions: numOrNull, redeemed: num, perWallet: num, startsAt: num, expiresAt: numOrNull, disabledAt: numOrNull, note: strOrNull, createdAt: num,
});
export const promoListResponse = obj({ promos: z.array(promoResponse) });
export const promoRedemptionListResponse = obj({ rows: z.array(obj({ code: str, wallet: str, n: num, at: num, label: str })) });
export const promoRedeemedResponse = z.discriminatedUnion('kind', [
  obj({ kind: z.literal('tickets'), code: str, label: str, poolId: num, tier: str, added: num, balance: num, cap: num }),
  obj({ kind: z.literal('ride'), code: str, label: str, tier: str }),
  obj({ kind: z.literal('free_rides'), code: str, label: str, added: num, freeRides: num }),
  obj({ kind: z.literal('cosmetic'), code: str, label: str, slot: str, item: str }),
]);
export const myPromosResponse = obj({
  redemptions: z.array(obj({ code: str, label: str, description: strOrNull, kind: z.enum(['ride', 'tickets', 'free_rides', 'cosmetic']), at: num })),
  grants: z.array(obj({ code: str, tier: str })),
});
const signable = obj({ transaction: str, message: str, lastValidBlockHeight: num });
export const refundTransactionResponse = obj({ poolId: num, needsFail: bool, lamports: num, transaction: str, message: str, feePayer: str, lastValidBlockHeight: num });
export const payoutTransactionsResponse = obj({
  poolId: num, prizeLamports: num, ranks: z.array(obj({ rank: num, wallet: str, distance: num, rides: num, lamports: num, paid: bool })), committedRoot: strOrNull, payFrom: numOrNull,
  commit: signable.nullable(), veto: signable.nullable(), transactions: z.array(signable.and(obj({ rank: num, to: str, lamports: num }))), close: signable.nullable(), note: strOrNull,
});
export const settledSignatureResponse = obj({
  signature: str, status: z.enum(['pending', 'invalid', 'done']), detail: strOrNull,
  events: z.array(obj({ index: num, kind: str, poolId: num, outcome: str, orderId: strOrNull, detail: strOrNull })),
});
export const pendingTicketResponse = obj({ order: ticketOrderResponse.nullable() });
export const confirmTicketResponse = z.union([
  obj({ status: z.literal('paid'), order: ticketOrderResponse }),
  obj({ status: z.literal('pending'), order: ticketOrderResponse }),
]);
export const reconcileTicketResponse = z.union([
  obj({ status: z.literal('paid'), order: ticketOrderResponse }),
  obj({ status: z.literal('pending'), order: ticketOrderResponse }),
  obj({ status: z.literal('not_found'), order: ticketOrderResponse }),
]);
export const ticketPaymentResponse = obj({
  orderId: str, mode: z.literal('program'), programId: str, poolId: num, lamports: num, transaction: str, message: str, feePayer: str, computeUnits: num, priorityMicrolamports: num, blockhash: str, lastValidBlockHeight: num, reference: str,
});
const garagePart = obj({ id: str, isDefault: bool, owned: bool, worn: bool, unlockedAt: numOrNull, code: strOrNull, name: str, description: str, price: strOrNull });
export const garageResponse = obj({
  equipped: z.record(str, str), slots: z.array(obj({ slot: str, parts: z.array(garagePart), collected: num, total: num })), progress: obj({ collected: num, total: num, percent: num }),
});
export const wardrobeResponse = obj({ equipped: z.record(str, str), unlocked: z.record(str, z.array(str)) });
const builtTx = obj({ transaction: str, blockhash: str, lastValidBlockHeight: num, message: str, feePayer: str, computeUnits: num, priorityMicrolamports: num });
export const pledgeResponse = obj({
  id: str, pdaAddress: str, rideId: str, sponsor: str, driver: str, poolId: num, maxLamports: str, lamportsPerKm: str, targetKm: num, status: str, createSignature: strOrNull, settled: bool,
  earnedLamports: str, refundedLamports: str, createdAt: num, settledAt: numOrNull, signature: strOrNull, slot: strOrNull,
});
export const createdPledgeResponse = obj({ pledge: pledgeResponse, transaction: builtTx });
export const pledgesResponse = z.array(pledgeResponse);
const achievement = obj({
  id: str, name: str, desc: str, icon: str, family: str, tier: num, tierName: str, earnedAt: numOrNull, awardedAtRoundClose: bool, progress: obj({ value: num, target: num }),
  nft: obj({ status: str, assetId: strOrNull, signature: strOrNull }).nullable(),
});
const ticketGrant = obj({ poolId: num, delta: num, source: str, ref: strOrNull, at: num });
export const profileResponse = obj({
  wallet: str, createdAt: num, freeRides: num, freeRidesMax: num, nextFreeRideAt: numOrNull, demo: bool, demoScale: num,
  stats: obj({ rides: num, completed: num, metres: num, bestMetres: num, paidRides: num, spentLamports: num, ticketsBought: num }),
  career: statsResponse, recent: z.array(obj({ tier: str, status: str, distance: num, hull: numOrNull, route: strOrNull, timeScale: num, startedAt: num, endedAt: numOrNull, verdict: strOrNull, review: strOrNull })),
  achievements: z.array(achievement), badgeChain: obj({ collection: str, tree: str }).nullable(), tickets: z.array(ticketBalanceResponse), grants: z.array(ticketGrant),
  agreements: obj({ age18: bool, loss: bool, age18At: numOrNull, lossAt: numOrNull }), sns: strOrNull.optional(),
});
