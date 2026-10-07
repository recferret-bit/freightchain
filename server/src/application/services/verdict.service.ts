import { Injectable, Logger } from '@nestjs/common';
import { RideStatus } from '../../domain/rides/ride-status.js';
import { RideVerdict } from '../../domain/verdict/ride-verdict.entity.js';
import type { VerdictDecision } from '../../domain/verdict/verdict.dto.js';
import { NotFoundError } from '../../domain/shared/errors.js';
import { AdminActionRepositoryPort } from '../ports/admin/admin-action.repository.port.js';
import { PlayerRepositoryPort } from '../ports/players/player.repository.port.js';
import { RideRepositoryPort } from '../ports/rides/ride.repository.port.js';
import { ClockPort } from '../ports/shared/clock.port.js';
import { TransactionPort } from '../ports/shared/transaction.port.js';
import { RideBatchRepositoryPort } from '../ports/telemetry/ride-batch.repository.port.js';
import { RideVerdictRepositoryPort } from '../ports/verdict/ride-verdict.repository.port.js';

/**
 * Judges a completed ride from its stored recording (RideVerdict.judge) and saves the verdict. Called right after /end and again when a batch lands
 * after the end (the final flush). Runs under the wallet's player row lock, and reads the batches only once it holds it: of two racing judgements
 * the one that saves last has seen every batch the other saw, so a stale verdict can never overwrite a fresher one. A verdict an admin decided is kept as is.
 */
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
  ) {}

  /** null = nothing to judge (only completed shifts can rank, so only they are judged). `force` re-judges even a verdict an admin decided (the admin's re-judge). */
  async judge(rideId: string, force = false): Promise<RideVerdict | null> {
    return this.transactions.run(async (tx) => {
      const ride = await this.rides.findById(rideId, tx);
      if (!ride || !ride.isInStatus(RideStatus.Completed)) return null;
      await this.players.findByWalletForUpdate(ride.wallet, tx);
      const existing = await this.verdicts.findByRide(rideId, tx);
      if (existing?.isOverridden && !force) return existing; // an admin decided – a late batch never replaces that
      const verdict = RideVerdict.judge(ride, await this.batches.listByRide(rideId, tx), this.clock.now());
      await this.verdicts.save(verdict, tx);
      this.logger.log({ event: 'verdict', msg: `ride ${rideId}: ${verdict.status}`, rideId, wallet: ride.wallet, status: verdict.status, reasons: verdict.reasons.map((r) => r.code) });
      return verdict;
    });
  }

  /** An admin's "judge again": the checks at the current rules, replacing any earlier decision; audited. 404 for a ride that is not a completed shift. */
  async rejudge(rideId: string, admin: string, requestId: string | null): Promise<RideVerdict> {
    const before = (await this.verdicts.findByRide(rideId))?.status ?? null;
    const verdict = await this.judge(rideId, true);
    if (!verdict) throw new NotFoundError('only a completed shift can be judged');
    await this.audit.insert({ wallet: admin, action: 'verdict.rejudge', target: rideId, detail: { from: before, to: verdict.status, reasons: verdict.reasons.map((r) => r.code) }, requestId, at: this.clock.now() });
    this.logger.log({ event: 'admin', msg: `ride ${rideId} re-judged by ${admin}: ${verdict.status}`, action: 'verdict.rejudge', rideId, admin, requestId });
    return verdict;
  }

  /** An admin's decision from the review queue, under the same player lock as judging (so a racing re-judge cannot overwrite it), audited in the same transaction. */
  async override(rideId: string, decision: VerdictDecision, admin: string, note: string | null, requestId: string | null): Promise<RideVerdict> {
    const verdict = await this.transactions.run(async (tx) => {
      const ride = await this.rides.findById(rideId, tx);
      if (!ride) throw new NotFoundError('ride not found');
      await this.players.findByWalletForUpdate(ride.wallet, tx);
      // a completed shift whose judgement failed after /end (best-effort) has no verdict yet: judge it now, then decide
      const current = (await this.verdicts.findByRide(rideId, tx)) ?? (ride.isInStatus(RideStatus.Completed) ? RideVerdict.judge(ride, await this.batches.listByRide(rideId, tx), this.clock.now()) : null);
      if (!current) throw new NotFoundError('this ride has no verdict (only completed shifts are judged)');
      const before = current.status;
      const now = this.clock.now();
      current.override(decision, admin, note, now);
      await this.verdicts.save(current, tx);
      await this.audit.insert({ wallet: admin, action: 'verdict.override', target: rideId, detail: { from: before, to: decision, note, rider: ride.wallet }, requestId, at: now }, tx);
      return current;
    });
    this.logger.log({ event: 'admin', msg: `verdict of ride ${rideId} set to ${decision} by ${admin}`, action: 'verdict.override', rideId, admin, decision, requestId });
    return verdict;
  }
}
