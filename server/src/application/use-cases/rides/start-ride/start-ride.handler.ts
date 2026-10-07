import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { toRideDto, type RideDto } from '../../../../domain/rides/ride.dto.js';
import { RideStatus } from '../../../../domain/rides/ride-status.js';
import { ConflictError, NotFoundError } from '../../../../domain/shared/errors.js';
import { RulesConfigPort } from '../../../ports/config/rules-config.port.js';
import { PlayerRepositoryPort } from '../../../ports/players/player.repository.port.js';
import { RideRepositoryPort } from '../../../ports/rides/ride.repository.port.js';
import { ClockPort } from '../../../ports/shared/clock.port.js';
import { TransactionPort } from '../../../ports/shared/transaction.port.js';
import { RideLookupService } from '../../../services/ride-lookup.service.js';
import { StartRideCommand } from './start-ride.command.js';

/**
 * The game page pressed START: the server clock for this ride starts now. Under the wallet's row lock, so at most ONE ride per wallet runs at a time
 * (a wallet can own two PAID ready rides when a late payment lands – both are owed, but they run one after the other). A ride that is not "created" is a 409.
 */
@CommandHandler(StartRideCommand)
export class StartRideHandler implements ICommandHandler<StartRideCommand, RideDto> {
  constructor(
    private readonly lookup: RideLookupService,
    private readonly rides: RideRepositoryPort,
    private readonly players: PlayerRepositoryPort,
    private readonly rules: RulesConfigPort,
    private readonly transactions: TransactionPort,
    private readonly clock: ClockPort,
  ) {}

  execute({ wallet, rideId }: StartRideCommand): Promise<RideDto> {
    return this.transactions.run(async (tx) => {
      const now = this.clock.now();
      if (!(await this.players.findByWalletForUpdate(wallet, tx))) throw new NotFoundError('ride not found');
      const ride = await this.lookup.require(rideId, wallet, tx);
      if (!ride.isInStatus(RideStatus.Created)) throw new ConflictError(`ride is ${ride.status}`); // its own precondition first: unpaid, running, ended…
      const running = (await this.rides.listOpenByWallet(wallet, tx)).find((r) => r.id !== ride.id && r.isInStatus(RideStatus.Running));
      if (running?.isStaleRunning(now, this.rules.get())) { // a tab that vanished mid-ride must not block the next one
        running.failHeartbeatLost(now);
        await this.rides.save(running, tx);
      } else if (running) {
        throw new ConflictError('another ride is in progress');
      }
      ride.start(now);
      return toRideDto(await this.rides.save(ride, tx));
    });
  }
}
