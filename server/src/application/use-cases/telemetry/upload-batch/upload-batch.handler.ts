import { Logger } from '@nestjs/common';
import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { RideStatus } from '../../../../domain/rides/ride-status.js';
import { RideBatch } from '../../../../domain/telemetry/ride-batch.entity.js';
import { RECORDING_GRACE_MS } from '../../../../domain/telemetry/telemetry-rules.js';
import type { BatchReceiptDto } from '../../../../domain/telemetry/telemetry.dto.js';
import { BadRequestError, ConflictError } from '../../../../domain/shared/errors.js';
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
    const result = this.transactions.run(async (tx) => {
      await this.players.findByWalletForUpdate(wallet, tx);
      const ride = await this.lookup.require(rideId, wallet, tx);
      const now = this.clock.now();
      if (!ride.acceptsRecording(now, RECORDING_GRACE_MS)) throw new ConflictError(`ride is ${ride.status}`);
      const accepted = RideBatch.accept(rideId, body, serverHash, now, ride.recordingAllowance(now), text);
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
