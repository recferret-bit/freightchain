import { roadPlanFor } from '../road/road-plan.js';
import type { Ride } from '../rides/ride.entity.js';
import type { BatchFacts } from '../telemetry/ride-batch.entity.js';
import { checkChallenges, type ChallengeScores } from './challenge-checks.js';
import { checkHumanTiming, type HumanScores } from './human-checks.js';
import { checkAgreement, checkChain, checkInputsPresent, checkSamples, recordingScores, type RecordingScores } from './recording-checks.js';
import { RULES_VERSION } from './verdict-rules.js';
import { checkWorld, type WorldScores } from './world-checks.js';
import { ConflictError } from '../shared/errors.js';
import { VerdictStatus, type VerdictDecision, type VerdictDto, type VerdictReason } from './verdict.dto.js';

export interface VerdictScores {
  recording: RecordingScores;
  human: HumanScores;
  challenges: ChallengeScores;
  /** the recording against the server's road (world-checks.ts); null = recorded before the server rebuilt it, or no batches */
  world?: WorldScores | null;
}

export interface RideVerdictProps {
  rideId: string;
  status: VerdictStatus;
  reasons: VerdictReason[];
  scores: VerdictScores;
  rulesVersion: number;
  judgedAt: Date;
  /** an admin's wallet when the status was decided by hand */
  overriddenBy: string | null;
  overriddenAt: Date | null;
  note: string | null;
  version: number;
}

export const NOTE_MAX_LENGTH = 500;

/** The server's judgement of a completed ride's recording. Any `reject` reason → rejected; else any `flag` → flagged; else verified. Only verified rides rank for prizes. */
export class RideVerdict {
  private constructor(private readonly p: RideVerdictProps) {}

  /** Judge the ride from what is stored – always the whole recording (its batches' facts: chain columns + summaries), so judging again (a late batch)
      gives the up-to-date answer. The dispatch prompts the ride issued are judged against the recording's input events. */
  static judge(ride: Ride, batches: readonly BatchFacts[], now: Date): RideVerdict {
    const facts = { rideId: ride.id, driveSeconds: ride.driveSeconds, distance: ride.distance };
    const ordered = [...batches].sort((a, b) => a.seq - b.seq);
    const chain = checkChain(facts, ordered);
    const road = { forkSwitch: (s0: number, s1: number) => roadPlanFor(ride.seed, ride.trip).layout.forkSwitch(s0, s1) }; // built lazily: only a boundary step over the governor asks
    const samples = checkSamples(ordered, road); // the ride's road: a step across a batch boundary may be a fork's road switch
    const agreement = checkAgreement(facts, ordered);
    const inputs = ordered.flatMap((b) => b.summary.inputs);
    const human = checkHumanTiming(inputs);
    const endMs = ride.endedAt && ride.startedAt ? ride.endedAt.getTime() - ride.startedAt.getTime() : Number.POSITIVE_INFINITY;
    const challenges = checkChallenges(ride.challenges, inputs, endMs);
    const world = checkWorld(ordered);
    const reasons = ordered.length === 0 ? chain : [...chain, ...samples.reasons, ...agreement.reasons, ...checkInputsPresent(facts, ordered), ...human.reasons, ...challenges.reasons, ...world.reasons];
    const status = reasons.some((r) => r.severity === 'reject') ? VerdictStatus.Rejected : reasons.length ? VerdictStatus.Flagged : VerdictStatus.Verified;
    return new RideVerdict({
      rideId: ride.id, status, reasons, rulesVersion: RULES_VERSION, judgedAt: now, version: 1, overriddenBy: null, overriddenAt: null, note: null,
      scores: { recording: recordingScores(ordered, agreement.recordedSeconds, agreement.coverage, samples.maxSpeed), human: human.scores, challenges: challenges.scores, world: world.scores },
    });
  }

  /** (the override fields are optional here so a test can restore a plain judged verdict) */
  static restore(props: Omit<RideVerdictProps, 'overriddenBy' | 'overriddenAt' | 'note'> & Partial<Pick<RideVerdictProps, 'overriddenBy' | 'overriddenAt' | 'note'>>): RideVerdict {
    return new RideVerdict({ overriddenBy: null, overriddenAt: null, note: null, ...props });
  }

  get rideId(): string { return this.p.rideId; }
  get status(): VerdictStatus { return this.p.status; }
  get reasons(): VerdictReason[] { return this.p.reasons; }
  get version(): number { return this.p.version; }
  /** an admin decided this one – judging again must not replace it */
  get isOverridden(): boolean { return this.p.overriddenBy !== null; }

  /** Append reasons found OUTSIDE the recording (the pool-level attention marks, pool-attention.ts): deduped by code, the status recomputed the way
      judge() does it (any reject → rejected, else flagged) – so a machine reject is never softened to flagged. An admin's decision is never touched.
      Returns whether anything changed (the caller saves only then: running the checks twice changes nothing the second time). */
  addReasons(reasons: readonly VerdictReason[]): boolean {
    if (this.isOverridden) return false;
    const fresh = reasons.filter((r, i) => !this.p.reasons.some((x) => x.code === r.code) && reasons.findIndex((x) => x.code === r.code) === i);
    if (!fresh.length) return false;
    this.p.reasons = [...this.p.reasons, ...fresh];
    this.p.status = this.p.reasons.some((r) => r.severity === 'reject') ? VerdictStatus.Rejected : VerdictStatus.Flagged;
    return true;
  }

  /** An admin's decision from the review queue: the status is set by hand, the judged reasons stay for the record. Deciding again replaces the decision. */
  override(decision: VerdictDecision, by: string, note: string | null, now: Date): void {
    if (decision !== VerdictStatus.Verified && decision !== VerdictStatus.Rejected) throw new ConflictError('a verdict can only be set to verified or rejected');
    this.p.status = decision;
    this.p.overriddenBy = by;
    this.p.overriddenAt = now;
    this.p.note = note === null ? null : note.slice(0, NOTE_MAX_LENGTH);
  }

  toDto(): VerdictDto {
    const { overriddenBy: by, overriddenAt: at } = this.p;
    return { status: this.p.status, reasons: this.p.reasons, judgedAt: this.p.judgedAt.getTime(), override: by && at ? { by, at: at.getTime(), note: this.p.note } : null };
  }

  snapshot(): RideVerdictProps {
    return { ...this.p };
  }
}
