import { z } from 'zod';
import { bool, num, numOrNull, obj, str, strOrNull } from './wire.js';

export const liveRideResponse = obj({
  id: str, wallet: str, tier: str, route: strOrNull, timeScale: num, paused: bool, hull: numOrNull, driveSeconds: num, minSeconds: num, distance: num, completeDist: num, progress: num, sinceBeat: num, startedAt: num, viewers: num, signal: z.enum(['live', 'paused', 'weak']),
});
export const liveFeedResponse = obj({
  now: num, rides: z.array(liveRideResponse), upcoming: z.array(obj({ wallet: str, tier: str, minSeconds: num, paidAt: num })),
  recent: z.array(obj({ id: str, wallet: str, tier: str, route: strOrNull, status: str, distance: num, endedAt: numOrNull })),
  totals: obj({ shifts: num, rides: num, ridesFree: num, ridesPaid: num, metres: num, seconds: num, drivers: num, crashes: num, donations: num }),
  online: obj({ total: num, browsing: num, watching: num, driving: num, players: num }),
});
export const replaysPageResponse = obj({
  rows: z.array(obj({
    id: str, wallet: str, tier: str, route: strOrNull, status: str, failCode: strOrNull, distance: num, driveSeconds: num, minSeconds: num, timeScale: num, startedAt: num, endedAt: num, replay: bool,
  })),
  next: strOrNull,
});
const applied = obj({ t: num, s: num, lat: numOrNull, placed: bool });
export const rideEventResponse = obj({
  id: num, kind: z.enum(['message', 'donation', 'honk']), wallet: str, text: strOrNull, effect: strOrNull, lamports: num, at: num, applied: applied.nullable(), signature: strOrNull,
});
const features = obj({ chat: bool, donations: bool, payment: z.enum(['mock', 'chain']), effects: bool });
const totals = obj({ messages: num, donations: num, lamports: num });
const watchRide = obj({
  id: str, wallet: str, tier: str, route: strOrNull, loadout: z.record(str, str).nullable(), trip: strOrNull, level: numOrNull, seed: num, status: str, live: bool, timeScale: num, minSeconds: num, completeDist: num,
  startedAt: num, endedAt: numOrNull, driveSeconds: num, distance: num, hull: numOrNull, poolId: numOrNull, ranked: bool.optional(),
});
const roadOutcome = obj({ hole: str, type: str, s: num, t: num, outcome: z.enum(['hit', 'ignored', 'avoided', 'unmeasured', 'other']), expected: num, got: num });
const watchBatch = obj({ seq: num, t0: num, t1: num, samples: z.array(z.array(num)), traffic: z.array(z.array(num)).optional(), road: z.array(roadOutcome).optional() });
export const watchResponse = obj({
  now: num, ride: watchRide, recording: obj({ lastSeq: numOrNull, t1: num }), batches: z.array(watchBatch), events: z.array(rideEventResponse), totals, viewers: num, features,
});
export const roadPlanResponse = obj({ rideId: str, seed: num, version: num, from: num, to: num, chunk: num, holes: z.array(obj({ id: str, ci: num, type: str, s: num, lat: num })) });
export const donationOrderResponse = obj({
  order: obj({ id: str, effect: str, lamports: num, to: str, memo: str, reference: strOrNull }),
  transaction: obj({ transaction: str, blockhash: str, lastValidBlockHeight: num }),
});
export const confirmDonationResponse = z.union([obj({ status: z.literal('pending') }), obj({ status: z.literal('paid'), event: rideEventResponse })]);
export const reconcileDonationResponse = z.union([confirmDonationResponse, obj({ status: z.literal('not_found') })]);
export const inboxResponse = obj({ now: num, events: z.array(rideEventResponse), totals, viewers: num, features, muted: z.array(str) });
export const muteResponse = obj({ wallet: str, muted: bool });
