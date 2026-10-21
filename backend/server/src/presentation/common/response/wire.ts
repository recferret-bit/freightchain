import { z, type ZodRawShape, type ZodTypeAny } from 'zod';
import { ORDER_STATUSES } from '../../../domain/economy/ticket-order.types.js';
import { PAYOUT_STATES, POOL_STATUSES } from '../../../domain/economy/pool.types.js';

/** Wire object. Extra keys pass: the interceptor returns the original body, so a check must not strip fields. */
export const obj = <T extends ZodRawShape>(shape: T) => z.object(shape).passthrough();
export const str = z.string();
export const num = z.number();
export const bool = z.boolean();
export const strOrNull = str.nullable();
export const numOrNull = num.nullable();
export const enums = (values: readonly [string, ...string[]]) => z.enum(values);
const rec = z.record(z.string(), z.unknown());

export const livenessResponse = obj({ status: z.literal('ok') });
export const readinessResponse = obj({ status: z.enum(['ok', 'degraded']), checks: obj({ database: obj({ status: z.enum(['up', 'down']), latencyMs: num.optional() }) }) });
export const okResponse = obj({ ok: z.literal(true) });

export const authChallengeResponse = obj({
  message: str, domain: str.optional(), statement: str.optional(), uri: str.optional(), version: str.optional(), chainId: str.optional(), nonce: str.optional(), issuedAt: str.optional(), expirationTime: str.optional(), address: str.optional(),
});
/** `expiresAt` is a Date on the object; JSON is an ISO string. */
const signedToken = obj({ token: str, expiresAt: str });
export const agreementsResponse = obj({ age18: bool, loss: bool, age18At: numOrNull, lossAt: numOrNull });
export const weeklyTicketResponse = obj({ tier: str, expiresAt: num, rideId: strOrNull });
export const readyFreeRideResponse = obj({ id: str, level: numOrNull, trip: strOrNull, tutorial: bool, assist: bool });
export const ticketBalanceResponse = obj({
  poolId: num, tier: str, label: str, status: enums(POOL_STATUSES), balance: num, bought: num, cap: num, refundable: bool, ridable: bool, rideBy: num, burned: bool,
});
export const meResponse = obj({
  wallet: str, freeRides: num, freeRidesMax: num, nextFreeRideAt: numOrNull, guest: bool, createdAt: num, tutorialPassed: bool, demo: bool, demoScale: num,
  tickets: z.array(ticketBalanceResponse), readyFreeRide: readyFreeRideResponse.nullable(), agreements: agreementsResponse, sns: strOrNull.optional(), weeklyTickets: z.array(weeklyTicketResponse),
});
export const signInResponse = obj({ profile: meResponse, session: signedToken });
/** The pairing secret is the httpOnly cookie; the body is only the code. */
export const openPairResponse = obj({ id: str, expiresAt: str });
export const pollPairResponse = obj({ status: z.enum(['pending', 'ready']), wallet: str.optional(), token: str.optional() });

const honkBand = obj({ pct: z.union([z.literal(20), z.literal(50), z.literal(100)]), reached: bool, amount: str });
export const honkQuoteResponse = obj({ state: z.enum(['none', 'preview', 'pending', 'minted', 'withheld']), pays: str, quote: str, full: str, bands: z.array(honkBand) });
export const verdictResponse = obj({
  status: z.enum(['pending', 'verified', 'flagged', 'rejected']),
  reasons: z.array(obj({ code: str, detail: str, severity: z.enum(['reject', 'flag']) })),
  judgedAt: num,
  override: obj({ by: str, at: num, note: strOrNull }).nullable(),
});
export const rideChallengeResponse = obj({ id: str, action: str, label: str, key: str, codes: z.array(str), issuedMs: num, deadlineMs: num });
const loadout = z.record(z.string(), str);
export const rideResponse = obj({
  trafficVersion: num, id: str, tier: str, seed: num, status: str, minSeconds: num, completeDist: num, timeScale: num, priceUsd: num, lamports: num,
  quoteExpiresAt: numOrNull, roundId: numOrNull, poolId: numOrNull, driveSeconds: num, distance: num, reason: strOrNull, loadout: loadout.nullable(),
  trip: strOrNull, level: numOrNull, route: strOrNull, startHour: numOrNull, tutorial: bool, assist: bool, verdict: verdictResponse.nullable(), honk: honkQuoteResponse,
  review: strOrNull, challenge: rideChallengeResponse.nullable(), seedCommitment: strOrNull.optional(), blockhash: strOrNull.optional(), slot: numOrNull.optional(),
  ranked: bool, cleanMetres: numOrNull, promo: bool, weeklyGrant: bool,
  sessionKey: str.optional(), keyId: str.optional(), protocol: z.literal(2).optional(),
  trafficSaltCommit: str.nullable().optional(), holeSaltCommit: str.nullable().optional(),
});
export const pendingRideResponse = obj({ ride: rideResponse.nullable() });
const replayFlag = obj({ code: str, category: str, severity: z.enum(['reject', 'flag']), detail: str, atSecond: numOrNull, atMetre: numOrNull, evidence: rec.nullable() });
const replayScores = obj({
  simHz: num, physicsSubsteps: num, plannedHolesReached: num, plannedHolesHit: num, plannedHolesIgnored: num, donatedObstaclesPlaced: num, donatedObstaclesHit: num, donatedObstaclesIgnored: num,
  liveEventsExpected: num, liveEventsCorrelated: num, liveEventsUnapplied: num, trafficSpawned: num, trafficContacts: num, trafficCrashesIgnored: num, trafficBumpsIgnored: num, physicsSpeedViolations: num, maxSpeedGainRatio: num, maxOffroadSeconds: num, gaslessSteps: num,
});
export const rideReplayResponse = obj({
  id: str, rideId: str, seq: num, isPaid: bool, status: z.enum(['pending', 'verified', 'flagged', 'rejected']), simHz: num, rulesVersion: num, seed: num, trip: strOrNull,
  batchesCount: num, samplesCount: num, recordedSeconds: num, simulatedSeconds: num, recordedDistance: num, simulatedDistance: num, recordedHull: num, simulatedHull: num,
  simulatedCrashesVehicle: num, simulatedCrashesBuilding: num, eventsExpected: num, eventsCorrelated: num, redFlags: z.array(replayFlag), scores: replayScores,
  queuedAt: num, startedAt: numOrNull, completedAt: numOrNull, error: strOrNull,
});
export const rideReplaysResponse = obj({ rideId: str, replays: z.array(rideReplayResponse) });
export const paymentInstructionsResponse = obj({ treasury: str, lamports: num, memo: str, quoteExpiresAt: numOrNull, blockhash: str, lastValidBlockHeight: num, transaction: str, reference: str });
export const confirmPaymentResponse = z.union([obj({ status: z.literal('paid'), ride: rideResponse }), obj({ status: z.literal('pending') })]);
export const reconcilePaymentResponse = obj({ status: str, ride: rideResponse.optional() });
export const batchReceiptResponse = obj({ seq: num, stored: bool, hashOk: bool });
export const publicRideResponse = obj({
  id: str, route: strOrNull, tier: str, status: str, reason: strOrNull, km: num, driveSeconds: num, finishedAt: numOrNull, round: num, rank: numOrNull,
  paymentSignature: strOrNull, seed: num, seedSlot: numOrNull, wallet: str, fullWallet: strOrNull, tipsLamports: num, pledgesLamports: num,
  verdict: obj({ status: z.enum(['verified', 'flagged', 'rejected']), reasons: z.array(str) }).nullable(), sns: strOrNull.optional(),
});

export const statsResponse = obj({
  rides: num, ridesFree: num, ridesPaid: num, ridesCompleted: num, seconds: num, metres: num, crashes: num, crashesVehicle: num, crashesBuilding: num, donations: num, donationLamports: num,
});
export const globalStatsResponse = statsResponse.and(obj({ drivers: num, updatedAt: num }));
export const dailyStatsResponse = statsResponse.and(obj({ day: str }));

const payout = obj({ state: enums(PAYOUT_STATES), note: strOrNull, held: bool });
const splitBps = obj({ prizeBps: num, seedBps: num, feeBps: num, referralBps: num });
export const prizePoolResponse = obj({
  id: num, address: str, tier: str, label: str, status: enums(POOL_STATUSES), priceLamports: num, minTickets: num, maxTickets: num, maxPerWallet: num, sold: num, buyers: num, toGo: num, progressPct: num,
  prepDeadline: num, playDeadline: num, payoutAt: num, payout, vaultLamports: num, sponsoredLamports: num, potLamports: num, split: splitBps, treasuries: obj({ fee: str, seed: str }), roundId: numOrNull,
  opensAt: num, salesCloseAt: num, lastStartAt: num, playCloseAt: num, validationUntil: num,
  phase: z.enum(['upcoming', 'open', 'finishing', 'validating', 'paid', 'closed']),
});
export const chainEventResponse = obj({ signature: str, kind: str, wallet: strOrNull, lamports: numOrNull, outcome: str, at: num, finalized: bool });
export const ticketOrderResponse = obj({
  id: str, poolId: num, qty: num, lamports: num, status: enums(ORDER_STATUSES), createdAt: num, expiresAt: num, paidAt: numOrNull, refundedAt: numOrNull, signature: strOrNull, reference: strOrNull,
});

export type ResponseSchema = ZodTypeAny;
