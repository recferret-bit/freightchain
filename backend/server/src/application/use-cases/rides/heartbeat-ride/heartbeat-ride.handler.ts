import { Optional } from '@nestjs/common';
import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { toRideDto, type MinigameArmedDto, type RideDto } from '../../../../domain/rides/ride.dto.js';
import { RideStatus } from '../../../../domain/rides/ride-status.js';
import { progressMilestones, progressRatio } from '../../../../domain/rides/ride-progress.js';
import { ConflictError } from '../../../../domain/shared/errors.js';
import { AnalyticsPort } from '../../../ports/analytics/analytics.port.js';
import { RulesConfigPort } from '../../../ports/config/rules-config.port.js';
import { RideRepositoryPort } from '../../../ports/rides/ride.repository.port.js';
import { PlayerRepositoryPort } from '../../../ports/players/player.repository.port.js';
import { ClockPort } from '../../../ports/shared/clock.port.js';
import { EntropyPort } from '../../../ports/shared/entropy.port.js';
import { TransactionPort } from '../../../ports/shared/transaction.port.js';
import { rideFailed, rideProgressed } from '../../../services/analytics-events.js';
import { emitAnalytics } from '../../../services/analytics-emit.js';
import { isDemoWallet } from '../../../services/demo.js';
import { StatsService } from '../../../services/stats.service.js';
import { RideLookupService } from '../../../services/ride-lookup.service.js';
import { MinigameSessionService } from '../../../services/minigame-session.service.js';
import { withVersionRetry } from '../../../services/version-retry.js';
import { HeartbeatRideCommand } from './heartbeat-ride.command.js';

/** A progress report every ~10 s. The server judges it (see Ride.applyReport); one too soon after the last is ignored. A lost optimistic lock is a 409 – the client just beats again.
    The response carries the open challenge (Ride.issueChallenge – verified play): a new one is issued here when it is due by the ride's drive clock. The kind is a row in CHALLENGE_KINDS; the cab handler shows whatever the DTO names. */
@CommandHandler(HeartbeatRideCommand)
export class HeartbeatRideHandler implements ICommandHandler<HeartbeatRideCommand, RideDto> {
  constructor(
    private readonly lookup: RideLookupService,
    private readonly rides: RideRepositoryPort,
    private readonly rules: RulesConfigPort,
    private readonly clock: ClockPort,
    private readonly analytics: AnalyticsPort,
    private readonly entropy: EntropyPort,
    private readonly transactions: TransactionPort,
    private readonly players: PlayerRepositoryPort,
    private readonly stats: StatsService,
    @Optional() private readonly minigames?: MinigameSessionService,
  ) {}

  async execute({ wallet, rideId, report }: HeartbeatRideCommand): Promise<RideDto> {
    const ride = await this.lookup.require(rideId, wallet);
    if (!ride.isInStatus(RideStatus.Running)) throw new ConflictError(`ride is ${ride.status}`);
    const now = this.clock.now();
    if (!ride.canAcceptHeartbeat(now, this.rules.get())) return this.dto(ride, now, this.minigames ? await this.minigames.view(ride) : undefined); // ignored, but the open prompt and any armed minigame still ride along
    const before = progressRatio(ride.distance, ride.completeDist);
    const rules = this.rules.get(), interval = ride.isFree && !rules.challengeFreeRides ? 0 : rules.challengeIntervalSeconds; // CHALLENGE_FREE_RIDES=off: none on the free run
    const accepted = ride.applyReport(report, now, rules); // a report that fails the ride is persisted too
    if (accepted) ride.issueChallenge(now, interval, { id: this.entropy.hex(6), rnd: parseInt(this.entropy.hex(4), 16) / 0x1_0000_0000 });
    // a report that fails the ride ENDS it: its totals join the statistics in the same commit (every other beat is a plain save)
    let firstAttempt = true;
    let armed: MinigameArmedDto[] | undefined;
    const saved = accepted
      ? await (async () => { armed = this.minigames ? await this.minigames.sync(ride, now) : undefined; return this.rides.save(ride); })()
      : await withVersionRetry(() => this.transactions.run(async (tx) => {
        await this.players.findByWalletForUpdate(wallet, tx);   // player row first (the lock order of every ride writer – see EndRideHandler)
        let target = ride;
        if (!firstAttempt) {
          const fresh = await this.rides.findById(rideId, tx);
          if (!fresh || !fresh.isInStatus(RideStatus.Running)) throw new ConflictError(`ride is ${fresh?.status ?? 'missing'}`);
          fresh.applyReport(report, now, rules);
          target = fresh;
        }
        firstAttempt = false;
        armed = this.minigames ? await this.minigames.sync(target, now, tx) : undefined;
        const s = await this.rides.save(target, tx);
        await this.stats.recordRide(s.snapshot(), tx);
        return s;
      }));
    if (!accepted) await this.stats.invalidate(wallet);
    const props = saved.snapshot();
    const demo = (): boolean => isDemoWallet(this.rules.get(), wallet);
    if (!accepted || props.status === RideStatus.Failed) {
      emitAnalytics(this.analytics, () => rideFailed(props, demo(), 'heartbeat'));
    } else {
      const after = progressRatio(props.lastS, props.completeDist);
      for (const milestone of progressMilestones(before, after)) emitAnalytics(this.analytics, () => rideProgressed(props, demo(), milestone, now));
    }
    return this.dto(saved, now, armed);
  }

  private dto(ride: Parameters<typeof toRideDto>[0], now: Date, armed: MinigameArmedDto[] | undefined): RideDto {
    return toRideDto(ride, null, now, false, armed === undefined ? undefined : { minigames: armed });
  }
}
