import { enforceBatchMacMessage, requireNamedStreams } from '../../domain/shared/index.js';
import type { Ride } from '../../domain/rides/ride.entity.js';
import type { BatchBody } from '../../domain/telemetry/ride-batch.entity.js';
import type { RideBatch } from '../../domain/telemetry/ride-batch.entity.js';
import { BadRequestError } from '../../domain/shared/errors.js';
import type { HasherPort } from '../ports/shared/hasher.port.js';
import { assertBatchStreams } from './batch-streams.js';

export interface NamedBatchStreams {
  inp: string;
  clk: string;
  chk: string;
  mg: string;
  env: string;
  startTick: number;
  endTick: number;
}

/** Enforce path only. MAC over the compressed inp and chk, then inflate, then startTick order. */
export function assertEnforceBatch(hasher: HasherPort, ride: Ride, body: BatchBody & { named?: NamedBatchStreams }, before: RideBatch | undefined, inflate: (raw: Buffer) => Buffer): void {
  let named: NamedBatchStreams;
  try { named = requireNamedStreams(body.named ?? {}) as NamedBatchStreams; }
  catch (error) { throw new BadRequestError(error instanceof Error ? error.message : 'named streams missing', 'batch-streams-invalid'); }
  if (!Number.isInteger(named.startTick) || !Number.isInteger(named.endTick) || named.endTick <= named.startTick) {
    throw new BadRequestError('startTick and endTick must move forward', 'batch-streams-invalid');
  }
  if (!body.mac) throw new BadRequestError('a v2.1 batch needs a mac', 'batch-mac-missing');
  const key = ride.sessionKey;
  if (!key) throw new BadRequestError('this ride has no session key', 'batch-mac-invalid');
  const expected = hasher.hmacSha256Hex(Buffer.from(key, 'base64'), enforceBatchMacMessage(ride.id, body.seq, named.startTick, named.endTick, hasher.sha256Hex(named.inp), hasher.sha256Hex(named.chk)));
  if (expected !== body.mac) throw new BadRequestError('the batch mac does not match', 'batch-mac-invalid');
  for (const keyName of ['inp', 'clk', 'chk', 'mg', 'env'] as const) assertBatchStreams(named[keyName], inflate);
  const prevEnd = before?.body && 'named' in before.body ? (before.body as { named?: NamedBatchStreams }).named?.endTick : undefined;
  if (body.seq > 0 && (prevEnd === undefined || named.startTick < prevEnd)) throw new BadRequestError('startTick went backwards', 'batch-streams-invalid');
}
