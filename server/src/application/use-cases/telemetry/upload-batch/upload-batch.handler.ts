import { Logger } from '@nestjs/common';
import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { RideStatus } from '../../../../domain/rides/ride-status.js';
import { RideBatch } from '../../../../domain/telemetry/ride-batch.entity.js';
import { RECORDING_GRACE_MS } from '../../../../domain/telemetry/telemetry-rules.js';
import type { BatchReceiptDto } from '../../../../domain/telemetry/telemetry.dto.js';
import { ConflictError } from '../../../../domain/shared/errors.js';
import { HasherPort } from '../../../ports/shared/hasher.port.js';
import { ClockPort } from '../../../ports/shared/clock.port.js';
import { RideBatchRepositoryPort } from '../../../ports/telemetry/ride-batch.repository.port.js';
import { RideLookupService } from '../../../services/ride-lookup.service.js';
import { VerdictService } from '../../../services/verdict.service.js';
import { UploadBatchCommand } from './upload-batch.command.js';

/** One recording batch from the game. Taken while the ride runs and for a minute after it ended (the final flush); a seq already stored is a harmless re-send.
    A batch that lands after the end re-judges the ride (best-effort), so the verdict always reflects the whole recording. */
@CommandHandler(UploadBatchCommand)
export class UploadBatchHandler implements ICommandHandler<UploadBatchCommand, BatchReceiptDto> {
  private readonly logger = new Logger(UploadBatchHandler.name);

  constructor(
    private readonly lookup: RideLookupService,
    private readonly batches: RideBatchRepositoryPort,
    private readonly hasher: HasherPort,
    private readonly verdicts: VerdictService,
    private readonly clock: ClockPort,
  ) {}

  async execute({ wallet, rideId, body }: UploadBatchCommand): Promise<BatchReceiptDto> {
    const ride = await this.lookup.require(rideId, wallet);
    const now = this.clock.now();
    if (!ride.acceptsRecording(now, RECORDING_GRACE_MS)) throw new ConflictError(`ride is ${ride.status}`);
    const batch = RideBatch.accept(rideId, body, this.hasher.sha256Hex(RideBatch.canonical(body)), now);
    const stored = await this.batches.insert(batch);
    if (stored && !ride.isInStatus(RideStatus.Running)) {
      await this.verdicts.judge(rideId).catch((error: unknown) => { this.logger.warn(`re-judging ride ${rideId} failed: ${error instanceof Error ? error.message : String(error)}`); });
    }
    return { seq: batch.seq, stored, hashOk: batch.hashOk };
  }
}
