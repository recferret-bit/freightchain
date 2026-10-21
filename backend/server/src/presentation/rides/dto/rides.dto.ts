import { z } from 'zod';
import { TRANSACTION_SIGNATURE_MESSAGE, isTransactionSignature } from '../../../domain/economy/transaction-signature.js';
import type { RideReport } from '../../../domain/rides/ride-report.js';
import { MAX_REPORTED_DISTANCE } from '../../../domain/rides/ride-rules.js';
import { RIDE_TIER_IDS } from '../../../domain/rides/ride-tier.js';
import { FREE_LEVEL_IDS, TRIP_ID_MAX_LENGTH, isFreeLevel } from '../../../domain/rides/ride-trip.js';
import { REASON_MAX_LENGTH } from '../../../domain/rides/ride-rules.js';
import { AUX_MAX_CHARS, clampAux, type BatchBody } from '../../../domain/telemetry/ride-batch.entity.js';
import { BATCH_MAX_INPUTS, BATCH_MAX_SAMPLES, BATCH_MAX_SEQ, INPUT_CODE_MAX_LENGTH, MAX_GAME_SECONDS, SAMPLE_MAX_WIDTH, TRAFFIC_MAX_FRAMES, TRAFFIC_MAX_ROW } from '../../../domain/telemetry/telemetry-rules.js';

/** `tutorial` / `assist`: the free ride's helpers (the lobby's two checkboxes). Optional – an absent flag is off; a paid tier refuses them (409), see CreateRideHandler.
    `level`: the free ride's LEVEL, 1 EASY · 2 MEDIUM · 3 HARD (ride-trip.ts FREE_LEVELS); absent = 1; a paid tier refuses it (409), HARD refuses ASSIST (409). */
export const createRideBodySchema = z.object({
  tier: z.enum(RIDE_TIER_IDS), tutorial: z.boolean().optional(), assist: z.boolean().optional(),
  level: z.number().int().refine(isFreeLevel, `level must be one of ${FREE_LEVEL_IDS.join(', ')}`).optional(),
}).strict();
export type CreateRideBody = z.infer<typeof createRideBodySchema>;

/** `trip`: the trip id the game built its road from (GET /api/rides/:id → `trip`, null read as 'classic'). Optional – absent = not compared (older games).
    A ride re-chosen in the lobby between that read and this start has another trip: 409 `ride_rechosen`, the game reloads the ride (StartRideHandler).
    `ranked`: declare this start for the weekly skill board. Absent = unranked. A blocked country, missing 18+, or a full weekly cap is 409, not a silent downgrade. */
/** mgMode and lang are optional here (not .default()) so `{ trip }` still types as StartRideBody. Strict: `{ trafficVersion }` is a 400, so a client cannot downgrade the stamped traffic protocol. */
export const startRideBodySchema = z.object({
  trip: z.string().min(1).max(TRIP_ID_MAX_LENGTH).optional(),
  ranked: z.boolean().optional(),
  mgMode: z.enum(['normal', 'more-time']).optional(),
  lang: z.enum(['en', 'ru']).optional(),
}).strict();

export const appealBodySchema = z.object({ reason: z.string().trim().min(1).max(500) }).strict();
export type AppealBody = z.infer<typeof appealBodySchema>;
export type StartRideBody = z.infer<typeof startRideBodySchema>;

/** 43-char base64url. Checked again in the handler; a mac of this shape is not mg_bad_mac until a session key exists. */
const mgMacSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

export const minigameEventParamsSchema = z.object({
  id: z.string().min(1).max(80),
  eventId: z.string().min(1).max(80),
}).strict();
export type MinigameEventParams = z.infer<typeof minigameEventParamsSchema>;

export const minigameAssetParamsSchema = minigameEventParamsSchema.extend({
  assetId: z.string().regex(/^[0-9a-f]{16}$/),
}).strict();
export type MinigameAssetParams = z.infer<typeof minigameAssetParamsSchema>;

export const openMinigameBodySchema = z.object({
  mac: mgMacSchema,
  variantSeq: z.union([z.literal(0), z.literal(1)]),
  safe: z.boolean().optional(),
}).strict();
export type OpenMinigameBody = z.infer<typeof openMinigameBodySchema>;

export const answerMinigameBodySchema = z.object({
  mac: mgMacSchema,
  nonce: z.string().min(1).max(64),
  attempt: z.number().int().min(1).max(3),
  answer: z.string().max(64),
  safe: z.boolean().optional(),
}).strict();
export type AnswerMinigameBody = z.infer<typeof answerMinigameBodySchema>;

export const minigameOpenResponse = z.object({
  id: z.string(), ordinal: z.number(), kind: z.literal('phone-sms'), variantSeq: z.number(), nonce: z.string(), windowMs: z.number(), revealedAt: z.number(),
  layout: z.object({
    threads: z.array(z.unknown()), cab: z.array(z.unknown()), keys: z.array(z.string()), sendSlot: z.number(), iconOrder: z.array(z.string().nullable()),
  }).strict(),
}).strict();
export const minigameAnswerResponse = z.object({
  outcome: z.string(), penaltyS: z.number(), attempts: z.number(), status: z.string(),
}).strict();

export const confirmPaymentBodySchema = z.object({ signature: z.string().refine(isTransactionSignature, TRANSACTION_SIGNATURE_MESSAGE) }).strict();
export type ConfirmPaymentBody = z.infer<typeof confirmPaymentBodySchema>;

/* The game client sends progress reports. Heartbeats are STRICT (garbage → 400, the client just beats again); the final /end report is LENIENT
   (a garbled value is dropped, never an error – otherwise a finished ride would sit "running" and block the wallet). */
const finite = (v: unknown): number | null => {
  if (v === undefined || v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const flag = z.unknown().transform((v) => v === true);
const text = z.unknown().transform((v) => (typeof v === 'string' ? v.slice(0, 64) : null));
const lenientNumber = z.unknown().transform(finite);
const lenientMetres = z.unknown().transform((v) => {
  const n = finite(v);
  return n !== null && n >= 0 && n <= MAX_REPORTED_DISTANCE ? n : null;
});
const strictOptionalNumber = z.unknown().transform((v, ctx) => {
  if (v === undefined || v === null) return null;
  const n = finite(v);
  if (n === null) ctx.addIssue({ code: 'custom', message: 'must be a finite number' });
  return n;
});
const strictMetres = z.unknown().transform((v, ctx) => {
  const n = finite(v);
  if (n === null || n < 0 || n > MAX_REPORTED_DISTANCE) ctx.addIssue({ code: 'custom', message: `must be a number between 0 and ${MAX_REPORTED_DISTANCE}` });
  return n ?? 0;
});

export const heartbeatBodySchema = z
  .object({
    s: strictMetres, t: lenientNumber, hull: strictOptionalNumber, paused: flag, night: flag, crashesVehicle: lenientNumber, crashesBuilding: lenientNumber,
    route: z.unknown().optional(), // the game echoes its live-feed route; the server assigns the route, so this key is accepted and dropped
  })
  .strict()
  .transform((b): RideReport => ({ s: b.s, t: b.t, hull: b.hull, paused: b.paused, night: b.night, crashesVehicle: b.crashesVehicle, crashesBuilding: b.crashesBuilding }));
export type HeartbeatBody = z.infer<typeof heartbeatBodySchema>;

/* A recording batch is STRICT (the client re-sends on a 400 only if it has a bug – nothing here is user input). Array caps keep a hostile client from storing junk.
   An input's code may be empty: some OEM / IME / virtual-keyboard keys have no KeyboardEvent.code. */
const gameSeconds = z.number().finite().min(0).max(MAX_GAME_SECONDS);
export const batchBodySchema = z
  .object({
    seq: z.number().int().min(0).max(BATCH_MAX_SEQ),
    prevHash: z.string().min(1).max(64),
    t0: gameSeconds,
    t1: gameSeconds,
    samples: z.array(z.array(z.number().finite()).max(SAMPLE_MAX_WIDTH)).max(BATCH_MAX_SAMPLES),
    inputs: z.array(z.tuple([z.number().finite().min(0), z.string().max(INPUT_CODE_MAX_LENGTH), z.union([z.literal(0), z.literal(1)])])).max(BATCH_MAX_INPUTS),
    trafficProof: z.string().max(85_000).optional(),
    hash: z.string().regex(/^[0-9a-f]{64}$/, 'must be a lowercase hex SHA-256').nullish(),
    protocol: z.literal(2).optional(),
    mac: z.string().regex(/^[0-9a-f]{64}$/, 'must be a lowercase hex HMAC-SHA256').optional(),
    streams: z.string().max(120_000).optional(),
    named: z.object({
      inp: z.string().min(1).max(120_000), clk: z.string().min(1).max(120_000), chk: z.string().min(1).max(120_000),
      mg: z.string().min(1).max(120_000), env: z.string().min(1).max(120_000),
      startTick: z.number().int().min(0), endTick: z.number().int().min(0),
    }).strict().optional(),
    aux: z.record(z.unknown()).optional(), // oversized aux is dropped in the transform, never a 400
    // replays' traffic track: LENIENT – anything malformed is dropped (.catch), never a 400 (a refused batch would break the recording's chain)
    traffic: z.array(z.array(z.number().finite()).max(TRAFFIC_MAX_ROW)).max(TRAFFIC_MAX_FRAMES).optional().catch(undefined),
  })
  .strict()
  .transform((b): BatchBody => {
    const kept = clampAux(b);
    return {
      seq: kept.seq, prevHash: kept.prevHash, t0: kept.t0, t1: kept.t1, samples: kept.samples, inputs: kept.inputs, hash: kept.hash ?? null,
      ...(kept.trafficProof !== undefined ? { trafficProof: kept.trafficProof } : {}),
      ...(kept.traffic?.length ? { traffic: kept.traffic } : {}),
      ...(kept.protocol === 2 ? { protocol: 2 as const } : {}),
      ...(kept.mac !== undefined ? { mac: kept.mac } : {}),
      ...(kept.streams ? { streams: kept.streams } : {}),
      ...(kept.named ? { named: kept.named } : {}),
      ...(kept.aux !== undefined ? { aux: kept.aux } : {}),
    };
  });
export type BatchBodyInput = z.infer<typeof batchBodySchema>;

export const endRideBodySchema = z
  .object({
    outcome: z.enum(['shift', 'failed']), s: lenientMetres, t: lenientNumber, hull: lenientNumber, paused: flag, night: flag, crashesVehicle: lenientNumber, crashesBuilding: lenientNumber,
    reason: z.unknown().transform((v) => (typeof v === 'string' ? v.slice(0, REASON_MAX_LENGTH) : null)),
    route: z.unknown().optional(), // same live-feed echo as the heartbeat; not part of the end report
  })
  .strict()
  .transform((b) => ({ outcome: b.outcome, reason: b.reason, report: { s: b.s, t: b.t, hull: b.hull, paused: b.paused, night: b.night, crashesVehicle: b.crashesVehicle, crashesBuilding: b.crashesBuilding } satisfies RideReport }));
export type EndRideBody = z.infer<typeof endRideBodySchema>;
