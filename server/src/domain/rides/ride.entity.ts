import { ConflictError } from '../shared/errors.js';
import { RideStatus, type RideOutcome } from './ride-status.js';
import type { RideTierId } from './ride-tier.js';
import type { RideReport } from './ride-report.js';
import { BATCH_SEQ_SLACK, GAME_TIME_FACTOR, GAME_TIME_SLACK_SECONDS, MIN_BATCH_SECONDS, type RecordingAllowance } from '../telemetry/telemetry-rules.js';
import {
  DRIVE_CREDIT_SLACK, DRIVE_CREDIT_SLACK_SECONDS, MAX_SPEED, REASON_MAX_LENGTH, SLACK_METRES, SPEED_SLACK,
  completeDist, isRouteId, type RideTimingRules,
} from './ride-rules.js';

export interface RideProps {
  id: string;
  wallet: string;
  tier: RideTierId;
  seed: number;
  minSeconds: number;
  completeDist: number;
  status: RideStatus;
  createdAt: Date;
  timeScale: number;
  priceUsd: number;
  lamports: number;
  solUsd: number | null;
  quoteExpiresAt: Date | null;
  roundId: number | null;
  paidAt: Date | null;
  route: string | null;
  nightSeconds: number;
  paused: boolean;
  startedAt: Date | null;
  lastHbAt: Date | null;
  lastS: number;
  lastT: number;
  driveSeconds: number;
  hull: number | null;
  endedAt: Date | null;
  reason: string | null;
  version: number;
}

export interface FreeRideInput { id: string; wallet: string; seed: number; minSeconds: number; now: Date }
export interface PaidOrderInput {
  id: string; wallet: string; tier: RideTierId; seed: number; minSeconds: number; timeScale: number;
  priceUsd: number; lamports: number; solUsd: number; now: Date; quoteTtlMs: number;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/* A ride. The CLIENT does not decide whether a ride counts: it reports progress and the server judges it –
   complete = driven ≥ minSeconds (the game's own clock, capped by the server's wall clock) AND the reported distance ≥ completeDist,
   where the distance may only grow at ≤ MAX_SPEED. This is server-timed telemetry, not a replay: a modified client can still lie within those bounds. */
export class Ride {
  private constructor(private readonly p: RideProps) {}

  private static blank(): Omit<RideProps, 'id' | 'wallet' | 'tier' | 'seed' | 'minSeconds' | 'completeDist' | 'status' | 'createdAt'> {
    return {
      timeScale: 1, priceUsd: 0, lamports: 0, solUsd: null, quoteExpiresAt: null, roundId: null, paidAt: null, route: null, nightSeconds: 0, paused: false,
      startedAt: null, lastHbAt: null, lastS: 0, lastT: 0, driveSeconds: 0, hull: null, endedAt: null, reason: null, version: 1,
    };
  }

  /** A free ride is ready at once (its credit is spent by the caller). */
  static createFree(i: FreeRideInput): Ride {
    return new Ride({ ...Ride.blank(), id: i.id, wallet: i.wallet, tier: 'free', seed: i.seed, minSeconds: i.minSeconds, completeDist: completeDist(i.minSeconds), status: RideStatus.Created, createdAt: i.now });
  }

  /** A paid order: priced in SOL at the moment of ordering, awaiting the on-chain payment. */
  static createPaidOrder(i: PaidOrderInput): Ride {
    return new Ride({
      ...Ride.blank(), id: i.id, wallet: i.wallet, tier: i.tier, seed: i.seed, minSeconds: i.minSeconds, completeDist: completeDist(i.minSeconds),
      status: RideStatus.AwaitingPayment, createdAt: i.now, timeScale: i.timeScale, priceUsd: i.priceUsd, lamports: i.lamports, solUsd: i.solUsd,
      quoteExpiresAt: new Date(i.now.getTime() + i.quoteTtlMs),
    });
  }

  static restore(props: RideProps): Ride {
    return new Ride({ ...props });
  }

  get id(): string { return this.p.id; }
  get wallet(): string { return this.p.wallet; }
  get tier(): RideTierId { return this.p.tier; }
  get seed(): number { return this.p.seed; }
  get status(): RideStatus { return this.p.status; }
  get minSeconds(): number { return this.p.minSeconds; }
  get completeDist(): number { return this.p.completeDist; }
  get timeScale(): number { return this.p.timeScale; }
  get priceUsd(): number { return this.p.priceUsd; }
  get lamports(): number { return this.p.lamports; }
  get quoteExpiresAt(): Date | null { return this.p.quoteExpiresAt; }
  get roundId(): number | null { return this.p.roundId; }
  get paidAt(): Date | null { return this.p.paidAt; }
  get driveSeconds(): number { return this.p.driveSeconds; }
  get distance(): number { return this.p.lastS; }
  get reason(): string | null { return this.p.reason; }
  get version(): number { return this.p.version; }
  get isFree(): boolean { return this.p.tier === 'free'; }

  isInStatus(...statuses: RideStatus[]): boolean {
    return statuses.includes(this.p.status);
  }

  /** The order's price is still held for the buyer (only stops NEW payment transactions – a matching payment is honoured later too). */
  quoteIsLive(now: Date): boolean {
    return (this.p.quoteExpiresAt?.getTime() ?? 0) > now.getTime();
  }

  /** A running ride whose tab vanished: it must not block the wallet forever. */
  isStaleRunning(now: Date, rules: RideTimingRules): boolean {
    return this.p.status === RideStatus.Running && (this.p.lastHbAt?.getTime() ?? 0) < now.getTime() - rules.hbTimeoutMs;
  }

  /** Recording batches are taken while the ride runs and for `graceMs` after it ended (the client flushes its last batch around /end). */
  acceptsRecording(now: Date, graceMs: number): boolean {
    if (this.p.status === RideStatus.Running) return true;
    return this.p.startedAt !== null && this.p.endedAt !== null && now.getTime() - this.p.endedAt.getTime() <= graceMs;
  }

  /** How much recording the ride may hold by `now`, from the server's wall time since the start (see telemetry-rules). */
  recordingAllowance(now: Date): RecordingAllowance {
    const elapsed = Math.max(0, (now.getTime() - (this.p.startedAt ?? now).getTime()) / 1000);
    return { maxGameSeconds: elapsed * GAME_TIME_FACTOR + GAME_TIME_SLACK_SECONDS, maxSeq: Math.floor(elapsed / MIN_BATCH_SECONDS) + BATCH_SEQ_SLACK };
  }

  /** Heartbeats closer together than hbMinIntervalMs are ignored – no free progress by spamming. */
  canAcceptHeartbeat(now: Date, rules: RideTimingRules): boolean {
    return now.getTime() - (this.p.lastHbAt?.getTime() ?? 0) >= rules.hbMinIntervalMs;
  }

  start(now: Date): void {
    this.mustBe(RideStatus.Created);
    this.p.status = RideStatus.Running;
    this.p.startedAt = now;
    this.p.lastHbAt = now;
  }

  /** The verified payment arrived (also after the quote expired): the order becomes a ready ride in the given round. */
  markPaid(roundId: number, now: Date): void {
    this.mustBe(RideStatus.AwaitingPayment, RideStatus.Expired);
    this.p.status = RideStatus.Created;
    this.p.paidAt = now;
    this.p.roundId = roundId;
    this.p.endedAt = null; // a lapsed order that gets paid late is a live ride again – not "ended before it started"
    this.p.reason = null;
  }

  expire(now: Date): void {
    this.mustBe(RideStatus.AwaitingPayment);
    this.close(RideStatus.Expired, null, now);
  }

  /** An unstarted FREE ride is replaced by a paid purchase (the caller refunds the credit). */
  cancelReplaced(now: Date): void {
    this.mustBe(RideStatus.Created);
    if (!this.isFree) throw new ConflictError('a paid ride is never cancelled');
    this.close(RideStatus.Cancelled, 'replaced by a paid ride', now);
  }

  failHeartbeatLost(now: Date): void {
    this.mustBe(RideStatus.Running);
    this.close(RideStatus.Failed, 'heartbeat lost', now);
  }

  /** Apply one progress report. Returns false when the report failed the ride (silent for the caller to persist) – too late, or faster than a truck can go. */
  applyReport(report: RideReport, now: Date, rules: RideTimingRules): boolean {
    this.mustBe(RideStatus.Running);
    const s = report.s ?? this.p.lastS;
    const hull = report.hull === null ? this.p.hull : clamp(report.hull, 0, 100); // the game can overshoot below 0 on the hit that wrecks it
    const dt = (now.getTime() - (this.p.lastHbAt ?? now).getTime()) / 1000;
    if (dt * 1000 > rules.hbTimeoutMs) {
      this.close(RideStatus.Failed, 'heartbeat lost', now);
      return false;
    }
    if (Math.abs(s - this.p.lastS) > MAX_SPEED * dt * SPEED_SLACK + SLACK_METRES) {
      this.close(RideStatus.Failed, `implausible progress (${Math.round(s - this.p.lastS)} m in ${dt.toFixed(1)} s)`, now);
      return false;
    }
    // Drive time = how far the game's own clock moved since the last report, capped by the wall time that passed: a pause mid-window and the
    // stretch after the last beat are credited correctly, and the clock can't outrun the server's. No usable t (old client): trust the paused flag.
    const hasT = report.t !== null && report.t >= this.p.lastT;
    const credit = hasT ? Math.min((report.t ?? 0) - this.p.lastT, dt * DRIVE_CREDIT_SLACK + DRIVE_CREDIT_SLACK_SECONDS) : report.paused ? 0 : dt;
    this.p.lastS = s;
    this.p.lastT = hasT ? (report.t ?? this.p.lastT) : this.p.lastT;
    this.p.hull = hull;
    this.p.lastHbAt = now;
    this.p.driveSeconds += credit;
    this.p.route = isRouteId(report.route) ? report.route : this.p.route;
    this.p.nightSeconds += report.night ? credit : 0;
    this.p.paused = report.paused;
    return true;
  }

  /** The driver ended the shift ('shift': the server judges complete / abandoned) or the ride failed ('failed': a crash etc.). */
  finish(outcome: RideOutcome, reason: string | null, now: Date): void {
    this.mustBe(RideStatus.Running);
    if (outcome === 'failed') {
      this.close(RideStatus.Failed, (reason ?? 'failed').slice(0, REASON_MAX_LENGTH), now);
    } else if (this.p.driveSeconds >= this.p.minSeconds && this.p.lastS >= this.p.completeDist) {
      this.close(RideStatus.Completed, 'shift complete', now);
    } else {
      this.close(RideStatus.Abandoned, 'shift abandoned before it was complete', now);
    }
  }

  snapshot(): RideProps {
    return { ...this.p };
  }

  private close(status: RideStatus, reason: string | null, now: Date): void {
    this.p.status = status;
    this.p.reason = reason;
    this.p.endedAt = now;
  }

  private mustBe(...allowed: RideStatus[]): void {
    if (!allowed.includes(this.p.status)) throw new ConflictError(`ride is ${this.p.status}`);
  }
}
