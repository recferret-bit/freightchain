import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { RideStatus } from '../../../../domain/rides/ride-status.js';
import { toRideEventDto, type RideEventDto } from '../../../../domain/live/live.dto.js';
import { ConflictError, NotFoundError } from '../../../../domain/shared/errors.js';
import { RideEventRepositoryPort } from '../../../ports/live/ride-event.repository.port.js';
import { PlayerRepositoryPort } from '../../../ports/players/player.repository.port.js';
import { ClockPort } from '../../../ports/shared/clock.port.js';
import { TransactionPort } from '../../../ports/shared/transaction.port.js';
import { RideLookupService } from '../../../services/ride-lookup.service.js';
import { AckEffectCommand } from './ack-effect.command.js';

/**
 * The stamp spectators replay effects from. Only the ride's owner, only while it runs, under the owner's player row lock (the usual order: player → the
 * ride read → the event row); the first stamp wins, a re-sent ack returns the stored one unchanged.
 */
@CommandHandler(AckEffectCommand)
export class AckEffectHandler implements ICommandHandler<AckEffectCommand, RideEventDto> {
  constructor(
    private readonly lookup: RideLookupService,
    private readonly events: RideEventRepositoryPort,
    private readonly players: PlayerRepositoryPort,
    private readonly transactions: TransactionPort,
    private readonly clock: ClockPort,
  ) {}

  execute({ wallet, rideId, eventId, report }: AckEffectCommand): Promise<RideEventDto> {
    return this.transactions.run(async (tx) => {
      await this.players.findByWalletForUpdate(wallet, tx);
      const ride = await this.lookup.require(rideId, wallet, tx);
      const event = await this.events.findById(eventId, tx);
      if (!event || event.rideId !== ride.id) throw new NotFoundError('event not found');
      if (event.applied) return toRideEventDto(event);
      if (!ride.isInStatus(RideStatus.Running)) throw new ConflictError(`ride is ${ride.status}`);
      if (event.markApplied(report, this.clock.now()) && !(await this.events.saveApplied(event, tx))) {
        const stored = await this.events.findById(eventId, tx); // a parallel ack won: answer with its stamp
        if (stored) return toRideEventDto(stored);
      }
      return toRideEventDto(event);
    });
  }
}
