import { Logger } from '@nestjs/common';
import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { toRideDto, type RideDto } from '../../../../domain/rides/ride.dto.js';
import { RideStatus } from '../../../../domain/rides/ride-status.js';
import { ConflictError } from '../../../../domain/shared/errors.js';
import { RulesConfigPort } from '../../../ports/config/rules-config.port.js';
import { RideRepositoryPort } from '../../../ports/rides/ride.repository.port.js';
import { ClockPort } from '../../../ports/shared/clock.port.js';
import { AchievementService } from '../../../services/achievement.service.js';
import { RideLookupService } from '../../../services/ride-lookup.service.js';
import { withVersionRetry } from '../../../services/version-retry.js';
import { EndRideCommand } from './end-ride.command.js';

/**
 * The driver ended the shift ('shift': the server decides completed / abandoned) or the ride failed ('failed': a crash etc.).
 * The final report is applied first; a ride that report fails stays failed. Ending must not lose to a racing heartbeat, hence the retry on a lost lock –
 * otherwise a finished ride would sit "running" until its timeout. Unlocks are persisted right after – best-effort: the verdict is already saved, a failure
 * there must not turn it into a 500 (the next profile read catches the unlocks up).
 */
@CommandHandler(EndRideCommand)
export class EndRideHandler implements ICommandHandler<EndRideCommand, RideDto> {
  private readonly logger = new Logger(EndRideHandler.name);

  constructor(
    private readonly lookup: RideLookupService,
    private readonly rides: RideRepositoryPort,
    private readonly achievements: AchievementService,
    private readonly rules: RulesConfigPort,
    private readonly clock: ClockPort,
  ) {}

  async execute({ wallet, rideId, outcome, report, reason }: EndRideCommand): Promise<RideDto> {
    const saved = await withVersionRetry(async () => {
      const ride = await this.lookup.require(rideId, wallet);
      if (!ride.isInStatus(RideStatus.Running)) throw new ConflictError(`ride is ${ride.status}`);
      const now = this.clock.now();
      if (ride.applyReport(report, now, this.rules.get())) ride.finish(outcome, reason, now);
      return this.rides.save(ride);
    });
    await this.achievements.evaluate(wallet, rideId).catch((error: unknown) => {
      this.logger.warn(`achievements for ride ${rideId} deferred to the next profile read: ${error instanceof Error ? error.message : String(error)}`);
    });
    return toRideDto(saved);
  }
}
