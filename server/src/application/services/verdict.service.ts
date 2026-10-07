import { Injectable, Logger } from '@nestjs/common';
import { RideStatus } from '../../domain/rides/ride-status.js';
import { RideVerdict } from '../../domain/verdict/ride-verdict.entity.js';
import { PlayerRepositoryPort } from '../ports/players/player.repository.port.js';
import { RideRepositoryPort } from '../ports/rides/ride.repository.port.js';
import { ClockPort } from '../ports/shared/clock.port.js';
import { TransactionPort } from '../ports/shared/transaction.port.js';
import { RideBatchRepositoryPort } from '../ports/telemetry/ride-batch.repository.port.js';
import { RideVerdictRepositoryPort } from '../ports/verdict/ride-verdict.repository.port.js';

/**
 * Judges a completed ride from its stored recording (RideVerdict.judge) and saves the verdict. Called right after /end and again when a batch lands
 * after the end (the final flush). Runs under the wallet's player row lock, and reads the batches only once it holds it: of two racing judgements
 * the one that saves last has seen every batch the other saw, so a stale verdict can never overwrite a fresher one.
 */
@Injectable()
export class VerdictService {
  private readonly logger = new Logger(VerdictService.name);

  constructor(
    private readonly rides: RideRepositoryPort,
    private readonly players: PlayerRepositoryPort,
    private readonly batches: RideBatchRepositoryPort,
    private readonly verdicts: RideVerdictRepositoryPort,
    private readonly transactions: TransactionPort,
    private readonly clock: ClockPort,
  ) {}

  /** null = nothing to judge (only completed shifts can rank, so only they are judged). */
  async judge(rideId: string): Promise<RideVerdict | null> {
    return this.transactions.run(async (tx) => {
      const ride = await this.rides.findById(rideId, tx);
      if (!ride || !ride.isInStatus(RideStatus.Completed)) return null;
      await this.players.findByWalletForUpdate(ride.wallet, tx);
      const verdict = RideVerdict.judge(ride, await this.batches.listByRide(rideId, tx), this.clock.now());
      await this.verdicts.save(verdict, tx);
      this.logger.log({ event: 'verdict', msg: `ride ${rideId}: ${verdict.status}`, rideId, wallet: ride.wallet, status: verdict.status, reasons: verdict.reasons.map((r) => r.code) });
      return verdict;
    });
  }
}
