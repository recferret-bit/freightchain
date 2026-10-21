import { inflateRawSync } from 'node:zlib';
import { Injectable } from '@nestjs/common';
import { eventTimesUs, intervalsFromTimesUs } from '../../../domain/anticheat/inp-intervals.js';
import type { BatchFacts, RideBatch } from '../../../domain/telemetry/ride-batch.entity.js';
import { RideBatchRepositoryPort } from '../../../application/ports/telemetry/ride-batch.repository.port.js';
import type { TransactionHandle } from '../../../application/ports/shared/transaction.port.js';
import { RideBatchMapper } from '../mappers/ride-batch.mapper.js';
import { clientFor } from '../prisma-client.js';
import { PrismaService } from '../prisma.service.js';

function inflateOrRaw(encoded: string): Buffer {
  const raw = Buffer.from(encoded, 'base64');
  try { return inflateRawSync(raw); } catch { return raw; }
}

@Injectable()
export class RideBatchPrismaRepository extends RideBatchRepositoryPort {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  /** ONE statement with ON CONFLICT DO NOTHING: two uploads of the same seq race safely, exactly one stores. */
  async insert(batch: RideBatch, tx?: TransactionHandle): Promise<boolean> {
    const data = {
      ...RideBatchMapper.toCreateData(batch),
      ...(batch.body.named?.inp ? { inp: Uint8Array.from(inflateOrRaw(batch.body.named.inp)), inpAt: batch.receivedAt } : {}),
    };
    const { count } = await clientFor(this.prisma, tx).rideBatch.createMany({ data: [data], skipDuplicates: true });
    return count === 1;
  }

  override async inpRetentionRows() {
    const rows = await this.prisma.rideBatch.findMany({
      where: { inp: { not: null } },
      select: { rideId: true, inpAt: true, ride: { select: { pool: { select: { status: true, payoutAt: true } } } } },
    });
    return rows.map((row) => ({
      rideId: row.rideId,
      inpAt: row.inpAt,
      payoutFinalizedAt: row.ride.pool?.status === 'settled' ? row.ride.pool.payoutAt : null,
    }));
  }

  override async nullInp(rows: readonly { rideId: string }[]): Promise<number> {
    const ids = [...new Set(rows.map((row) => row.rideId))];
    if (!ids.length) return 0;
    const result = await this.prisma.rideBatch.updateMany({ where: { rideId: { in: ids }, inp: { not: null } }, data: { inp: null } });
    return result.count;
  }

  /** The top 20 verified rides by distance, one trace each, while that pool's validation window is still open. */
  override async validationTraces(now: Date) {
    const rides = await this.prisma.ride.findMany({
      where: { verdict: { is: { status: 'verified' } }, pool: { is: { status: 'active', payoutAt: { gt: now } } }, batches: { some: { inp: { not: null } } } },
      orderBy: [{ lastS: 'desc' }, { id: 'asc' }],
      take: 20,
      select: { id: true, wallet: true, batches: { where: { inp: { not: null } }, orderBy: { seq: 'asc' }, select: { inp: true } } },
    });
    return rides.map((ride) => {
      const times = ride.batches.flatMap((batch) => batch.inp ? eventTimesUs(Buffer.from(batch.inp).toString('utf8')) : []);
      return { rideId: ride.id, wallet: ride.wallet, intervalsMs: intervalsFromTimesUs(times) };
    });
  }

  override async otherRideIntervals(excludeRideId: string): Promise<number[][]> {
    const rows = await this.prisma.rideBatch.findMany({
      where: { rideId: { not: excludeRideId }, inp: { not: null } },
      orderBy: [{ rideId: 'asc' }, { seq: 'asc' }],
      take: 400,
      select: { rideId: true, inp: true },
    });
    const times = new Map<string, number[]>();
    for (const row of rows) {
      if (!row.inp || (times.size >= 20 && !times.has(row.rideId))) continue;
      const bucket = times.get(row.rideId) ?? [];
      bucket.push(...eventTimesUs(Buffer.from(row.inp).toString('utf8')));
      times.set(row.rideId, bucket);
    }
    return [...times.values()].map((row) => intervalsFromTimesUs(row));
  }

  async deleteForRidesEndedBefore(cutoff: Date): Promise<number> {
    const { count } = await this.prisma.rideBatch.deleteMany({
      // kept: flagged rides (until reviewed), completed shifts that were never judged (JUDGE NOW still needs their recording), and every ride of a pool that
      // is still live – its attestation is computed from the recording until the pool is settled (a pool on hold past the retention window)
      where: { ride: {
        endedAt: { lt: cutoff },
        OR: [{ verdict: { is: { status: { not: 'flagged' } } } }, { verdict: { is: null }, status: { not: 'completed' } }],
        AND: [{ OR: [{ poolId: null }, { pool: { is: { status: { notIn: ['open', 'active'] } } } }] }],
      } },
    });
    return count;
  }

  /** Rows stored before summaries existed (summary null, or an older format) are inflated and summarised here – once judged they are not rewritten. */
  async listFactsByRide(rideId: string, tx?: TransactionHandle): Promise<BatchFacts[]> {
    const rows = await clientFor(this.prisma, tx).rideBatch.findMany({ where: { rideId }, orderBy: { seq: 'asc' }, select: { rideId: true, seq: true, prevHash: true, hash: true, hashOk: true, serverHash: true, t0: true, t1: true, summary: true, receivedAt: true } });
    const out: BatchFacts[] = [];
    for (const r of rows) {
      const summary = RideBatchMapper.summaryOf(r.summary) ?? (await this.summarise(rideId, r.seq, tx));
      out.push({ seq: r.seq, prevHash: r.prevHash, hash: r.hash, hashOk: r.hashOk, serverHash: r.serverHash, t0: r.t0, t1: r.t1, summary, receivedAt: r.receivedAt });
    }
    return out;
  }

  private async summarise(rideId: string, seq: number, tx?: TransactionHandle) {
    const row = await clientFor(this.prisma, tx).rideBatch.findUniqueOrThrow({ where: { rideId_seq: { rideId, seq } } });
    return RideBatchMapper.toDomain(row).summary;
  }

  async totalBytes(rideId: string, tx?: TransactionHandle): Promise<number> {
    const agg = await clientFor(this.prisma, tx).rideBatch.aggregate({ where: { rideId }, _sum: { bytes: true } });
    return agg._sum.bytes ?? 0;
  }

  async listByRide(rideId: string, tx?: TransactionHandle): Promise<RideBatch[]> {
    const rows = await clientFor(this.prisma, tx).rideBatch.findMany({ where: { rideId }, orderBy: { seq: 'asc' } });
    return rows.map((row) => RideBatchMapper.toDomain(row));
  }

  async listFrom(rideId: string, fromSeq: number, limit: number): Promise<RideBatch[]> {
    const rows = await this.prisma.rideBatch.findMany({ where: { rideId, seq: { gte: fromSeq } }, orderBy: { seq: 'asc' }, take: limit });
    return rows.map((row) => RideBatchMapper.toDomain(row));
  }

  async extent(rideId: string): Promise<{ lastSeq: number | null; t1: number }> {
    const agg = await this.prisma.rideBatch.aggregate({ where: { rideId }, _max: { seq: true, t1: true } });
    return { lastSeq: agg._max.seq, t1: agg._max.t1 ?? 0 };
  }
}
