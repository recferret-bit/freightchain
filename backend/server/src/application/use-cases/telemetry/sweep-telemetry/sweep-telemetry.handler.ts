import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { DAY_MS } from '../../../../domain/shared/time.js';
import { RulesConfigPort } from '../../../ports/config/rules-config.port.js';
import { ClockPort } from '../../../ports/shared/clock.port.js';
import { RideBatchRepositoryPort } from '../../../ports/telemetry/ride-batch.repository.port.js';
import { SweepTelemetryCommand, type SweepTelemetryResultDto } from './sweep-telemetry.command.js';

/** The daily retention job: recordings of rides that ended more than TELEMETRY_RETENTION_DAYS ago are deleted – except flagged rides, kept until a person
    has reviewed them. Idempotent (a second run the same day deletes nothing more). The ride rows and their verdicts stay. */
@CommandHandler(SweepTelemetryCommand)
export class SweepTelemetryHandler implements ICommandHandler<SweepTelemetryCommand, SweepTelemetryResultDto> {
  constructor(
    private readonly batches: RideBatchRepositoryPort,
    private readonly rules: RulesConfigPort,
    private readonly clock: ClockPort,
  ) {}

  async execute(): Promise<SweepTelemetryResultDto> {
    const days = this.rules.get().telemetryRetentionDays;
    if (days <= 0) return { cutoff: null, deleted: 0 };
    const cutoff = new Date(this.clock.now().getTime() - days * DAY_MS);
    return { cutoff: cutoff.getTime(), deleted: await this.batches.deleteForRidesEndedBefore(cutoff) };
  }
}
