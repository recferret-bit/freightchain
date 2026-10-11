import { Logger } from '@nestjs/common';
import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { toRideDto, type RideDto } from '../../../../domain/rides/ride.dto.js';
import { Ride } from '../../../../domain/rides/ride.entity.js';
import type { RideProps } from '../../../../domain/rides/ride.entity.js';
import { RideStatus } from '../../../../domain/rides/ride-status.js';
import { progressMilestones, progressRatio } from '../../../../domain/rides/ride-progress.js';
import { ConflictError } from '../../../../domain/shared/errors.js';
import { AnalyticsPort } from '../../../ports/analytics/analytics.port.js';
import { RulesConfigPort } from '../../../ports/config/rules-config.port.js';
import { PlayerRepositoryPort } from '../../../ports/players/player.repository.port.js';
import { RideRepositoryPort } from '../../../ports/rides/ride.repository.port.js';
import { ClockPort } from '../../../ports/shared/clock.port.js';
import { TransactionPort } from '../../../ports/shared/transaction.port.js';
import { AchievementService, type FreshUnlock } from '../../../services/achievement.service.js';
import { achievementUnlocked, rideAbandoned, rideCompleted, rideFailed, rideProgressed } from '../../../services/analytics-events.js';
import { emitAnalytics } from '../../../services/analytics-emit.js';
import { isDemoWallet } from '../../../services/demo.js';
import { RideLookupService } from '../../../services/ride-lookup.service.js';
import { StatsService } from '../../../services/stats.service.js';
import { VerdictService } from '../../../services/verdict.service.js';
import { withVersionRetry } from '../../../services/version-retry.js';
import { EndRideCommand } from './end-ride.command.js';

interface EndFacts {
  props: RideProps;
  before: number;
  accepted: boolean;
  now: Date;
}

/**
 * The driver ended the shift ('shift': the server decides completed / abandoned) or the ride failed ('failed': a crash etc.).
 * The final report is applied first; a ride that report fails stays failed. Ending must not lose to a racing heartbeat, hence the retry on a lost lock –
 * otherwise a finished ride would sit "running" until its timeout. Unlocks are persisted right after – best-effort: the verdict is already saved, a failure
 * there must not turn it into a 500 (the next profile read catches the unlocks up). A completed shift is then judged from its recording (verified play) –
 * best-effort too: a failure leaves it unjudged (verdict null), and a batch that lands after the end judges it again.
 */
@CommandHandler(EndRideCommand)
export class EndRideHandler implements ICommandHandler<EndRideCommand, RideDto> {
  private readonly logger = new Logger(EndRideHandler.name);

  constructor(
    private readonly lookup: RideLookupService,
    private readonly rides: RideRepositoryPort,
    private readonly achievements: AchievementService,
    private readonly verdicts: VerdictService,
    private readonly rules: RulesConfigPort,
    private readonly clock: ClockPort,
    private readonly analytics: AnalyticsPort,
    private readonly transactions: TransactionPort,
    private readonly players: PlayerRepositoryPort,
    private readonly stats: StatsService,
  ) {}

  async execute({ wallet, rideId, outcome, report, reason }: EndRideCommand): Promise<RideDto> {
    const facts = await withVersionRetry(() => this.transactions.run(async (tx) => {
      await this.players.findByWalletForUpdate(wallet, tx);   // the player row first, like every writer of the wallet's rides: the statistics insert checks that row, so taking it later would deadlock with the sweep
      const ride = await this.lookup.require(rideId, wallet, tx);
      if (!ride.isInStatus(RideStatus.Running)) throw new ConflictError(`ride is ${ride.status}`);
      const now = this.clock.now();
      const before = progressRatio(ride.distance, ride.completeDist);
      const accepted = ride.applyReport(report, now, this.rules.get());
      if (accepted) ride.finish(outcome, reason, now);
      const saved = await this.rides.save(ride, tx);
      await this.stats.recordRide(saved.snapshot(), tx); // the ride ended (completed, abandoned or failed): its metres, seconds and crashes join the totals in the same commit
      return { props: saved.snapshot(), before, accepted, now } satisfies EndFacts;
    }));
    await this.stats.invalidate(wallet);
    this.emitVerdict(wallet, facts);
    const verdict = await this.verdicts.judge(rideId).catch((error: unknown) => {
      this.logger.warn(`verdict for ride ${rideId} not judged: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    });
    const unlocked = await this.achievements.evaluate(wallet, rideId).catch((error: unknown) => {   // AFTER the verdict: while it is enforced a rejected recording earns no badge (achievements.ts badgeRejected)
      this.logger.warn(`achievements for ride ${rideId} deferred to the next profile read: ${error instanceof Error ? error.message : String(error)}`);
      return [] as FreshUnlock[];
    });
    this.emitUnlocks(wallet, rideId, unlocked);
    return toRideDto(Ride.restore(facts.props), verdict?.toDto() ?? null);
  }

  private emitVerdict(wallet: string, facts: EndFacts): void {
    const demo = (): boolean => isDemoWallet(this.rules.get(), wallet);
    if (facts.accepted) {
      const after = progressRatio(facts.props.lastS, facts.props.completeDist);
      for (const milestone of progressMilestones(facts.before, after)) emitAnalytics(this.analytics, () => rideProgressed(facts.props, demo(), milestone, facts.now));
    }
    if (facts.props.status === RideStatus.Completed) emitAnalytics(this.analytics, () => rideCompleted(facts.props, demo()));
    else if (facts.props.status === RideStatus.Abandoned) emitAnalytics(this.analytics, () => rideAbandoned(facts.props, demo()));
    else if (facts.props.status === RideStatus.Failed) emitAnalytics(this.analytics, () => rideFailed(facts.props, demo(), 'end'));
  }

  private emitUnlocks(wallet: string, rideId: string, unlocked: FreshUnlock[]): void {
    for (const unlock of unlocked) {
      if (unlock.id === 'top-20') continue;
      emitAnalytics(this.analytics, () => achievementUnlocked(wallet, unlock.id, unlock.earnedAt, rideId, isDemoWallet(this.rules.get(), wallet)));
    }
  }
}
