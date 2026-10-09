import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { toRideDto, type RideDto } from '../../../../domain/rides/ride.dto.js';
import { RideStatus } from '../../../../domain/rides/ride-status.js';
import { progressMilestones, progressRatio } from '../../../../domain/rides/ride-progress.js';
import { ConflictError } from '../../../../domain/shared/errors.js';
import { AnalyticsPort } from '../../../ports/analytics/analytics.port.js';
import { RulesConfigPort } from '../../../ports/config/rules-config.port.js';
import { RideRepositoryPort } from '../../../ports/rides/ride.repository.port.js';
import { PlayerRepositoryPort } from '../../../ports/players/player.repository.port.js';
import { ClockPort } from '../../../ports/shared/clock.port.js';
import { TransactionPort } from '../../../ports/shared/transaction.port.js';
import { rideFailed, rideProgressed } from '../../../services/analytics-events.js';
import { emitAnalytics } from '../../../services/analytics-emit.js';
import { isDemoWallet } from '../../../services/demo.js';
import { StatsService } from '../../../services/stats.service.js';
import { RideLookupService } from '../../../services/ride-lookup.service.js';
import { HeartbeatRideCommand } from './heartbeat-ride.command.js';

/** A progress report every ~10 s. The server judges it (see Ride.applyReport); one too soon after the last is ignored. A lost optimistic lock is a 409 – the client just beats again. */
@CommandHandler(HeartbeatRideCommand)
export class HeartbeatRideHandler implements ICommandHandler<HeartbeatRideCommand, RideDto> {
  constructor(
    private readonly lookup: RideLookupService,
    private readonly rides: RideRepositoryPort,
    private readonly rules: RulesConfigPort,
    private readonly clock: ClockPort,
    private readonly analytics: AnalyticsPort,
    private readonly transactions: TransactionPort,
    private readonly players: PlayerRepositoryPort,
    private readonly stats: StatsService,
  ) {}

  async execute({ wallet, rideId, report }: HeartbeatRideCommand): Promise<RideDto> {
    const ride = await this.lookup.require(rideId, wallet);
    if (!ride.isInStatus(RideStatus.Running)) throw new ConflictError(`ride is ${ride.status}`);
    const now = this.clock.now();
    if (!ride.canAcceptHeartbeat(now, this.rules.get())) return toRideDto(ride);
    const before = progressRatio(ride.driveSeconds, ride.minSeconds, ride.distance, ride.completeDist);
    const accepted = ride.applyReport(report, now, this.rules.get()); // a report that fails the ride is persisted too
    // a report that fails the ride ENDS it: its totals join the statistics in the same commit (every other beat is a plain save)
    const saved = accepted ? await this.rides.save(ride) : await this.transactions.run(async (tx) => {
      await this.players.findByWalletForUpdate(wallet, tx);   // player row first (the lock order of every ride writer – see EndRideHandler)
      const s = await this.rides.save(ride, tx);
      await this.stats.recordRide(s.snapshot(), tx);
      return s;
    });
    if (!accepted) await this.stats.invalidate(wallet);
    const props = saved.snapshot();
    const demo = (): boolean => isDemoWallet(this.rules.get(), wallet);
    if (!accepted || props.status === RideStatus.Failed) {
      emitAnalytics(this.analytics, () => rideFailed(props, demo(), 'heartbeat'));
    } else {
      const after = progressRatio(props.driveSeconds, props.minSeconds, props.lastS, props.completeDist);
      for (const milestone of progressMilestones(before, after)) emitAnalytics(this.analytics, () => rideProgressed(props, demo(), milestone, now));
    }
    return toRideDto(saved);
  }
}
