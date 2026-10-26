import { GameSettingsService } from './game-settings.service.js';
import { Injectable, Logger, Optional } from '@nestjs/common';
import type { AdminProof } from '../../domain/admin/admin-proof.js';
import { RideStatus } from '../../domain/rides/ride-status.js';
import { ReplayEngine, REPLAY_SIM_HZ } from '../../domain/verdict/replay-engine.js';
import { RideReplay } from '../../domain/verdict/ride-replay.entity.js';
import { RideVerdict } from '../../domain/verdict/ride-verdict.entity.js';
import { isPoolMark } from '../../domain/verdict/pool-attention.js';
import { classifyPass, firstPasses } from '../../domain/verdict/world-checks.js';
import { VerdictStatus, type VerdictDecision, type VerdictReason } from '../../domain/verdict/verdict.dto.js';
import { bandAmounts, dayIndex } from '../../domain/honk/tokenomics.js';
import type { Ride } from '../../domain/rides/ride.entity.js';
import { ConflictError, NotFoundError } from '../../domain/shared/errors.js';
import { AdminActionRepositoryPort } from '../ports/admin/admin-action.repository.port.js';
import { RideEventRepositoryPort } from '../ports/live/ride-event.repository.port.js';
import { PlayerRepositoryPort } from '../ports/players/player.repository.port.js';
import { RideRepositoryPort } from '../ports/rides/ride.repository.port.js';
import { ClockPort } from '../ports/shared/clock.port.js';
import { EntropyPort } from '../ports/shared/entropy.port.js';
import { TransactionPort, type TransactionHandle } from '../ports/shared/transaction.port.js';
import { RideBatchRepositoryPort } from '../ports/telemetry/ride-batch.repository.port.js';
import { ReplayQueuePort } from '../ports/verdict/replay-queue.port.js';
import { RideReplayRepositoryPort } from '../ports/verdict/ride-replay.repository.port.js';
import { RideVerdictRepositoryPort } from '../ports/verdict/ride-verdict.repository.port.js';
import { HonkMintService } from './honk-mint.service.js';
import { HonkEmissionPort } from '../ports/honk/honk-emission.port.js';
import { AirdropService } from '../airdrop/airdrop.service.js';
import { ConvoyService } from '../referral/convoy.service.js';
import { TelemetryConfigPort } from '../ports/telemetry/telemetry-config.port.js';
import { classifyHumanness } from '../../domain/anticheat/humanness.js';
import { applyTrust, trustPolicy } from '../../domain/anticheat/trust-score.js';
import { judgeWorldDigest } from '../../domain/shared/index.js';
import { pauseVerdict, slowMotionVerdict } from '../../domain/rides/pause-bounds.js';
import { HasherPort } from '../ports/shared/hasher.port.js';
import { DeflatePort } from '../ports/telemetry/deflate.port.js';
import { assessEnforceBatches } from '../telemetry/enforce-resim.js';
import { RideResultRepositoryPort } from '../rides/ride-result.port.js';
import { rideResultOf } from '../rides/ride-result-of.js';
import type { ReplayVerificationOutput } from '../../domain/verdict/replay-engine.js';

function canJudgeRide(ride: Ride): boolean {
  if (ride.isInStatus(RideStatus.Completed)) return true;
  if (!ride.isInStatus(RideStatus.Abandoned, RideStatus.Failed)) return false;
  if (ride.ranked && ride.distance > 0) return true;
  return !ride.isFree && !ride.isPromo && !ride.isWeeklyGrant && bandAmounts(ride.tier, ride.distance, ride.completeDist).quote > 0n;
}

/**
 * Judges an ended ride from its stored recording (RideVerdict.judge + 10 Hz ReplayEngine) and saves both the verdict and the RideReplay record.
 * Called right after /end, when a late batch lands, or asynchronously from ReplayQueuePort across concurrent worker sessions.
 * Runs under the wallet's player row lock, and reads batches only once it holds it: of two racing judgements the one that saves last has seen
 * every batch the other saw, so a stale verdict can never overwrite a fresher one. A verdict an admin decided is kept as is.
 */
/** What adding the pool-level attention marks did to one ride (`skipped`: an admin decided it, or it is not a completed shift of that wallet). */
export interface AttentionOutcome {
  rideId: string;
  before: string | null;
  after: string | null;
  added: string[];
  skipped: 'overridden' | 'not-completed' | null;
}

export interface ReplayQueueProcessResult {
  processed: number;
  verified: number;
  flagged: number;
  rejected: number;
  failed: number;
}

@Injectable()
export class VerdictService {
  private readonly logger = new Logger(VerdictService.name);

  constructor(
    private readonly rides: RideRepositoryPort,
    private readonly players: PlayerRepositoryPort,
    private readonly batches: RideBatchRepositoryPort,
    private readonly verdicts: RideVerdictRepositoryPort,
    private readonly audit: AdminActionRepositoryPort,
    private readonly transactions: TransactionPort,
    private readonly clock: ClockPort,
    private readonly honk: HonkMintService,
    private readonly emission: HonkEmissionPort,
    @Optional() private readonly replays?: RideReplayRepositoryPort,
    @Optional() private readonly rideEvents?: RideEventRepositoryPort,
    @Optional() private readonly replayQueue?: ReplayQueuePort,
    @Optional() private readonly entropy?: EntropyPort,
    @Optional() private readonly retiredReferral?: never,
    @Optional() private readonly rideResults?: RideResultRepositoryPort,
    @Optional() private readonly convoy?: ConvoyService,
    @Optional() private readonly airdrop?: AirdropService,
    @Optional() private readonly telemetry?: TelemetryConfigPort,
    @Optional() private readonly hasher?: HasherPort,
    @Optional() private readonly deflate?: DeflatePort,
    @Optional() private readonly settings?: GameSettingsService,
  ) {}

  /** null = nothing to judge (completed shifts, ranked attempts with distance, or paid shifts that reached a TEN4 band). A verdict an admin decided is returned as is. */
  async judge(rideId: string, expectedPendingReplayId?: string): Promise<RideVerdict | null> {
    const result = await this.transactions.run((tx) => this.judgeLocked(rideId, false, tx, false, expectedPendingReplayId));
    await this.mintRide(result);
    await this.afterVerified(rideId, result?.verdict.status);
    return result?.verdict ?? null;
  }

  /** Enqueues an ended ride for asynchronous replay verification by background workers (creates a pending RideReplay row and pushes to ReplayQueuePort). */
  async enqueueVerification(rideId: string): Promise<RideReplay | null> {
    if (!this.replays) return null;
    const replay = await this.transactions.run(async (tx) => {
      const ride = await this.rides.findById(rideId, tx);
      if (!ride || !canJudgeRide(ride)) return null;
      await this.players.findByWalletForUpdate(ride.wallet, tx);
      const latest = await this.replays!.findLatestByRide(rideId, tx);
      if (latest && latest.status === VerdictStatus.Pending) return latest;
      const seq = await this.replays!.nextSeq(rideId, tx);
      const id = this.entropy ? this.entropy.uuid() : `${rideId}-replay-${seq}`;
      const pending = RideReplay.createPending({
        id, rideId: ride.id, seq, isPaid: !ride.isFree, seed: ride.seed, trip: ride.trip, simHz: REPLAY_SIM_HZ, now: this.clock.now(),
      });
      return this.replays!.save(pending, tx);
    });
    if (replay && this.replayQueue) {
      await this.replayQueue.enqueue({
        rideId: replay.rideId,
        replayId: replay.id,
        isPaid: replay.isPaid,
        enqueuedAt: this.clock.now().getTime(),
      });
    }
    return replay;
  }

  /** Processes queued replay verification sessions concurrently (up to `concurrency` parallel sessions across different riders). */
  async processQueue(limit = 10, concurrency = 4): Promise<ReplayQueueProcessResult> {
    const jobs = this.replayQueue ? await this.replayQueue.dequeueBatch(limit) : [];
    const seenRides = new Set(jobs.map((j) => j.rideId));
    if (this.replays && jobs.length < limit) {
      const pendingRows = await this.replays.listPending(limit - jobs.length);
      for (const row of pendingRows) {
        if (!seenRides.has(row.rideId)) {
          if (this.replayQueue && await this.replayQueue.isInFlight(row.rideId)) continue;
          seenRides.add(row.rideId);
          jobs.push({ rideId: row.rideId, replayId: row.id, isPaid: row.isPaid, enqueuedAt: row.snapshot().queuedAt.getTime() });
        }
      }
    }
    const stats: ReplayQueueProcessResult = { processed: 0, verified: 0, flagged: 0, rejected: 0, failed: 0 };
    if (!jobs.length) return stats;

    const workerCount = Math.max(1, Math.min(concurrency, jobs.length));
    let cursor = 0;
    const runWorker = async (): Promise<void> => {
      while (cursor < jobs.length) {
        const job = jobs[cursor++]!;
        try {
          const v = await this.judge(job.rideId, job.replayId);
          if (this.replayQueue) await this.replayQueue.acknowledge(job.rideId, job.replayId);
          stats.processed++;
          if (v?.status === VerdictStatus.Verified) stats.verified++;
          else if (v?.status === VerdictStatus.Flagged) stats.flagged++;
          else if (v?.status === VerdictStatus.Rejected) stats.rejected++;
        } catch (error) {
          stats.failed++;
          const msg = error instanceof Error ? error.message : String(error);
          if (this.replayQueue) await this.replayQueue.release(job, msg);
        }
      }
    };
    await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
    return stats;
  }

  /** An admin's "judge again": the checks at the current rules, replacing any earlier decision – judged and audited in ONE transaction under the player
      lock. 404 for a ride that is not a completed shift; 409 when the retention sweep already deleted the recording (the verdict then stays as it is). */
  async rejudge(rideId: string, admin: string, requestId: string | null, proof: AdminProof | null = null): Promise<RideVerdict> {
    const result = await this.transactions.run(async (tx) => {
      const judged = await this.judgeLocked(rideId, true, tx);
      if (!judged) throw new NotFoundError('only a completed shift can be judged');
      const { verdict: v, before } = judged;
      await this.audit.insert({ wallet: admin, action: 'verdict.rejudge', target: rideId, detail: { from: before, to: v.status, reasons: v.reasons.map((r) => r.code), ...(proof ? { signed: proof } : {}) }, requestId, at: this.clock.now() }, tx);
      return judged;
    });
    this.logger.log({ event: 'admin', msg: `ride ${rideId} re-judged by ${admin}: ${result.verdict.status}`, action: 'verdict.rejudge', rideId, admin, requestId });
    await this.mintRide(result);
    await this.afterVerified(rideId, result?.verdict.status);
    return result.verdict;
  }

  /** The bulk re-judge (CLI `verdict:rejudge`, after a rules change): the current rules, an admin's decision kept, a ride whose recording the retention
      sweep already deleted SKIPPED (null) rather than rejected for 'no-recording'. Returns the status before and after, or null when nothing was judged. */
  async rejudgeQuietly(rideId: string): Promise<{ before: string | null; after: string } | null> {
    const result = await this.transactions.run(async (tx) => {
      const judged = await this.judgeLocked(rideId, false, tx, true).catch((error: unknown) => { if (error instanceof ConflictError) return null; throw error; });
      return judged;
    });
    await this.mintRide(result);
    await this.afterVerified(rideId, result?.verdict.status);
    return result ? { before: result.before, after: result.verdict.status } : null;
  }

  /** Judge inside the caller's transaction, under the player lock; batches are read only once the lock is held. `force` replaces an admin decision;
      `guardSwept` refuses (409) when the recording was deleted by the retention sweep – a late batch (neither) may still judge an empty recording. */
  private async mintRide(result: { minted: bigint | null; wallet: string; verdict: RideVerdict } | null): Promise<void> {
    if (!result?.minted) return;
    const chain = await this.honk.chainOf(result.verdict.rideId);
    if (!chain) return;
    try {
      await this.emission.mint(result.verdict.rideId, result.wallet, chain.tier, chain.bands, dayIndex(this.clock.now()), result.minted);
    } catch (error) {
      this.logger.warn(`chain mint after verdict failed for ride ${result.verdict.rideId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async judgeLocked(rideId: string, force: boolean, tx: TransactionHandle, guardSwept = force, expectedPendingReplayId?: string): Promise<{ verdict: RideVerdict; before: string | null; minted: bigint | null; wallet: string } | null> {
    let ride = await this.rides.findById(rideId, tx);
    if (!ride || !canJudgeRide(ride)) return null;
    await this.players.findByWalletForUpdate(ride.wallet, tx);
    const existing = await this.verdicts.findByRide(rideId, tx);
    if (existing?.isOverridden && !force && !this.replays) return { verdict: existing, before: existing.status, minted: null, wallet: ride.wallet }; // an admin decided – a late batch never replaces that
    const batches = await this.batches.listFactsByRide(rideId, tx);
    if (guardSwept && existing && batches.length === 0 && existing.snapshot().scores.recording.batches > 0) {
      throw new ConflictError('the recording of this ride was deleted by the retention sweep – its verdict stays as it is', 'recording_deleted');
    }
    const now = this.clock.now();
    let replayReasons: VerdictReason[] = [];
    let simDamageS: number | null = null;
    let simOut: ReplayVerificationOutput | null = null;
    if (this.replays) {
      const latestReplay = await this.replays.findLatestByRide(rideId, tx);
      if (expectedPendingReplayId && latestReplay && latestReplay.id === expectedPendingReplayId && latestReplay.status !== VerdictStatus.Pending && existing) {
        return { verdict: existing, before: existing.status, minted: null, wallet: ride.wallet };
      }
      if (existing?.isOverridden && !force && (!latestReplay || latestReplay.status !== VerdictStatus.Pending)) {
        return { verdict: existing, before: existing.status, minted: null, wallet: ride.wallet };
      }
      const [fullBatches, events] = await Promise.all([
        this.batches.listByRide(rideId, tx),
        this.rideEvents ? this.rideEvents.listAfter(rideId, 0, 500, tx) : Promise.resolve([]),
      ]);
      simOut = ReplayEngine.verify(ride, fullBatches, events);
      for (const f of simOut.redFlags) {
        if (typeof f.atMetre === 'number' && (f.category === 'obstacle' || f.category === 'traffic' || f.code === 'donated-obstacle-ignored')) {
          simDamageS = simDamageS === null ? f.atMetre : Math.min(simDamageS, f.atMetre);
        }
      }
      const replay = latestReplay && latestReplay.status === VerdictStatus.Pending
        ? latestReplay
        : RideReplay.createPending({
            id: this.entropy ? this.entropy.uuid() : `${rideId}-replay-${(latestReplay?.seq ?? 0) + 1}`,
            rideId: ride.id,
            seq: (latestReplay?.seq ?? 0) + 1,
            isPaid: !ride.isFree,
            seed: ride.seed,
            trip: ride.trip,
            simHz: REPLAY_SIM_HZ,
            now,
          });
      replay.markStarted(now);
      replay.complete({ ...simOut, now });
      await this.replays.save(replay, tx);
      if (existing?.isOverridden && !force) return { verdict: existing, before: existing.status, minted: null, wallet: ride.wallet };
      replayReasons = replay.toVerdictReasons();
    }
    const verdict = RideVerdict.judge(ride, batches, now, replayReasons);
    const telemetryMode = this.telemetry?.mode();
    if (telemetryMode === 'shadow' || telemetryMode === 'enforce') {
      verdict.addReasons(pauseVerdict(telemetryMode, { count: ride.pauseCount, seconds: ride.pauseSeconds }));
      const wallSec = ride.startedAt && ride.endedAt ? (ride.endedAt.getTime() - ride.startedAt.getTime()) / 1000 : 0;
      const wallMs = Math.max(0, wallSec - ride.pauseSeconds) * 1000;
      verdict.addReasons(slowMotionVerdict(telemetryMode, Math.round(ride.driveSeconds * 30), wallMs));
    }
    if (telemetryMode === 'enforce' && this.hasher && this.deflate) {
      const full = await this.batches.listByRide(rideId, tx);
      if (full.some((batch) => batch.body.named)) {
        const others = await this.batches.otherRideIntervals(ride.id);
        const assessed = assessEnforceBatches(this.hasher, ride, full.map((batch) => batch.body), (raw) => this.deflate!.inflateRaw(raw), others);
        const digest = judgeWorldDigest(assessed.points);
        const human = classifyHumanness(assessed.humanInput);
        const reasons: VerdictReason[] = [];
        if (digest === 'reject') reasons.push({ code: 'world-digest-mismatch', detail: 'mismatch lasted at least 10 s', severity: 'reject' });
        else if (digest === 'flag') reasons.push({ code: 'world-digest-mismatch', detail: 'short mismatch', severity: 'flag' });
        const severity = human.verdict === 'rejected' ? 'reject' as const : 'flag' as const;
        if (human.verdict !== 'verified') {
          for (const code of human.reasons) reasons.push({ code, detail: `humanness ${human.score}`, severity });
        }
        verdict.addReasons(reasons);
      }
    }
    const player = await this.players.findByWalletForUpdate(ride.wallet, tx);
    if (player && existing?.status !== verdict.status && (verdict.status === 'verified' || verdict.status === 'rejected')) {
      if (verdict.status === 'verified') {
        if (ride.isInStatus(RideStatus.Completed) && ride.endedAt) player.awardVerifiedFinish(ride.endedAt, trustPolicy(await this.settings?.current(tx)));
      }
      else { player.setTrustScore(applyTrust(player.trustScore, 'rejected')); player.noteRejected(); }
      await this.players.save(player, tx);
    }
    if (ride.ranked) {
      const ordered = [...batches].sort((a, b) => a.seq - b.seq);
      const damaged = ordered.find((b) => typeof b.summary.firstDamageS === 'number');
      const worldHit = firstPasses(ordered).find((p) => { const k = classifyPass(p).kind; return k === 'hit' || k === 'ignored'; });
      const candidates = [damaged?.summary.firstDamageS, worldHit?.s, simDamageS].filter((x): x is number => typeof x === 'number' && Number.isFinite(x));
      if (candidates.length > 0 && ride.clampCleanMetres(Math.min(...candidates))) {
        ride = await this.rides.save(ride, tx);
      }
    }
    // the pool-level attention marks (pool-attention.ts) come from the other rides of the pool, not from this recording – judging the recording again
    // cannot recompute them, so they are carried over (also when an admin re-judges: clearing a mark is an admin DECISION – the override –, not a re-run).
    // `clean-mismatch` is carried over too because clamping `ride.cleanMetres` above would otherwise hide the heartbeat discrepancy on a later re-judge.
    verdict.addReasons(existing?.reasons.filter((r) => isPoolMark(r.code) || r.code === 'clean-mismatch') ?? []);
    await this.verdicts.save(verdict, tx);
    if (this.rideResults) await this.rideResults.upsert(rideResultOf(ride, verdict.status, simOut ? { damage: simOut.damage, redLights: simOut.redLights, offRoadSeconds: simOut.scores.maxOffroadSeconds } : null, now), tx);
    // TEN4 is reserved in this same transaction. 1h and 4h credit now. An 8h row waits; a later non-verified verdict returns that reservation. A released mint is not clawed back, and a second pass does not mint again.
    // A promo ride and the weekly granted ticket are not purchases, so they do not mint TEN4. A non-verified verdict returns an unreleased reservation.
    const minted = verdict.status === 'verified' && !ride.isPromo && !ride.isWeeklyGrant
      ? await this.honk.credit({ rideId, wallet: ride.wallet, tier: ride.tier, distance: ride.distance, completeDist: ride.completeDist }, tx)
      : await this.honk.cancelPending(rideId, tx).then(() => null);
    this.logger.log({ event: 'verdict', msg: `ride ${rideId}: ${verdict.status}`, rideId, wallet: ride.wallet, status: verdict.status, reasons: verdict.reasons.map((r) => r.code) });
    return { verdict, before: existing?.status ?? null, minted, wallet: ride.wallet };
  }

  /** The pool-level attention marks for ONE rider's rides (PoolAttentionService), in one transaction under that rider's player lock – the same lock as
      judging and the admin's decision, so a racing late batch / override cannot interleave. A completed shift not judged yet is judged first. An admin's
      decision is never touched; a ride whose verdict already carries every mark is not saved again (idempotent). */
  async addAttention(wallet: string, marks: readonly { rideId: string; reasons: readonly VerdictReason[] }[]): Promise<AttentionOutcome[]> {
    const out = await this.transactions.run(async (tx) => {
      await this.players.findByWalletForUpdate(wallet, tx);
      const out: AttentionOutcome[] = [];
      for (const { rideId, reasons } of marks) {
        const ride = await this.rides.findById(rideId, tx);
        if (!ride || ride.wallet !== wallet || !canJudgeRide(ride)) { out.push({ rideId, before: null, after: null, added: [], skipped: 'not-completed' }); continue; }
        const existing = await this.verdicts.findByRide(rideId, tx);
        const verdict = existing ?? RideVerdict.judge(ride, await this.batches.listFactsByRide(rideId, tx), this.clock.now());
        const before = existing?.status ?? null;
        if (verdict.isOverridden) { out.push({ rideId, before, after: verdict.status, added: [], skipped: 'overridden' }); continue; }
        const had = new Set(verdict.reasons.map((r) => r.code));
        if (verdict.addReasons(reasons) || !existing) {
          await this.verdicts.save(verdict, tx);
          if (verdict.status !== VerdictStatus.Verified) await this.honk.cancelPending(rideId, tx);
        }
        out.push({ rideId, before, after: verdict.status, added: verdict.reasons.filter((r) => !had.has(r.code)).map((r) => r.code), skipped: null });
      }
      return out;
    });
    for (const row of out) if (row.after === VerdictStatus.Verified && row.before !== VerdictStatus.Verified) await this.afterVerified(row.rideId, row.after);
    return out;
  }

  /** An admin's decision from the review queue, under the same player lock as judging (so a racing re-judge cannot overwrite it), audited in the same transaction. */
  async override(rideId: string, decision: VerdictDecision, admin: string, note: string | null, requestId: string | null, proof: AdminProof | null = null): Promise<RideVerdict> {
    const result = await this.transactions.run(async (tx) => {
      const ride = await this.rides.findById(rideId, tx);
      if (!ride) throw new NotFoundError('ride not found');
      await this.players.findByWalletForUpdate(ride.wallet, tx);
      // a shift whose judgement failed after /end (best-effort) has no verdict yet: judge it now, then decide
      const current = (await this.verdicts.findByRide(rideId, tx)) ?? (canJudgeRide(ride) ? RideVerdict.judge(ride, await this.batches.listFactsByRide(rideId, tx), this.clock.now()) : null);
      if (!current) throw new NotFoundError('this ride has no verdict (only completed shifts are judged)');
      const before = current.status;
      const now = this.clock.now();
      current.override(decision, admin, note, now);
      await this.verdicts.save(current, tx);
      const minted = decision === VerdictStatus.Verified && !ride.isPromo && !ride.isWeeklyGrant
        ? await this.honk.credit({ rideId, wallet: ride.wallet, tier: ride.tier, distance: ride.distance, completeDist: ride.completeDist }, tx)
        : await this.honk.cancelPending(rideId, tx).then(() => null);
      await this.audit.insert({ wallet: admin, action: 'verdict.override', target: rideId, detail: { from: before, to: decision, note, rider: ride.wallet, ...(proof ? { signed: proof } : {}) }, requestId, at: now }, tx);
      return { verdict: current, minted, wallet: ride.wallet };
    });
    this.logger.log({ event: 'admin', msg: `verdict of ride ${rideId} set to ${decision} by ${admin}`, action: 'verdict.override', rideId, admin, decision, requestId });
    await this.mintRide(result);
    if (decision === VerdictStatus.Verified) await this.afterVerified(rideId, result.verdict.status);
    return result.verdict;
  }

  /** After the verdict transaction commits. A referral failure is logged and retried on the next judge: qualifying locks the referrer, which cannot share the rider's lock. */
  private async afterVerified(rideId: string, status: string | null | undefined): Promise<void> {
    if (status !== VerdictStatus.Verified) return;
    if (!this.convoy && !this.airdrop) return;
    const ride = await this.rides.findById(rideId);
    if (!ride) return;
    if (this.convoy) {
      await this.convoy.onVerifiedRide({ rideId, wallet: ride.wallet, status: ride.status, verdict: status, trip: ride.trip, tier: ride.tier, ranked: ride.ranked, promo: ride.isPromo, weeklyGrant: ride.isWeeklyGrant, endedAt: ride.endedAt ?? undefined })
        .catch((error: unknown) => this.logger.warn(`convoy progress deferred: ${error instanceof Error ? error.message : String(error)}`));
    }
    if (this.airdrop) {
      await this.airdrop.recordVerifiedRide(ride.wallet, ride.trip)
        .catch((error: unknown) => this.logger.warn(`airdrop ride gate deferred: ${error instanceof Error ? error.message : String(error)}`));
    }
  }
}

