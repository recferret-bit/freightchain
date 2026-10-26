import { Injectable, Logger, Optional, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { inpPrunable } from '../../domain/anticheat/inp-retention.js';
import { clusterAlert, flagSimilarTraces } from '../../domain/anticheat/trace-cluster.js';
import { SweepTelemetryCommand, type SweepTelemetryResultDto } from '../../application/use-cases/telemetry/sweep-telemetry/sweep-telemetry.command.js';
import { SweepSignInsCommand, type SweepSignInsResultDto } from '../../application/use-cases/auth/sweep-sign-ins/sweep-sign-ins.command.js';
import { CachePort } from '../../application/ports/shared/cache.port.js';
import { ClockPort } from '../../application/ports/shared/clock.port.js';
import { RideBatchRepositoryPort } from '../../application/ports/telemetry/ride-batch.repository.port.js';
import { RideVerdictRepositoryPort } from '../../application/ports/verdict/ride-verdict.repository.port.js';
import { flagClusteredRides } from '../../application/telemetry/trace-review.js';
import { DAY_MS, MINUTE_MS, nextUtcMidnight } from '../../domain/shared/time.js';

const OFFSET_MS = 30 * MINUTE_MS; // 00:30 UTC – clear of the free-ride grant at midnight
const RETRY_MS = 10 * MINUTE_MS;
const LOCK_KEY = 'sched:telemetry-retention';

/** Runs SweepTelemetryCommand and SweepSignInsCommand (the retention sweeps) on boot and every day at 00:30 UTC, coordinated across replicas via CachePort.tryLock. */
@Injectable()
export class TelemetryRetentionScheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger(TelemetryRetentionScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(
    private readonly commands: CommandBus,
    private readonly clock: ClockPort,
    @Optional() private readonly cache?: CachePort,
    @Optional() private readonly batches?: RideBatchRepositoryPort,
    @Optional() private readonly verdicts?: RideVerdictRepositoryPort,
  ) {}

  onApplicationBootstrap(): void {
    void this.run();
  }

  onApplicationShutdown(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  async run(): Promise<void> {
    let delay: number;
    let locked = false;
    try {
      if (!this.cache || (locked = await this.cache.tryLock(LOCK_KEY, 5 * MINUTE_MS))) {
        const ownsWave5 = Boolean(this.batches);
        const { deleted, cutoff } = (await this.commands.execute(new SweepTelemetryCommand(ownsWave5))) as SweepTelemetryResultDto;
        if (deleted > 0) this.log.log({ event: 'telemetry-sweep', msg: `deleted ${deleted} recording batches of rides ended before ${cutoff}`, deleted, cutoff });
        if (this.batches) await this.retainWave5(this.clock.now());
        const signIns = (await this.commands.execute(new SweepSignInsCommand())) as SweepSignInsResultDto;
        if (signIns.deleted > 0) this.log.log({ event: 'signin-sweep', msg: `deleted ${signIns.deleted} sign-in rows older than ${signIns.cutoff}`, deleted: signIns.deleted, cutoff: signIns.cutoff });
      }
      const now = this.clock.now();
      const today = nextUtcMidnight(now).getTime() - DAY_MS + OFFSET_MS;
      delay = (today > now.getTime() ? today : today + DAY_MS) - now.getTime();
    } catch (error) {
      if (locked) await this.cache?.releaseLock(LOCK_KEY).catch(() => undefined);
      this.log.error(`telemetry sweep failed: ${error instanceof Error ? error.message : String(error)}`);
      delay = RETRY_MS;
    }
    if (this.stopped) return;
    this.timer = setTimeout(() => void this.run(), delay);
    this.timer.unref();
  }

  /** Same rule as the sweep command. Runs here so the daily job, not only the command, owns inp deletion and the cluster alert. */
  private async retainWave5(now: Date): Promise<void> {
    if (!this.batches) return;
    const drop = (await this.batches.inpRetentionRows()).filter((row) => inpPrunable(row, now));
    if (drop.length) await this.batches.nullInp(drop);
    const flags = flagSimilarTraces(await this.batches.validationTraces(now));
    const alert = clusterAlert(flags);
    if (alert) this.log.warn({ event: 'trace-cluster', msg: alert.detail, code: alert.code });
    if (this.verdicts && flags.length) await flagClusteredRides(this.verdicts, flags);
  }
}
