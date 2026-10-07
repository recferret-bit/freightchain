import { z } from 'zod';
import { TRANSACTION_SIGNATURE_MESSAGE, isTransactionSignature } from '../../../domain/economy/transaction-signature.js';
import type { RideReport } from '../../../domain/rides/ride-report.js';
import { MAX_REPORTED_DISTANCE } from '../../../domain/rides/ride-rules.js';
import { RIDE_TIER_IDS } from '../../../domain/rides/ride-tier.js';
import { REASON_MAX_LENGTH } from '../../../domain/rides/ride-rules.js';
import type { BatchBody } from '../../../domain/telemetry/ride-batch.entity.js';
import { BATCH_MAX_INPUTS, BATCH_MAX_SAMPLES, BATCH_MAX_SEQ, INPUT_CODE_MAX_LENGTH, MAX_GAME_SECONDS, SAMPLE_MAX_WIDTH } from '../../../domain/telemetry/telemetry-rules.js';

export const createRideBodySchema = z.object({ tier: z.enum(RIDE_TIER_IDS) });
export type CreateRideBody = z.infer<typeof createRideBodySchema>;

export const confirmPaymentBodySchema = z.object({ signature: z.string().refine(isTransactionSignature, TRANSACTION_SIGNATURE_MESSAGE) });
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
  .object({ s: strictMetres, t: lenientNumber, hull: strictOptionalNumber, paused: flag, route: text, night: flag })
  .transform((b): RideReport => ({ s: b.s, t: b.t, hull: b.hull, paused: b.paused, route: b.route, night: b.night }));
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
    hash: z.string().regex(/^[0-9a-f]{64}$/, 'must be a lowercase hex SHA-256').nullish(),
  })
  .transform((b): BatchBody => ({ seq: b.seq, prevHash: b.prevHash, t0: b.t0, t1: b.t1, samples: b.samples, inputs: b.inputs, hash: b.hash ?? null }));
export type BatchBodyInput = z.infer<typeof batchBodySchema>;

export const endRideBodySchema = z
  .object({ outcome: z.enum(['shift', 'failed']), s: lenientMetres, t: lenientNumber, hull: lenientNumber, paused: flag, route: text, night: flag, reason: z.unknown().transform((v) => (typeof v === 'string' ? v.slice(0, REASON_MAX_LENGTH) : null)) })
  .transform((b) => ({ outcome: b.outcome, reason: b.reason, report: { s: b.s, t: b.t, hull: b.hull, paused: b.paused, route: b.route, night: b.night } satisfies RideReport }));
export type EndRideBody = z.infer<typeof endRideBodySchema>;
