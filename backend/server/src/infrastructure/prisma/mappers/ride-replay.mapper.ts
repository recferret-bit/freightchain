import type { Prisma, RideReplay as RideReplayRow, RideReplayFlag as RideReplayFlagRow, VerdictStatus as VerdictStatusRow } from '@prisma/client';
import { RideReplay, type ReplayFlagCategory, type ReplayRedFlag, type ReplaySimScores } from '../../../domain/verdict/ride-replay.entity.js';
import type { VerdictStatus } from '../../../domain/verdict/verdict.dto.js';

export type RideReplayWithFlagsRow = RideReplayRow & { flags?: RideReplayFlagRow[] };

export class RideReplayMapper {
  static toDomain(row: RideReplayWithFlagsRow): RideReplay {
    const flags: ReplayRedFlag[] = row.flags && row.flags.length > 0
      ? row.flags.map((f) => ({
          code: f.code,
          category: f.category as ReplayFlagCategory,
          severity: f.severity as 'reject' | 'flag',
          detail: f.detail,
          atSecond: f.atSecond,
          atMetre: f.atMetre,
          evidence: (f.evidence as Record<string, unknown> | null) ?? null,
        }))
      : (row.redFlags as unknown as ReplayRedFlag[]);

    return RideReplay.restore({
      id: row.id,
      rideId: row.rideId,
      seq: row.seq,
      isPaid: row.isPaid,
      status: row.status as unknown as VerdictStatus,
      simHz: row.simHz,
      rulesVersion: row.rulesVersion,
      seed: row.seed,
      trip: row.trip,
      batchesCount: row.batchesCount,
      samplesCount: row.samplesCount,
      recordedSeconds: row.recordedSeconds,
      simulatedSeconds: row.simulatedSeconds,
      recordedDistance: row.recordedDistance,
      simulatedDistance: row.simulatedDistance,
      recordedHull: row.recordedHull,
      simulatedHull: row.simulatedHull,
      simulatedCrashesVehicle: row.simulatedCrashesVehicle,
      simulatedCrashesBuilding: row.simulatedCrashesBuilding,
      eventsExpected: row.eventsExpected,
      eventsCorrelated: row.eventsCorrelated,
      redFlags: flags,
      scores: row.scores as unknown as ReplaySimScores,
      queuedAt: row.queuedAt,
      startedAt: row.startedAt,
      completedAt: row.completedAt,
      error: row.error,
    });
  }

  static data(replay: RideReplay) {
    const p = replay.snapshot();
    return {
      rideId: p.rideId,
      seq: p.seq,
      isPaid: p.isPaid,
      status: p.status as unknown as VerdictStatusRow,
      simHz: p.simHz,
      rulesVersion: p.rulesVersion,
      seed: p.seed,
      trip: p.trip,
      batchesCount: p.batchesCount,
      samplesCount: p.samplesCount,
      recordedSeconds: p.recordedSeconds,
      simulatedSeconds: p.simulatedSeconds,
      recordedDistance: p.recordedDistance,
      simulatedDistance: p.simulatedDistance,
      recordedHull: p.recordedHull,
      simulatedHull: p.simulatedHull,
      simulatedCrashesVehicle: p.simulatedCrashesVehicle,
      simulatedCrashesBuilding: p.simulatedCrashesBuilding,
      eventsExpected: p.eventsExpected,
      eventsCorrelated: p.eventsCorrelated,
      redFlags: p.redFlags as unknown as Prisma.InputJsonValue,
      scores: p.scores as unknown as Prisma.InputJsonValue,
      queuedAt: p.queuedAt,
      startedAt: p.startedAt,
      completedAt: p.completedAt,
      error: p.error,
    };
  }
}
