import type { Ride } from '../rides/ride.entity.js';
import type { RideBatch } from '../telemetry/ride-batch.entity.js';
import { checkHumanTiming, type HumanScores } from './human-checks.js';
import { checkAgreement, checkChain, checkInputsPresent, checkSamples, recordingScores, type RecordingScores } from './recording-checks.js';
import { RULES_VERSION } from './verdict-rules.js';
import { VerdictStatus, type VerdictDto, type VerdictReason } from './verdict.dto.js';

export interface VerdictScores {
  recording: RecordingScores;
  human: HumanScores;
}

export interface RideVerdictProps {
  rideId: string;
  status: VerdictStatus;
  reasons: VerdictReason[];
  scores: VerdictScores;
  rulesVersion: number;
  judgedAt: Date;
  version: number;
}

/** The server's judgement of a completed ride's recording. Any `reject` reason → rejected; else any `flag` → flagged; else verified. Only verified rides rank for prizes. */
export class RideVerdict {
  private constructor(private readonly p: RideVerdictProps) {}

  /** Judge the ride from what is stored – always the whole recording, so judging again (a late batch) gives the up-to-date answer. */
  static judge(ride: Ride, batches: readonly RideBatch[], now: Date): RideVerdict {
    const facts = { rideId: ride.id, driveSeconds: ride.driveSeconds, distance: ride.distance };
    const ordered = [...batches].sort((a, b) => a.seq - b.seq);
    const chain = checkChain(facts, ordered);
    const samples = checkSamples(ordered);
    const agreement = checkAgreement(facts, ordered);
    const inputs = ordered.flatMap((b) => b.body.inputs);
    const human = checkHumanTiming(inputs);
    const reasons = ordered.length === 0 ? chain : [...chain, ...samples.reasons, ...agreement.reasons, ...checkInputsPresent(facts, ordered), ...human.reasons];
    const status = reasons.some((r) => r.severity === 'reject') ? VerdictStatus.Rejected : reasons.length ? VerdictStatus.Flagged : VerdictStatus.Verified;
    return new RideVerdict({
      rideId: ride.id, status, reasons, rulesVersion: RULES_VERSION, judgedAt: now, version: 1,
      scores: { recording: recordingScores(ordered, agreement.recordedSeconds, agreement.coverage, samples.maxSpeed), human: human.scores },
    });
  }

  static restore(props: RideVerdictProps): RideVerdict {
    return new RideVerdict({ ...props });
  }

  get rideId(): string { return this.p.rideId; }
  get status(): VerdictStatus { return this.p.status; }
  get reasons(): VerdictReason[] { return this.p.reasons; }

  toDto(): VerdictDto {
    return { status: this.p.status, reasons: this.p.reasons, judgedAt: this.p.judgedAt.getTime() };
  }

  snapshot(): RideVerdictProps {
    return { ...this.p };
  }
}
