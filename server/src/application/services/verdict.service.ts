import { Injectable, Logger } from '@nestjs/common';
import type { AdminProof } from '../../domain/admin/admin-proof.js';
import { RideStatus } from '../../domain/rides/ride-status.js';
import { RideVerdict } from '../../domain/verdict/ride-verdict.entity.js';
import { isPoolMark } from '../../domain/verdict/pool-attention.js';
import type { VerdictDecision, VerdictReason } from '../../domain/verdict/verdict.dto.js';
import { ConflictError, NotFoundError } from '../../domain/shared/errors.js';
import { AdminActionRepositoryPort } from '../ports/admin/admin-action.repository.port.js';
import { PlayerRepositoryPort } from '../ports/players/player.repository.port.js';
import { RideRepositoryPort } from '../ports/rides/ride.repository.port.js';
import { ClockPort } from '../ports/shared/clock.port.js';
import { TransactionPort, type TransactionHandle } from '../ports/shared/transaction.port.js';
import { RideBatchRepositoryPort } from '../ports/telemetry/ride-batch.repository.port.js';
import { RideVerdictRepositoryPort } from '../ports/verdict/ride-verdict.repository.port.js';
import { HonkMintService } from './honk-mint.service.js';
import { HonkEmissionPort } from '../ports/honk/honk-emission.port.js';

/**
 * Judges a completed ride from its stored recording (RideVerdict.judge) and saves the verdict. Called right after /end and again when a batch lands
 * after the end (the final flush). Runs under the wallet's player row lock, and reads the batches only once it holds it: of two racing judgements
 * the one that saves last has seen every batch the other saw, so a stale verdict can never overwrite a fresher one. A verdict an admin decided is kept as is.
 */
/** What adding the pool-level attention marks did to one ride (`skipped`: an admin decided it, or it is not a completed shift of that wallet). */
export interface AttentionOutcome {
  rideId: string;
  before: string | null;
  after: string | null;
  added: string[];
  skipped: 'overridden' | 'not-completed' | null;
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
  ) {}

  /** null = nothing to judge (only completed shifts can rank, so only they are judged). A verdict an admin decided is returned as is. */
  async judge(rideId: string): Promise<RideVerdict | null> {
    const result = await this.transactions.run((tx) => this.judgeLocked(rideId, false, tx));
    await this.mintRide(result);
    return result?.verdict ?? null;
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
    return result ? { before: result.before, after: result.verdict.status } : null;
  }

  /** Judge inside the caller's transaction, under the player lock; batches are read only once the lock is held. `force` replaces an admin decision;
      `guardSwept` refuses (409) when the recording was deleted by the retention sweep – a late batch (neither) may still judge an empty recording. */
  private async mintRide(result: { minted: bigint | null; wallet: string; verdict: RideVerdict } | null): Promise<void> {
    if (!result?.minted) return;
    await this.emission.mint(result.verdict.rideId, result.wallet, result.minted);
  }

  private async judgeLocked(rideId: string, force: boolean, tx: TransactionHandle, guardSwept = force): Promise<{ verdict: RideVerdict; before: string | null; minted: bigint | null; wallet: string } | null> {
    const ride = await this.rides.findById(rideId, tx);
    if (!ride || !ride.isInStatus(RideStatus.Completed)) return null;
    await this.players.findByWalletForUpdate(ride.wallet, tx);
    const existing = await this.verdicts.findByRide(rideId, tx);
    if (existing?.isOverridden && !force) return { verdict: existing, before: existing.status, minted: null, wallet: ride.wallet }; // an admin decided – a late batch never replaces that
    const batches = await this.batches.listFactsByRide(rideId, tx);
    if (guardSwept && existing && batches.length === 0 && existing.snapshot().scores.recording.batches > 0) {
      throw new ConflictError('the recording of this ride was deleted by the retention sweep – its verdict stays as it is', 'recording_deleted');
    }
    const verdict = RideVerdict.judge(ride, batches, this.clock.now());
    // the pool-level attention marks (pool-attention.ts) come from the other rides of the pool, not from this recording – judging the recording again
    // cannot recompute them, so they are carried over (also when an admin re-judges: clearing a mark is an admin DECISION – the override –, not a re-run)
    verdict.addReasons(existing?.reasons.filter((r) => isPoolMark(r.code)) ?? []);
    await this.verdicts.save(verdict, tx);
    // HONK is credited in this same transaction. A flagged or rejected ride mints nothing, and a second pass of a verified ride does not mint again.
    const minted = verdict.status === 'verified' ? await this.honk.credit({ rideId, wallet: ride.wallet, tier: ride.tier, distance: ride.distance, completeDist: ride.completeDist }, tx) : null;
    this.logger.log({ event: 'verdict', msg: `ride ${rideId}: ${verdict.status}`, rideId, wallet: ride.wallet, status: verdict.status, reasons: verdict.reasons.map((r) => r.code) });
    return { verdict, before: existing?.status ?? null, minted, wallet: ride.wallet };
  }

  /** The pool-level attention marks for ONE rider's rides (PoolAttentionService), in one transaction under that rider's player lock – the same lock as
      judging and the admin's decision, so a racing late batch / override cannot interleave. A completed shift not judged yet is judged first. An admin's
      decision is never touched; a ride whose verdict already carries every mark is not saved again (idempotent). */
  async addAttention(wallet: string, marks: readonly { rideId: string; reasons: readonly VerdictReason[] }[]): Promise<AttentionOutcome[]> {
    return this.transactions.run(async (tx) => {
      await this.players.findByWalletForUpdate(wallet, tx);
      const out: AttentionOutcome[] = [];
      for (const { rideId, reasons } of marks) {
        const ride = await this.rides.findById(rideId, tx);
        if (!ride || ride.wallet !== wallet || !ride.isInStatus(RideStatus.Completed)) { out.push({ rideId, before: null, after: null, added: [], skipped: 'not-completed' }); continue; }
        const existing = await this.verdicts.findByRide(rideId, tx);
        const verdict = existing ?? RideVerdict.judge(ride, await this.batches.listFactsByRide(rideId, tx), this.clock.now());
        const before = existing?.status ?? null;
        if (verdict.isOverridden) { out.push({ rideId, before, after: verdict.status, added: [], skipped: 'overridden' }); continue; }
        const had = new Set(verdict.reasons.map((r) => r.code));
        if (verdict.addReasons(reasons) || !existing) await this.verdicts.save(verdict, tx);
        out.push({ rideId, before, after: verdict.status, added: verdict.reasons.filter((r) => !had.has(r.code)).map((r) => r.code), skipped: null });
      }
      return out;
    });
  }

  /** An admin's decision from the review queue, under the same player lock as judging (so a racing re-judge cannot overwrite it), audited in the same transaction. */
  async override(rideId: string, decision: VerdictDecision, admin: string, note: string | null, requestId: string | null, proof: AdminProof | null = null): Promise<RideVerdict> {
    const verdict = await this.transactions.run(async (tx) => {
      const ride = await this.rides.findById(rideId, tx);
      if (!ride) throw new NotFoundError('ride not found');
      await this.players.findByWalletForUpdate(ride.wallet, tx);
      // a completed shift whose judgement failed after /end (best-effort) has no verdict yet: judge it now, then decide
      const current = (await this.verdicts.findByRide(rideId, tx)) ?? (ride.isInStatus(RideStatus.Completed) ? RideVerdict.judge(ride, await this.batches.listFactsByRide(rideId, tx), this.clock.now()) : null);
      if (!current) throw new NotFoundError('this ride has no verdict (only completed shifts are judged)');
      const before = current.status;
      const now = this.clock.now();
      current.override(decision, admin, note, now);
      await this.verdicts.save(current, tx);
      await this.audit.insert({ wallet: admin, action: 'verdict.override', target: rideId, detail: { from: before, to: decision, note, rider: ride.wallet, ...(proof ? { signed: proof } : {}) }, requestId, at: now }, tx);
      return current;
    });
    this.logger.log({ event: 'admin', msg: `verdict of ride ${rideId} set to ${decision} by ${admin}`, action: 'verdict.override', rideId, admin, decision, requestId });
    return verdict;
  }
}
