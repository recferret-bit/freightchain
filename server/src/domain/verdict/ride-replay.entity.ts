import { RULES_VERSION } from './verdict-rules.js';
import { VerdictStatus, type VerdictReason } from './verdict.dto.js';

export type ReplayFlagCategory = 'traffic' | 'obstacle' | 'event' | 'physics' | 'recording' | 'challenge' | 'human';

/** A structured anti-fraud red flag discovered when verifying a ride's replay on the backend. */
export interface ReplayRedFlag {
  readonly code: string;
  readonly category: ReplayFlagCategory;
  readonly severity: 'reject' | 'flag';
  readonly detail: string;
  readonly atSecond: number | null;
  readonly atMetre: number | null;
  readonly evidence: Record<string, unknown> | null;
}

export interface ReplaySimScores {
  readonly simHz: number;
  readonly physicsSubsteps: number;
  readonly plannedHolesReached: number;
  readonly plannedHolesHit: number;
  readonly plannedHolesIgnored: number;
  readonly donatedObstaclesPlaced: number;
  readonly donatedObstaclesHit: number;
  readonly donatedObstaclesIgnored: number;
  readonly liveEventsExpected: number;
  readonly liveEventsCorrelated: number;
  readonly liveEventsUnapplied: number;
  readonly trafficSpawned: number;
  readonly trafficContacts: number;
  readonly trafficCrashesIgnored: number;
  readonly trafficBumpsIgnored: number;
  readonly physicsSpeedViolations: number;
  readonly maxSpeedGainRatio: number;
  readonly maxOffroadSeconds: number;
  readonly gaslessSteps: number;
}

export interface RideReplayProps {
  id: string;
  rideId: string;
  seq: number;
  isPaid: boolean;
  status: VerdictStatus;
  simHz: number;
  rulesVersion: number;
  seed: number;
  trip: string | null;
  batchesCount: number;
  samplesCount: number;
  recordedSeconds: number;
  simulatedSeconds: number;
  recordedDistance: number;
  simulatedDistance: number;
  recordedHull: number;
  simulatedHull: number;
  simulatedCrashesVehicle: number;
  simulatedCrashesBuilding: number;
  eventsExpected: number;
  eventsCorrelated: number;
  redFlags: ReplayRedFlag[];
  scores: ReplaySimScores;
  queuedAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  error: string | null;
}

export interface RideReplayDto {
  id: string;
  rideId: string;
  seq: number;
  isPaid: boolean;
  status: VerdictStatus;
  simHz: number;
  rulesVersion: number;
  seed: number;
  trip: string | null;
  batchesCount: number;
  samplesCount: number;
  recordedSeconds: number;
  simulatedSeconds: number;
  recordedDistance: number;
  simulatedDistance: number;
  recordedHull: number;
  simulatedHull: number;
  simulatedCrashesVehicle: number;
  simulatedCrashesBuilding: number;
  eventsExpected: number;
  eventsCorrelated: number;
  redFlags: ReplayRedFlag[];
  scores: ReplaySimScores;
  queuedAt: number;
  startedAt: number | null;
  completedAt: number | null;
  error: string | null;
}

export interface RideReplaysDto {
  rideId: string;
  replays: RideReplayDto[];
}

export const EMPTY_REPLAY_SCORES: ReplaySimScores = {
  simHz: 10,
  physicsSubsteps: 2,
  plannedHolesReached: 0,
  plannedHolesHit: 0,
  plannedHolesIgnored: 0,
  donatedObstaclesPlaced: 0,
  donatedObstaclesHit: 0,
  donatedObstaclesIgnored: 0,
  liveEventsExpected: 0,
  liveEventsCorrelated: 0,
  liveEventsUnapplied: 0,
  trafficSpawned: 0,
  trafficContacts: 0,
  trafficCrashesIgnored: 0,
  trafficBumpsIgnored: 0,
  physicsSpeedViolations: 0,
  maxSpeedGainRatio: 0,
  maxOffroadSeconds: 0,
  gaslessSteps: 0,
};

/** One replay verification session of a ride (1-to-many per ride in verdict.RideReplay, with normalized red flags in verdict.RideReplayFlag). */
export class RideReplay {
  private constructor(private readonly p: RideReplayProps) {}

  static createPending(i: {
    id: string;
    rideId: string;
    seq: number;
    isPaid: boolean;
    seed: number;
    trip: string | null;
    simHz?: number;
    now: Date;
  }): RideReplay {
    return new RideReplay({
      id: i.id,
      rideId: i.rideId,
      seq: i.seq,
      isPaid: i.isPaid,
      status: VerdictStatus.Pending,
      simHz: i.simHz ?? 10,
      rulesVersion: RULES_VERSION,
      seed: i.seed,
      trip: i.trip,
      batchesCount: 0,
      samplesCount: 0,
      recordedSeconds: 0,
      simulatedSeconds: 0,
      recordedDistance: 0,
      simulatedDistance: 0,
      recordedHull: 100,
      simulatedHull: 100,
      simulatedCrashesVehicle: 0,
      simulatedCrashesBuilding: 0,
      eventsExpected: 0,
      eventsCorrelated: 0,
      redFlags: [],
      scores: { ...EMPTY_REPLAY_SCORES, simHz: i.simHz ?? 10 },
      queuedAt: i.now,
      startedAt: null,
      completedAt: null,
      error: null,
    });
  }

  static restore(props: RideReplayProps): RideReplay {
    return new RideReplay({
      ...props,
      redFlags: props.redFlags.map((f) => ({ ...f, evidence: f.evidence ? { ...f.evidence } : null })),
      scores: { ...props.scores },
    });
  }

  get id(): string { return this.p.id; }
  get rideId(): string { return this.p.rideId; }
  get seq(): number { return this.p.seq; }
  get isPaid(): boolean { return this.p.isPaid; }
  get status(): VerdictStatus { return this.p.status; }
  get simHz(): number { return this.p.simHz; }
  get redFlags(): readonly ReplayRedFlag[] { return this.p.redFlags; }
  get scores(): ReplaySimScores { return this.p.scores; }

  markStarted(now: Date): void {
    this.p.startedAt = now;
    this.p.error = null;
  }

  complete(result: {
    batchesCount: number;
    samplesCount: number;
    recordedSeconds: number;
    simulatedSeconds: number;
    recordedDistance: number;
    simulatedDistance: number;
    recordedHull: number;
    simulatedHull: number;
    simulatedCrashesVehicle: number;
    simulatedCrashesBuilding: number;
    eventsExpected: number;
    eventsCorrelated: number;
    redFlags: readonly ReplayRedFlag[];
    scores: ReplaySimScores;
    now: Date;
  }): void {
    const flags = [...result.redFlags];
    this.p.status = flags.some((f) => f.severity === 'reject')
      ? VerdictStatus.Rejected
      : flags.length > 0
        ? VerdictStatus.Flagged
        : VerdictStatus.Verified;
    this.p.batchesCount = result.batchesCount;
    this.p.samplesCount = result.samplesCount;
    this.p.recordedSeconds = result.recordedSeconds;
    this.p.simulatedSeconds = result.simulatedSeconds;
    this.p.recordedDistance = result.recordedDistance;
    this.p.simulatedDistance = result.simulatedDistance;
    this.p.recordedHull = result.recordedHull;
    this.p.simulatedHull = result.simulatedHull;
    this.p.simulatedCrashesVehicle = result.simulatedCrashesVehicle;
    this.p.simulatedCrashesBuilding = result.simulatedCrashesBuilding;
    this.p.eventsExpected = result.eventsExpected;
    this.p.eventsCorrelated = result.eventsCorrelated;
    this.p.redFlags = flags;
    this.p.scores = { ...result.scores };
    if (!this.p.startedAt) this.p.startedAt = result.now;
    this.p.completedAt = result.now;
    this.p.error = null;
  }

  markFailed(error: string, now: Date): void {
    this.p.error = error.slice(0, 500);
    this.p.completedAt = now;
  }

  /** Converts anti-fraud red flags into VerdictReason items for RideVerdict integration. */
  toVerdictReasons(): VerdictReason[] {
    const seen = new Set<string>();
    const out: VerdictReason[] = [];
    for (const f of this.p.redFlags) {
      if (seen.has(f.code)) continue;
      seen.add(f.code);
      out.push({ code: f.code, detail: f.detail, severity: f.severity });
    }
    return out;
  }

  toDto(): RideReplayDto {
    return {
      id: this.p.id,
      rideId: this.p.rideId,
      seq: this.p.seq,
      isPaid: this.p.isPaid,
      status: this.p.status,
      simHz: this.p.simHz,
      rulesVersion: this.p.rulesVersion,
      seed: this.p.seed,
      trip: this.p.trip,
      batchesCount: this.p.batchesCount,
      samplesCount: this.p.samplesCount,
      recordedSeconds: this.p.recordedSeconds,
      simulatedSeconds: this.p.simulatedSeconds,
      recordedDistance: this.p.recordedDistance,
      simulatedDistance: this.p.simulatedDistance,
      recordedHull: this.p.recordedHull,
      simulatedHull: this.p.simulatedHull,
      simulatedCrashesVehicle: this.p.simulatedCrashesVehicle,
      simulatedCrashesBuilding: this.p.simulatedCrashesBuilding,
      eventsExpected: this.p.eventsExpected,
      eventsCorrelated: this.p.eventsCorrelated,
      redFlags: this.p.redFlags,
      scores: this.p.scores,
      queuedAt: this.p.queuedAt.getTime(),
      startedAt: this.p.startedAt?.getTime() ?? null,
      completedAt: this.p.completedAt?.getTime() ?? null,
      error: this.p.error,
    };
  }

  snapshot(): RideReplayProps {
    return {
      ...this.p,
      redFlags: this.p.redFlags.map((f) => ({ ...f, evidence: f.evidence ? { ...f.evidence } : null })),
      scores: { ...this.p.scores },
    };
  }
}
