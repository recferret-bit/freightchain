import type { Loadout } from '../economy/cosmetics.js';
import { ConflictError } from '../shared/errors.js';
import { RideStatus, type RideOutcome } from './ride-status.js';
import type { RideTierId } from './ride-tier.js';
import type { RideReport } from './ride-report.js';
import {
  CHALLENGE_KINDS, CHALLENGE_MAX_PER_RIDE, CHALLENGE_WINDOW_MS, challengeInterval, firstChallengeAt, nextChallengeAt, pickChallenge,
  type ChallengeKind, type RideChallenge,
} from './ride-challenge.js';
import { BATCH_SEQ_SLACK, GAME_TIME_FACTOR, GAME_TIME_SLACK_SECONDS, MIN_BATCH_SECONDS, RECORDING_BYTES_PER_SECOND, RECORDING_BYTES_SLACK, type RecordingAllowance } from '../telemetry/telemetry-rules.js';
import {
  DRIVE_CREDIT_SLACK, DRIVE_CREDIT_SLACK_SECONDS, GAME_SLACK_METRES, GAME_SPEED_SLACK, MAX_SPEED, REASON_MAX_LENGTH, RIDE_SLACK_METRES, RIDE_SPEED_SLACK,
  SLACK_METRES, SPEED_SLACK,
  completeDist, completeDistK, crashCap, worldFor, type RideTimingRules,
} from './ride-rules.js';
import { DEFAULT_FREE_LEVEL, FREE_LEVELS, assertAssistAllowed, assertTutorialAllowed, levelOfTrip, tripOf, type FreeLevel } from './ride-trip.js';

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
  /** the prize pool whose ticket paid for this ride (null = free, or a legacy pay-per-ride order) */
  poolId: number | null;
  paidAt: Date | null;
  /** the route the ride is driven on. A free ride: its level's country (FREE_LEVELS.route), moved when a ready ride is re-chosen. A paid ride: from the seed (worldFor). Never reported by the game; null = a ride from before this */
  route: string | null;
  startHour: number | null;
  /** the cosmetics worn when the ride started (null = all classic) */
  loadout: Loadout | null;
  /** the road it was driven on: a client/js/trips.js id (ride-trip.ts), stamped at creation; null = a ride from before trips (the 'classic' road) */
  trip: string | null;
  /** a FREE ride ordered with the step-by-step tutorial on (free tier only) */
  tutorial: boolean;
  /** a FREE ride ordered with ASSIST on: half the wear, a tip on every control (free tier only – never ranks as "unassisted") */
  assist: boolean;
  nightSeconds: number;
  /** truck ⇄ vehicle / building contacts, as the game counts them (statistics only – only ever raised by a report) */
  crashesVehicle: number;
  crashesBuilding: number;
  paused: boolean;
  startedAt: Date | null;
  lastHbAt: Date | null;
  lastS: number;
  lastT: number;
  driveSeconds: number;
  hull: number | null;
  endedAt: Date | null;
  reason: string | null;
  /** the dispatch prompts issued so far (verified play – ride-challenge.ts) */
  challenges: RideChallenge[];
  /** drive-seconds at which the next prompt is due (null = not scheduled yet) */
  nextChallengeAt: number | null;
  version: number;
  /** Solana Pay reference. Null until the first payment transaction is built. */
  paymentReference?: string | null;
  seedCommitment?: string | null;
  blockhash?: string | null;
  slot?: bigint | number | null;
}

/** What issuing a prompt needs from the caller: an id and a random draw (the entity stays pure). */
export interface ChallengeDraw { id: string; rnd: number }

/** `level`: the free LEVEL (ride-trip.ts FREE_LEVELS, default 1 = EASY) – its trip and finish-line K; `minSeconds` is the caller's (FREE_RIDE_SECONDS × the level's multiple) */
export interface FreeRideInput { id: string; wallet: string; seed: number; minSeconds: number; now: Date; tutorial?: boolean; assist?: boolean; level?: FreeLevel }
export interface TicketRideInput {
  id: string; wallet: string; tier: RideTierId; seed: number; minSeconds: number; timeScale: number; poolId: number; roundId: number; now: Date;
  seedCommitment?: string | null; blockhash?: string | null; slot?: bigint | number | null;
}
export interface PaidOrderInput {
  id: string; wallet: string; tier: RideTierId; seed: number; minSeconds: number; timeScale: number;
  priceUsd: number; lamports: number; solUsd: number; now: Date; quoteTtlMs: number;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/* A ride. The CLIENT does not decide whether a ride counts: it reports progress and the server judges it –
   complete = the reported distance ≥ completeDist (the finish line), where the distance may only grow at ≤ MAX_SPEED per second of the server's wall clock –
   that governor is the only time gate: a shift can't finish faster than completeDist / MAX_SPEED. This is server-timed telemetry, not a replay: a modified client can still lie within those bounds. */
export class Ride {
  private constructor(private readonly p: RideProps) {}

  private static blank(): Omit<RideProps, 'id' | 'wallet' | 'tier' | 'seed' | 'minSeconds' | 'completeDist' | 'status' | 'createdAt'> {
    return {
      timeScale: 1, priceUsd: 0, lamports: 0, solUsd: null, quoteExpiresAt: null, roundId: null, poolId: null, paidAt: null, route: null, startHour: null, loadout: null, trip: null, tutorial: false, assist: false, nightSeconds: 0, crashesVehicle: 0, crashesBuilding: 0, paused: false,
      startedAt: null, lastHbAt: null, lastS: 0, lastT: 0, driveSeconds: 0, hull: null, endedAt: null, reason: null, challenges: [], nextChallengeAt: null, version: 1, paymentReference: null,
      seedCommitment: null, blockhash: null, slot: null,
    };
  }

  /** A free ride is ready at once (its credit is spent by the caller). Driven on its LEVEL's trip, to that level's finish line; TUTORIAL or ASSIST on a level that forbids it is refused (409). */
  static createFree(i: FreeRideInput): Ride {
    const level = FREE_LEVELS[i.level ?? DEFAULT_FREE_LEVEL];
    const tutorial = i.tutorial === true, assist = i.assist === true;
    assertAssistAllowed(level.level, assist);
    assertTutorialAllowed(level.level, tutorial);
    return new Ride({ ...Ride.blank(), id: i.id, wallet: i.wallet, tier: 'free', trip: level.trip, route: level.route, startHour: worldFor(i.seed).startHour, seed: i.seed, minSeconds: i.minSeconds, completeDist: completeDist(i.minSeconds, completeDistK('free', level.trip)), status: RideStatus.Created, createdAt: i.now, tutorial, assist });
  }

  /** A paid ride bought with a pool ticket (the money is already in the pool's escrow): ready at once, ranked in the pool's round. The caller spends the ticket. */
  static createFromTicket(i: TicketRideInput): Ride {
    if (i.tier === 'free') throw new ConflictError('a free ride is not paid with a ticket');
    return new Ride({
      ...Ride.blank(), id: i.id, wallet: i.wallet, tier: i.tier, trip: tripOf(i.tier), ...worldFor(i.seed), seed: i.seed, minSeconds: i.minSeconds, completeDist: completeDist(i.minSeconds, completeDistK(i.tier)),
      status: RideStatus.Created, createdAt: i.now, timeScale: i.timeScale, poolId: i.poolId, roundId: i.roundId, paidAt: i.now,
      seedCommitment: i.seedCommitment ?? null, blockhash: i.blockhash ?? null, slot: i.slot ?? null,
    });
  }

  /** A paid order: priced in SOL at the moment of ordering, awaiting the on-chain payment. */
  static createPaidOrder(i: PaidOrderInput): Ride {
    return new Ride({
      ...Ride.blank(), id: i.id, wallet: i.wallet, tier: i.tier, trip: tripOf(i.tier), ...worldFor(i.seed), seed: i.seed, minSeconds: i.minSeconds, completeDist: completeDist(i.minSeconds, completeDistK(i.tier)),
      status: RideStatus.AwaitingPayment, createdAt: i.now, timeScale: i.timeScale, priceUsd: i.priceUsd, lamports: i.lamports, solUsd: i.solUsd,
      quoteExpiresAt: new Date(i.now.getTime() + i.quoteTtlMs),
    });
  }

  static restore(props: RideProps): Ride {
    return new Ride({ ...props, paymentReference: props.paymentReference ?? null });
  }

  get paymentReference(): string | null { return this.p.paymentReference ?? null; }

  /** The first payment build stores the reference. A later build keeps it, so a phone that pays the first QR still matches. */
  assignPaymentReference(reference: string): boolean {
    if (this.p.paymentReference) return false;
    this.p.paymentReference = reference;
    return true;
  }

  get props(): RideProps { return this.p; }
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
  get poolId(): number | null { return this.p.poolId; }
  get paidAt(): Date | null { return this.p.paidAt; }
  get driveSeconds(): number { return this.p.driveSeconds; }
  get distance(): number { return this.p.lastS; }
  get reason(): string | null { return this.p.reason; }
  get route(): string | null { return this.p.route; }
  get startHour(): number | null { return this.p.startHour; }
  get startedAt(): Date | null { return this.p.startedAt; }
  get loadout(): Loadout | null { return this.p.loadout; }
  get trip(): string | null { return this.p.trip; }
  /** the free LEVEL it is driven on (1 EASY · 2 MEDIUM · 3 HARD), from its trip; null = a paid ride or a free one from before the levels */
  get level(): FreeLevel | null { return levelOfTrip(this.p.trip); }
  get tutorial(): boolean { return this.p.tutorial; }
  get assist(): boolean { return this.p.assist; }
  get endedAt(): Date | null { return this.p.endedAt; }
  get lastHbAt(): Date | null { return this.p.lastHbAt; }
  get hull(): number | null { return this.p.hull; }
  get version(): number { return this.p.version; }
  get isFree(): boolean { return this.p.tier === 'free'; }
  get seedCommitment(): string | null { return this.p.seedCommitment ?? null; }
  get blockhash(): string | null { return this.p.blockhash ?? null; }
  get slot(): bigint | number | null { return this.p.slot ?? null; }
  get challenges(): readonly RideChallenge[] { return this.p.challenges; }

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
    return { maxGameSeconds: elapsed * GAME_TIME_FACTOR + GAME_TIME_SLACK_SECONDS, maxSeq: Math.floor(elapsed / MIN_BATCH_SECONDS) + BATCH_SEQ_SLACK, maxBytes: Math.floor(elapsed * RECORDING_BYTES_PER_SECOND) + RECORDING_BYTES_SLACK };
  }

  /** Heartbeats closer together than hbMinIntervalMs are ignored – no free progress by spamming. */
  canAcceptHeartbeat(now: Date, rules: RideTimingRules): boolean {
    return now.getTime() - (this.p.lastHbAt?.getTime() ?? 0) >= rules.hbMinIntervalMs;
  }

  /** A ready FREE ride re-chosen as a whole (the lobby's level picker + its two checkboxes) until it starts: the LEVEL's trip, country (`route`), shift length
      (`minSeconds`, the caller's FREE_RIDE_SECONDS × the level's multiple) and finish line, and the helpers – the same ride, seed and credit. TUTORIAL or ASSIST
      on a level without it = 409, nothing changed. Returns whether anything changed (= the ride must be saved). */
  chooseFree(level: FreeLevel, minSeconds: number, tutorial: boolean, assist: boolean): boolean {
    this.mustBe(RideStatus.Created);
    if (!this.isFree) throw new ConflictError('a level is for free rides only', 'level_free_only');
    assertAssistAllowed(level, assist);
    assertTutorialAllowed(level, tutorial);
    const def = FREE_LEVELS[level];
    const trip = def.trip, route = def.route;
    const dist = completeDist(minSeconds, completeDistK('free', trip));
    if (this.p.trip === trip && this.p.route === route && this.p.minSeconds === minSeconds && this.p.completeDist === dist && this.p.tutorial === tutorial && this.p.assist === assist) return false;
    Object.assign(this.p, { trip, route, minSeconds, completeDist: dist, tutorial, assist });
    return true;
  }

  /** `loadout`: what the wallet wears right now – the ride keeps it, so a replay shows the cockpit it was really driven in. */
  start(now: Date, loadout: Loadout | null = null): void {
    this.mustBe(RideStatus.Created);
    this.p.status = RideStatus.Running;
    this.p.loadout = loadout;
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

  /** A ready TICKET ride whose pool closed for rides before it started (a shift started now would end after the play deadline – pentest H6): it can never
      count, so it is closed. Its ticket was spent at the order and is not given back – the money stays in the pool's pot (the decision of 2026-10-14). */
  closeRidesClosed(now: Date, deadline: Date): void {
    this.mustBe(RideStatus.Created);
    if (this.p.poolId === null) throw new ConflictError('only a ticket ride belongs to a pool');
    this.close(RideStatus.Cancelled, `rides for its pool closed – a shift started now would end after ${deadline.toISOString()}`.slice(0, REASON_MAX_LENGTH), now);
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
    const implausible = (why: string) => { this.close(RideStatus.Failed, `implausible progress (${why})`, now); return false; };
    if (Math.abs(s - this.p.lastS) > MAX_SPEED * dt * SPEED_SLACK + SLACK_METRES) return implausible(`${Math.round(s - this.p.lastS)} m in ${dt.toFixed(1)} s`);
    const wall = this.p.startedAt ? (now.getTime() - this.p.startedAt.getTime()) / 1000 : dt;
    if (s > MAX_SPEED * RIDE_SPEED_SLACK * wall + RIDE_SLACK_METRES) return implausible(`${Math.round(s)} m in ${Math.round(wall)} s since the start`);
    // Drive time = how far the game's own clock moved since the last report, capped by the wall time that passed: a pause mid-window and the
    // stretch after the last beat are credited correctly, and the clock can't outrun the server's. No usable t (old client): trust the paused flag.
    const hasT = report.t !== null && report.t >= this.p.lastT;
    const gameDt = hasT ? (report.t ?? 0) - this.p.lastT : report.paused ? 0 : dt;   // a reload never resumes a ride, so t only runs backwards in a forged report
    if (report.t !== null && s - this.p.lastS > MAX_SPEED * GAME_SPEED_SLACK * gameDt + GAME_SLACK_METRES) return implausible(`${Math.round(s - this.p.lastS)} m in ${gameDt.toFixed(1)} s of driving`);   // no t at all (an old client): only the wall-clock bounds above; the verdict's coverage floor does the rest
    const credit = hasT ? Math.min(gameDt, dt * DRIVE_CREDIT_SLACK + DRIVE_CREDIT_SLACK_SECONDS) : gameDt;
    this.p.lastS = s;
    this.p.lastT = hasT ? (report.t ?? this.p.lastT) : this.p.lastT;
    this.p.hull = hull;
    this.p.lastHbAt = now;
    this.p.driveSeconds += credit;
    this.p.nightSeconds += report.night ? credit : 0;
    this.p.paused = report.paused;
    this.p.crashesVehicle = raised(this.p.crashesVehicle, report.crashesVehicle, crashCap(this.p.driveSeconds));
    this.p.crashesBuilding = raised(this.p.crashesBuilding, report.crashesBuilding, crashCap(this.p.driveSeconds));
    return true;
  }

  /** Issue the next challenge if one is due by the ride's own drive clock (after applyReport, while running and not paused): the next due time is drawn
      0.6–1.4 intervals ahead, so a client cannot anticipate it. Kind comes from `kinds` (default CHALLENGE_KINDS, empty today). `intervalSeconds` 0 = off. Returns the prompt issued, or null. */
  issueChallenge(now: Date, intervalSeconds: number, draw: ChallengeDraw, kinds: readonly ChallengeKind[] = CHALLENGE_KINDS): RideChallenge | null {
    if (kinds.length === 0) return null;
    if (this.p.status !== RideStatus.Running || this.p.paused || this.p.startedAt === null) return null;
    const interval = challengeInterval(intervalSeconds, this.p.minSeconds);
    if (interval <= 0 || this.p.challenges.length >= CHALLENGE_MAX_PER_RIDE) return null;
    if (this.p.nextChallengeAt === null) { this.p.nextChallengeAt = firstChallengeAt(interval, draw.rnd); return null; }
    if (this.p.driveSeconds < this.p.nextChallengeAt) return null;
    const kind = pickChallenge(draw.rnd, kinds);
    if (!kind) return null;
    const issuedMs = now.getTime() - this.p.startedAt.getTime();
    const challenge: RideChallenge = { id: draw.id, action: kind.action, issuedMs, deadlineMs: issuedMs + CHALLENGE_WINDOW_MS, codes: [...kind.codes] };
    this.p.challenges = [...this.p.challenges, challenge];
    this.p.nextChallengeAt = nextChallengeAt(this.p.driveSeconds, interval, draw.rnd);
    return challenge;
  }

  /** The prompt the driver should be answering right now (its window is still open), or null. */
  openChallenge(now: Date): RideChallenge | null {
    const last = this.p.challenges.at(-1);
    if (!last || this.p.startedAt === null || this.p.status !== RideStatus.Running) return null;
    return now.getTime() - this.p.startedAt.getTime() <= last.deadlineMs ? last : null;
  }

  /** The driver ended the shift ('shift': the server judges complete / abandoned) or the ride failed ('failed': a crash etc.). */
  finish(outcome: RideOutcome, reason: string | null, now: Date): void {
    this.mustBe(RideStatus.Running);
    if (outcome === 'failed') {
      this.close(RideStatus.Failed, (reason ?? 'failed').slice(0, REASON_MAX_LENGTH), now);
    } else if (this.p.lastS >= this.p.completeDist) {
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

/** a running counter only ever goes up, whole numbers, capped by the ride's driven time (crashCap); a missing / garbled value leaves it alone */
function raised(current: number, reported: number | null | undefined, cap: number): number {
  if (reported === null || reported === undefined || !Number.isFinite(reported)) return current;
  return Math.max(current, Math.min(cap, Math.floor(reported)));
}
