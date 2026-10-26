import { z } from 'zod';
import { authChallengeResponse, bool, dailyStatsResponse, num, numOrNull, obj, prizePoolResponse, rideReplayResponse, statsResponse, str, strOrNull, verdictResponse } from './wire.js';
import { poolStandingsResponse } from './economy.response.js';

const list = <T extends z.ZodTypeAny>(row: T) => obj({ rows: z.array(row) });
export const adminQueueResponse = obj({ flagged: num, underReview: num });
const adminRideRow = obj({
  id: str, wallet: str, tier: str, status: str, reason: strOrNull, route: strOrNull, distance: num, driveSeconds: num, timeScale: num, createdAt: num, startedAt: numOrNull, endedAt: numOrNull, verdict: strOrNull, overridden: bool, poolId: numOrNull, review: strOrNull,
});
export const adminRidesResponse = list(adminRideRow);
export const adminReplaysResponse = obj({ queue: obj({ kind: z.enum(['redis', 'memory']), depth: num }), rows: z.array(rideReplayResponse) });
export const adminRideDetailResponse = obj({
  ride: adminRideRow.and(obj({ seed: num, minSeconds: num, completeDist: num, hull: numOrNull, lastHbAt: numOrNull, lamports: num, roundId: numOrNull })),
  verdict: verdictResponse.and(obj({ scores: z.unknown(), rulesVersion: num })).nullable(),
  replays: z.array(rideReplayResponse).optional(),
  batches: z.array(obj({ seq: num, t0: num, t1: num, samples: num, inputs: num, bytes: num, hashOk: bool, receivedAt: num })),
  payment: obj({ signature: str, lamports: num, at: num }).nullable(),
});
export const signInRowsResponse = list(obj({ wallet: str, at: num, ip: strOrNull, userAgent: strOrNull }));
export const adminActionsResponse = list(obj({ wallet: str, action: str, target: str, detail: z.record(str, z.unknown()), requestId: strOrNull, at: num }));
export const adminLogsResponse = obj({ entries: z.array(obj({ time: str, level: str, context: str, msg: str }).passthrough()) });
export const adminOverviewResponse = obj({
  now: num, players: num, signIns24h: num, running: num, rides: z.record(str, num), verdicts: z.record(str, num), underReview: num,
  payments: obj({ count: num, lamports: num }), telemetry: obj({ batches: num, bytes: num }), config: obj({ verdictEnforce: bool, telemetryRetentionDays: num }),
  activeAlerts: z.array(obj({ id: str, kind: str, text: str, at: num })), undeliveredAlerts: num,
});
export const adminPlayersResponse = list(obj({ wallet: str, freeRides: num, freeRidesMax: num, createdAt: num, lastSignInAt: numOrNull, rides: num, tickets: num }));
export const adminPlayerResponse = obj({
  player: obj({ wallet: str, freeRides: num, freeRidesMax: num, freeDay: str, createdAt: num, tutorialPassedAt: numOrNull, age18At: numOrNull, lossAt: numOrNull }),
  stats: statsResponse.nullable(), tickets: z.array(obj({ poolId: num, balance: num, bought: num })), grants: z.array(obj({ poolId: num, delta: num, source: str, ref: strOrNull, at: num })),
  payments: obj({ count: num, lamports: num }), signIns: z.array(obj({ wallet: str, at: num, ip: strOrNull, userAgent: strOrNull })), rides: z.array(adminRideRow),
});
const adminPoolRow = obj({
  id: num, address: str, tier: str, label: str, status: str, priceLamports: num, minTickets: num, maxTickets: num, maxPerWallet: num, ticketsSold: num, buyers: num, vaultLamports: num, sponsored: num, roundId: numOrNull, rideSeed: num, prepDeadline: num, playDeadline: num, createdAt: num, syncedAt: numOrNull,
});
export const adminPoolsResponse = list(adminPoolRow);
export const adminPoolResponse = obj({ pool: adminPoolRow.and(obj({ prizeBps: num, seedBps: num, feeBps: num, feeTreasury: str, seedTreasury: str })), holders: z.array(obj({ wallet: str, balance: num, bought: num })) });
export const adminStatsResponse = obj({ now: num, global: statsResponse.and(obj({ drivers: num, updatedAt: num })).nullable(), daily: z.array(dailyStatsResponse), top: z.array(obj({ wallet: str, stats: statsResponse })) });
export const adminSessionsResponse = obj({ rows: z.array(obj({ wallet: str, lastAt: num, signIns: num, ip: strOrNull, userAgent: strOrNull })), truncated: bool });
export const gameSettingsResponse = obj({
  eventModeEnabled: num, eventWeekStartUtc: num, eventLastStartUtc: num, eventWeekEndUtc: num, airdropXBudgetCents: num, airdropXCheckCostCents: num,
  freeOnSignup: num, freeRidesDailyMax: num, weeklyTicket1hEnabled: num, weeklyTicket1hDays: num, weeklyTicket4hEnabled: num, weeklyTicket4hDays: num, weeklyTicket8hEnabled: num, weeklyTicket8hDays: num,
  editorJobsPerDay: num, editorMaxSteps: num, editorMaxOutputTokens: num, editorMaxInputKTokens: num, editorJobsParallel: num, referralMax: num, referralInviteStart: num, referralInviteStep: num, referralShiftsPerStep: num,
  referralInviteTtlDays: num, referralFreeRideWindowDays: num, referralFreeRidesReferrer: num, referralFreeRidesReferee: num, referralFreeRideWeeklyCap: num, referralReferrerPartBps: num, referralRideCapLamports: num, referralDonationShareBps: num, referralDonationCapLamports: num, referralCountWeeklyGrant: num,
});
export const settingUpdatedResponse = obj({ key: str, value: num, settings: gameSettingsResponse });
export const freeRidesAdjustedResponse = obj({ wallet: str, delta: num, freeRides: num, freeRidesMax: num });
/** The token is the fc_admin cookie. The body is the session the page shows. */
export const adminSignInResponse = obj({ wallet: str, expiresAt: num });
export const moderationResponse = obj({ ok: z.literal(true), status: str });
export const proposalApprovedResponse = obj({ ok: z.literal(true), status: z.literal('applied'), id: str });
export const poolHoldResponse = obj({ poolId: num, held: bool, by: strOrNull, at: numOrNull, note: strOrNull });
export const poolPayoutsResponse = obj({ pools: z.array(obj({ pool: prizePoolResponse, standings: poolStandingsResponse, hold: obj({ by: str, at: num, note: strOrNull }).nullable() })) });
export { authChallengeResponse as adminChallengeResponse };
