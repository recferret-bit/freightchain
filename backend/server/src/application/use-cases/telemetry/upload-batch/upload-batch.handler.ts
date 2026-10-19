import { Logger } from '@nestjs/common';
import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { roadPlanFor } from '../../../../domain/road/road-plan.js';
import { RideStatus } from '../../../../domain/rides/ride-status.js';
import { RideBatch } from '../../../../domain/telemetry/ride-batch.entity.js';
import { RECORDING_GRACE_MS } from '../../../../domain/telemetry/telemetry-rules.js';
import type { BatchReceiptDto } from '../../../../domain/telemetry/telemetry.dto.js';
import { BadRequestError, ConflictError, TooManyRequestsError } from '../../../../domain/shared/errors.js';
import { PlayerRepositoryPort } from '../../../ports/players/player.repository.port.js';
import { HasherPort } from '../../../ports/shared/hasher.port.js';
import { ClockPort } from '../../../ports/shared/clock.port.js';
import { TransactionPort } from '../../../ports/shared/transaction.port.js';
import { RideBatchRepositoryPort } from '../../../ports/telemetry/ride-batch.repository.port.js';
import { RideLookupService } from '../../../services/ride-lookup.service.js';
import { VerdictService } from '../../../services/verdict.service.js';
import { UploadBatchCommand } from './upload-batch.command.js';

/**
 * One recording batch from the game. Taken while the ride runs and for a minute after it ended (the final flush); a seq already stored is a harmless re-send.
 * The batch is stored in ONE transaction under the wallet's player row lock with the ride read inside it – the same lock /end's judgement takes – so the
 * two serialise: either the judgement sees this batch, or this upload sees the ride already ended and re-judges after its commit. No batch is ever left unjudged.
 * Batches are taken IN ORDER: batch n+1 waits (429 – the game retries it) until batch n is stored, decided on the same read that supplies the tail it is
 * measured with – else a hole pass on the cut between them would never be measured (audit M10; the game's queue is strictly ordered anyway).
 */
@CommandHandler(UploadBatchCommand)
export class UploadBatchHandler implements ICommandHandler<UploadBatchCommand, BatchReceiptDto> {
  private readonly logger = new Logger(UploadBatchHandler.name);

  constructor(
    private readonly lookup: RideLookupService,
    private readonly batches: RideBatchRepositoryPort,
    private readonly hasher: HasherPort,
    private readonly verdicts: VerdictService,
    private readonly clock: ClockPort,
    private readonly players: PlayerRepositoryPort,
    private readonly transactions: TransactionPort,
  ) {}

  async execute({ wallet, rideId, body }: UploadBatchCommand): Promise<BatchReceiptDto> {
    const text = RideBatch.canonical(body);
    const serverHash = this.hasher.sha256Hex(text); // outside the lock: hashing ~100 kB is the slow part
    // the batch before, if stored: its tail is measured with this one against the road (the client chooses where batches are cut – a hole pass across
    // the cut must not go unmeasured). Stored batches never change, so it is read outside the lock too.
    const before = body.seq > 0 ? (await this.batches.listFrom(rideId, body.seq - 1, 1)).find((b) => b.rideId === rideId && b.seq === body.seq - 1) : undefined;
    // an EMPTY batch before (the final flush right after a cut – or one a forger put at a pit) must not cut the measured tail: take the one before it
    const tailOf = before && before.body.samples.length === 0 && body.seq > 1 ? (await this.batches.listFrom(rideId, body.seq - 2, 1)).find((b) => b.rideId === rideId && b.seq === body.seq - 2) : before;
    if (before && before.body.samples.length === 0 && body.samples.length === 0) throw new BadRequestError('two empty batches in a row – the game samples every 0.1 s it drives', 'bad_batch');
    const result = this.transactions.run(async (tx) => {
      await this.players.findByWalletForUpdate(wallet, tx);
      const ride = await this.lookup.require(rideId, wallet, tx);
      const now = this.clock.now();
      if (!ride.acceptsRecording(now, RECORDING_GRACE_MS)) throw new ConflictError(`ride is ${ride.status}`);
      const accepted = RideBatch.accept(rideId, body, serverHash, now, ride.recordingAllowance(now), text, await this.batches.totalBytes(rideId, tx), roadPlanFor(ride.seed, ride.trip), tailOf?.body.samples ?? []); // the per-ride byte budget counts what is stored already; the samples are measured against the SERVER's road (the seed's)
      if (body.seq > 0 && !before) throw new TooManyRequestsError(`batch ${body.seq - 1} of this ride is not stored yet – send the batches in order`, 'batch_out_of_order', 2);   // after the refusals above: a batch that can never be taken says so (400)
      return { batch: accepted, stored: await this.batches.insert(accepted, tx), ended: !ride.isInStatus(RideStatus.Running) };
    });
    const { batch, stored, ended } = await result.catch((error: unknown) => {
      // a refused batch breaks the ride's chain: say why, so the admin page (logs, filtered by the ride id) can explain the verdict
      if (error instanceof BadRequestError) this.logger.warn({ event: 'batch-refused', msg: `batch ${body.seq} of ride ${rideId} refused: ${error.message}`, rideId, wallet, seq: body.seq, detail: error.message });
      throw error;
    });
    if (stored && ended) {
      await this.verdicts.judge(rideId).catch((error: unknown) => { this.logger.warn(`re-judging ride ${rideId} failed: ${error instanceof Error ? error.message : String(error)}`); });
    }
    return { seq: batch.seq, stored, hashOk: batch.hashOk };
  }
}
