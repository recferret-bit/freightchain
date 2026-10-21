import { Logger, Optional } from '@nestjs/common';
import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { inpPrunable } from '../../../../domain/anticheat/inp-retention.js';
import { clusterAlert, flagSimilarTraces } from '../../../../domain/anticheat/trace-cluster.js';
import { DAY_MS } from '../../../../domain/shared/time.js';
import { flagClusteredRides } from '../../../telemetry/trace-review.js';
import { RulesConfigPort } from '../../../ports/config/rules-config.port.js';
import { ClockPort } from '../../../ports/shared/clock.port.js';
import { RideBatchRepositoryPort } from '../../../ports/telemetry/ride-batch.repository.port.js';
import { RideVerdictRepositoryPort } from '../../../ports/verdict/ride-verdict.repository.port.js';
import { SweepTelemetryCommand, type SweepTelemetryResultDto } from './sweep-telemetry.command.js';

/** The daily retention job: recordings of rides that ended more than TELEMETRY_RETENTION_DAYS ago are deleted – except flagged rides, kept until a person
    has reviewed them. Idempotent (a second run the same day deletes nothing more). The ride rows and their verdicts stay. */
@CommandHandler(SweepTelemetryCommand)
export class SweepTelemetryHandler implements ICommandHandler<SweepTelemetryCommand, SweepTelemetryResultDto> {
  private readonly logger = new Logger(SweepTelemetryHandler.name);

  constructor(
    private readonly batches: RideBatchRepositoryPort,
    private readonly rules: RulesConfigPort,
    private readonly clock: ClockPort,
    @Optional() private readonly verdicts?: RideVerdictRepositoryPort,
  ) {}

  async execute(command: SweepTelemetryCommand = new SweepTelemetryCommand()): Promise<SweepTelemetryResultDto> {
    const now = this.clock.now();
    if (!command.deferWave5) await this.retainWave5(now);
    const days = this.rules.get().telemetryRetentionDays;
    if (days <= 0) return { cutoff: null, deleted: 0 };
    const cutoff = new Date(now.getTime() - days * DAY_MS);
    const deleted = await this.batches.deleteForRidesEndedBefore(cutoff);
    return { cutoff: cutoff.getTime(), deleted };
  }

  /** Raw 30 Hz inp goes only after the pool is paid and 90 days. Similar traces in an open validation window raise trace-cluster. Returns how many rides lost raw inp. */
  private async retainWave5(now: Date): Promise<number> {
    const drop = (await this.batches.inpRetentionRows()).filter((row) => inpPrunable(row, now));
    if (drop.length) await this.batches.nullInp(drop);
    const flags = flagSimilarTraces(await this.batches.validationTraces(now));
    const alert = clusterAlert(flags);
    if (alert) this.logger.warn({ event: 'trace-cluster', msg: alert.detail, code: alert.code });
    if (this.verdicts && flags.length) await flagClusteredRides(this.verdicts, flags);
    return drop.length;
  }
}
