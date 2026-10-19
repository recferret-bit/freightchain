import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { VersionConflictError } from '../../../../domain/shared/errors.js';
import { AnalyticsPort } from '../../../ports/analytics/analytics.port.js';
import { RulesConfigPort } from '../../../ports/config/rules-config.port.js';
import { PlayerRepositoryPort } from '../../../ports/players/player.repository.port.js';
import { RideQueryPort } from '../../../ports/rides/ride-query.port.js';
import { RideRepositoryPort } from '../../../ports/rides/ride.repository.port.js';
import { ClockPort } from '../../../ports/shared/clock.port.js';
import { TransactionPort } from '../../../ports/shared/transaction.port.js';
import { StatsService } from '../../../services/stats.service.js';
import { rideFailed } from '../../../services/analytics-events.js';
import { emitAnalytics } from '../../../services/analytics-emit.js';
import { isDemoWallet } from '../../../services/demo.js';
import { SweepStaleRidesCommand, type SweepStaleRidesResultDto } from './sweep-stale-rides.command.js';

const BATCH = 200;

/**
 * Accurate "who is on the road": a ride whose tab vanished used to stay `running` until its wallet started another. Silent for HB_TIMEOUT_MS it can never
 * resume anyway (its next heartbeat would fail it – Ride.applyReport), so the sweep ends it then, the same way
 * StartRideHandler does – failed · heartbeat lost – ONE transaction per ride under its OWNER's player row lock (the lock heartbeat, /end and recording
 * uploads take), re-checking staleness inside it: a heartbeat that landed meanwhile keeps the ride running, a ride /end closed is skipped, so a ride
 * ends exactly once; heartbeat and /end save with the ride's optimistic version, so if one of them wins the race the sweep's save conflicts and that ride
 * is simply skipped until the next sweep. Nothing else is touched (no verdict – only completed shifts are judged –, no achievements, no boards).
 */
@CommandHandler(SweepStaleRidesCommand)
export class SweepStaleRidesHandler implements ICommandHandler<SweepStaleRidesCommand, SweepStaleRidesResultDto> {
  constructor(
    private readonly rideQuery: RideQueryPort,
    private readonly rides: RideRepositoryPort,
    private readonly players: PlayerRepositoryPort,
    private readonly transactions: TransactionPort,
    private readonly rules: RulesConfigPort,
    private readonly clock: ClockPort,
    private readonly analytics: AnalyticsPort,
    private readonly stats: StatsService,
  ) {}

  async execute(): Promise<SweepStaleRidesResultDto> {
    const rules = this.rules.get();
    const stale = await this.rideQuery.staleRunning(new Date(this.clock.now().getTime() - rules.hbTimeoutMs), BATCH);
    let ended = 0, skipped = 0;
    for (const { id, wallet } of stale) {
      const failed = await this.transactions.run(async (tx) => {
        await this.players.findByWalletForUpdate(wallet, tx);
        const ride = await this.rides.findById(id, tx);
        const now = this.clock.now();
        if (!ride || !ride.isStaleRunning(now, rules)) return null;
        ride.failHeartbeatLost(now);
        const props = (await this.rides.save(ride, tx)).snapshot();
        await this.stats.recordRide(props, tx);
        return props;
      }).catch((error: unknown) => {
        // heartbeat and /end write the ride with its optimistic version: one landed in between, so the ride is alive (or ended) – skip it, the next
        // sweep looks again; never let one ride stop the sweep
        if (error instanceof VersionConflictError) return null;
        throw error;
      });
      if (!failed) { skipped++; continue; }
      ended++;
      await this.stats.invalidate(wallet);
      emitAnalytics(this.analytics, () => rideFailed(failed, isDemoWallet(rules, wallet), 'stale_sweep'));
    }
    return { ended, skipped };
  }
}
