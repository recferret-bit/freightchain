import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { toRideDto, type RideDto } from '../../../../domain/rides/ride.dto.js';
import type { RideProps } from '../../../../domain/rides/ride.entity.js';
import { RideStatus } from '../../../../domain/rides/ride-status.js';
import { MAX_SPEED } from '../../../../domain/rides/ride-rules.js';
import { tripOrClassic } from '../../../../domain/rides/ride-trip.js';
import { ConflictError, NotFoundError } from '../../../../domain/shared/errors.js';
import { AnalyticsPort } from '../../../ports/analytics/analytics.port.js';
import { RulesConfigPort } from '../../../ports/config/rules-config.port.js';
import { toWardrobeDto } from '../../../../domain/economy/wardrobe.dto.js';
import { CosmeticRepositoryPort } from '../../../ports/players/cosmetic.repository.port.js';
import { PlayerRepositoryPort } from '../../../ports/players/player.repository.port.js';
import { RideRepositoryPort } from '../../../ports/rides/ride.repository.port.js';
import { PoolRepositoryPort } from '../../../ports/economy/pool.repository.port.js';
import { ClockPort } from '../../../ports/shared/clock.port.js';
import { TransactionPort } from '../../../ports/shared/transaction.port.js';
import { StatsService } from '../../../services/stats.service.js';
import { rideFailed, rideStarted } from '../../../services/analytics-events.js';
import { emitAnalytics } from '../../../services/analytics-emit.js';
import { isDemoWallet } from '../../../services/demo.js';
import { RideLookupService } from '../../../services/ride-lookup.service.js';
import { RankedEntryService } from '../../../services/ranked-entry.service.js';
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
 * `trip` (optional): the trip the game built its road from. The lobby can re-choose a ready free ride (another level = another trip) between the game's read
 * of the ride and this start – then the game would drive one road while the server judges another: 409 `ride_rechosen`, nothing changed; the game reloads.
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
    private readonly pools: PoolRepositoryPort,
    private readonly rankedEntry: RankedEntryService,
  ) {}

  async execute({ wallet, rideId, trip, ranked, headers }: StartRideCommand): Promise<RideDto> {
    const facts = await this.transactions.run(async (tx) => {
      const now = this.clock.now();
      const player = await this.players.findByWalletForUpdate(wallet, tx);
      if (!player) throw new NotFoundError('ride not found');
      const ride = await this.lookup.require(rideId, wallet, tx);
      if (!ride.isInStatus(RideStatus.Created)) throw new ConflictError(`ride is ${ride.status}`); // its own precondition first: unpaid, running, ended…
      if (trip !== null && trip !== tripOrClassic(ride.trip)) throw new ConflictError(`the ride was re-chosen: it is driven on ${tripOrClassic(ride.trip)} now, not ${trip} – load it again`, 'ride_rechosen'); // before anything is saved
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
      if (!ride.isFree && !ride.isPromo && !ride.isWeeklyGrant) player.requirePaidPlay(); // training, a promo, and the weekly grant were not bought
      if (ride.poolId !== null) {   // a ticket ride starts only while a shift started now ends by its pool's play deadline (H6) – the pool row is read, not locked: its deadline comes from chain and never changes
        const pool = await this.pools.findById(ride.poolId, tx);
        if (pool && !pool.canFinishBy(now, ride.completeDist / MAX_SPEED)) {   // ordered in time (the spend checked the whole shift): it starts while its finish line is still reachable
          ride.closeRidesClosed(now, pool.playDeadline);
          await this.rides.save(ride, tx);
          await this.stats.recordRide(ride.snapshot(), tx);   // every path that ends a ride (a ride that never started adds nothing)
          return { closed: pool.playDeadline, failed } as const;
        }
      }
      const stamp = ranked ? await this.rankedEntry.claim(player, ride, headers, now, tx) : null;   // 409 leaves the ride created, so the driver can start it unranked
      const wardrobe = toWardrobeDto(await this.cosmetics.listUnlocked(wallet, tx), await this.cosmetics.listEquipped(wallet, tx));
      ride.start(now, wardrobe.equipped, this.rules.get().trafficProofRequired === false ? 0 : 1, stamp);   // what is worn right now (owned items only) goes with the ride: live streams and replays draw it
      const saved = await this.rides.save(ride, tx);
      if (ride.tutorial && player.markTutorialPassed(now)) await this.players.save(player, tx);   // starting a ride with the tutorial on = it was done: the lobby leaves it off from now on
      return { dto: toRideDto(saved), started: saved.snapshot(), failed } satisfies StartFacts;
    });
    if ('closed' in facts && facts.closed) {
      if (facts.failed) { await this.stats.invalidate(wallet); const failedRide = facts.failed; emitAnalytics(this.analytics, () => rideFailed(failedRide, isDemoWallet(this.rules.get(), wallet), 'stale_on_start')); }
      throw new ConflictError(`rides for this ride's pool closed: a shift started now would end after its play deadline (${facts.closed.toISOString()}) – the ride is closed, its ticket stays in the pot`, 'rides_closed');   // after the commit: the closed ride stays closed
    }
    const demo = (): boolean => isDemoWallet(this.rules.get(), wallet);
    if (facts.failed) await this.stats.invalidate(wallet);
    if (facts.failed) { const failed = facts.failed; emitAnalytics(this.analytics, () => rideFailed(failed, demo(), 'stale_on_start')); }
    emitAnalytics(this.analytics, () => rideStarted(facts.started, demo()));
    return facts.dto;
  }
}
