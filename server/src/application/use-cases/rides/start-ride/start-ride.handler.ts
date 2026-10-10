import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { toRideDto, type RideDto } from '../../../../domain/rides/ride.dto.js';
import type { RideProps } from '../../../../domain/rides/ride.entity.js';
import { RideStatus } from '../../../../domain/rides/ride-status.js';
import { ConflictError, NotFoundError } from '../../../../domain/shared/errors.js';
import { AnalyticsPort } from '../../../ports/analytics/analytics.port.js';
import { RulesConfigPort } from '../../../ports/config/rules-config.port.js';
import { toWardrobeDto } from '../../../../domain/economy/wardrobe.dto.js';
import { CosmeticRepositoryPort } from '../../../ports/players/cosmetic.repository.port.js';
import { PlayerRepositoryPort } from '../../../ports/players/player.repository.port.js';
import { RideRepositoryPort } from '../../../ports/rides/ride.repository.port.js';
import { ClockPort } from '../../../ports/shared/clock.port.js';
import { TransactionPort } from '../../../ports/shared/transaction.port.js';
import { StatsService } from '../../../services/stats.service.js';
import { rideFailed, rideStarted } from '../../../services/analytics-events.js';
import { emitAnalytics } from '../../../services/analytics-emit.js';
import { isDemoWallet } from '../../../services/demo.js';
import { RideLookupService } from '../../../services/ride-lookup.service.js';
import { StartRideCommand } from './start-ride.command.js';

interface StartFacts {
  dto: RideDto;
  started: RideProps;
  failed: RideProps | null;
}

/**
 * The game page pressed START: the server clock for this ride starts now. Under the wallet's row lock, so at most ONE ride per wallet runs at a time
 * (a wallet can own two PAID ready rides when a late payment lands – both are owed, but they run one after the other). A ride that is not "created" is a 409.
 * The ride also keeps what the wallet wears at this moment (visuals – the game wears the loadout in the answer).
 * A free ride started with the TUTORIAL on marks the player's `tutorialPassedAt` (first time only), in the same transaction under the same lock.
 */
@CommandHandler(StartRideCommand)
export class StartRideHandler implements ICommandHandler<StartRideCommand, RideDto> {
  constructor(
    private readonly lookup: RideLookupService,
    private readonly rides: RideRepositoryPort,
    private readonly players: PlayerRepositoryPort,
    private readonly cosmetics: CosmeticRepositoryPort,
    private readonly rules: RulesConfigPort,
    private readonly transactions: TransactionPort,
    private readonly clock: ClockPort,
    private readonly analytics: AnalyticsPort,
    private readonly stats: StatsService,
  ) {}

  async execute({ wallet, rideId }: StartRideCommand): Promise<RideDto> {
    const facts = await this.transactions.run(async (tx) => {
      const now = this.clock.now();
      const player = await this.players.findByWalletForUpdate(wallet, tx);
      if (!player) throw new NotFoundError('ride not found');
      const ride = await this.lookup.require(rideId, wallet, tx);
      if (!ride.isInStatus(RideStatus.Created)) throw new ConflictError(`ride is ${ride.status}`); // its own precondition first: unpaid, running, ended…
      const running = (await this.rides.listOpenByWallet(wallet, tx)).find((r) => r.id !== ride.id && r.isInStatus(RideStatus.Running));
      let failed: RideProps | null = null;
      if (running?.isStaleRunning(now, this.rules.get())) { // a tab that vanished mid-ride must not block the next one
        running.failHeartbeatLost(now);
        await this.rides.save(running, tx);
        failed = running.snapshot();
        await this.stats.recordRide(failed, tx);
      } else if (running) {
        throw new ConflictError('another ride is in progress');
      }
      const wardrobe = toWardrobeDto(await this.cosmetics.listUnlocked(wallet, tx), await this.cosmetics.listEquipped(wallet, tx));
      ride.start(now, wardrobe.equipped);   // what is worn right now (owned items only) goes with the ride: live streams and replays draw it
      const saved = await this.rides.save(ride, tx);
      if (ride.tutorial && player.markTutorialPassed(now)) await this.players.save(player, tx);   // starting a ride with the tutorial on = it was done: the lobby leaves it off from now on
      return { dto: toRideDto(saved), started: saved.snapshot(), failed } satisfies StartFacts;
    });
    const demo = (): boolean => isDemoWallet(this.rules.get(), wallet);
    if (facts.failed) await this.stats.invalidate(wallet);
    if (facts.failed) { const failed = facts.failed; emitAnalytics(this.analytics, () => rideFailed(failed, demo(), 'stale_on_start')); }
    emitAnalytics(this.analytics, () => rideStarted(facts.started, demo()));
    return facts.dto;
  }
}
