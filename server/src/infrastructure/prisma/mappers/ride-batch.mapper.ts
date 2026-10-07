import { gunzipSync, gzipSync } from 'node:zlib';
import type { RideBatch as RideBatchRow } from '@prisma/client';
import { RideBatch, type BatchBody } from '../../../domain/telemetry/ride-batch.entity.js';

/** Row ⇄ entity. The body travels as gzip JSON (≈ 10× smaller than the samples as text); the counts and hashes are columns so the verdict can be judged without inflating. */
export class RideBatchMapper {
  static toDomain(row: RideBatchRow): RideBatch {
    return RideBatch.restore({
      rideId: row.rideId, seq: row.seq, prevHash: row.prevHash, hash: row.hash, hashOk: row.hashOk, t0: row.t0, t1: row.t1,
      samples: row.samples, inputs: row.inputs, bytes: row.bytes, body: JSON.parse(gunzipSync(row.payload).toString('utf8')) as BatchBody, receivedAt: row.receivedAt,
    });
  }

  static toCreateData(batch: RideBatch) {
    const p = batch.snapshot();
    return {
      rideId: p.rideId, seq: p.seq, prevHash: p.prevHash, hash: p.hash, hashOk: p.hashOk, t0: p.t0, t1: p.t1, samples: p.samples, inputs: p.inputs, bytes: p.bytes,
      payload: gzipSync(JSON.stringify(p.body)), receivedAt: p.receivedAt,
    };
  }
}
