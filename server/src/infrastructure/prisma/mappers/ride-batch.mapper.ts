import { gunzipSync, gzipSync } from 'node:zlib';
import { Prisma, type RideBatch as RideBatchRow } from '@prisma/client';
import { parseSummary, type BatchSummary } from '../../../domain/telemetry/batch-summary.js';
import { RideBatch, type BatchBody } from '../../../domain/telemetry/ride-batch.entity.js';

const BODY_CACHE = new Map<string, BatchBody>();
const MAX_CACHED_BODIES = 256;

function cacheKey(rideId: string, seq: number, serverHash: string | null, hash: string | null, bytes: number, payloadLen?: number): string | null {
  const sig = serverHash ?? hash;
  if (!sig) return payloadLen !== undefined ? `${rideId}:${seq}:${bytes}:${payloadLen}` : null;
  return `${rideId}:${seq}:${sig}:${bytes}`;
}

function putCachedBody(key: string | null, body: BatchBody): void {
  if (!key) return;
  if (BODY_CACHE.has(key)) BODY_CACHE.delete(key);
  else if (BODY_CACHE.size >= MAX_CACHED_BODIES) BODY_CACHE.delete(BODY_CACHE.keys().next().value!);
  BODY_CACHE.set(key, body);
}

/** Row ⇄ entity. The body travels as gzip JSON (≈ 10× smaller than the samples as text); the counts and hashes are columns so the verdict can be judged without inflating. */
export class RideBatchMapper {
  static toDomain(row: RideBatchRow): RideBatch {
    const key = cacheKey(row.rideId, row.seq, row.serverHash, row.hash, row.bytes, row.payload.length);
    let body = key ? BODY_CACHE.get(key) : undefined;
    if (body && key) {
      BODY_CACHE.delete(key);
      BODY_CACHE.set(key, body);
    } else {
      body = JSON.parse(gunzipSync(row.payload).toString('utf8')) as BatchBody;
      putCachedBody(key, body);
    }
    return RideBatch.restore({
      rideId: row.rideId, seq: row.seq, prevHash: row.prevHash, hash: row.hash, hashOk: row.hashOk, serverHash: row.serverHash, t0: row.t0, t1: row.t1,
      samples: row.samples, inputs: row.inputs, bytes: row.bytes, body, receivedAt: row.receivedAt,
      summary: RideBatchMapper.summaryOf(row.summary),
    });
  }

  /** the stored summary, or null when the row has none (or an older format) – RideBatch.restore then measures it from the body */
  static summaryOf(raw: unknown): BatchSummary | null {
    return parseSummary(raw);
  }

  static toCreateData(batch: RideBatch) {
    const p = batch.snapshot();
    const payload = gzipSync(JSON.stringify(p.body));
    putCachedBody(cacheKey(p.rideId, p.seq, p.serverHash, p.hash, p.bytes, payload.length), p.body);
    return {
      rideId: p.rideId, seq: p.seq, prevHash: p.prevHash, hash: p.hash, hashOk: p.hashOk, serverHash: p.serverHash, t0: p.t0, t1: p.t1, samples: p.samples, inputs: p.inputs, bytes: p.bytes,
      payload, receivedAt: p.receivedAt, summary: p.summary as unknown as Prisma.InputJsonValue,
    };
  }
}
