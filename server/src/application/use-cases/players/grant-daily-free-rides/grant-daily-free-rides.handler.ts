import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { utcDay } from '../../../../domain/shared/time.js';
import { PlayerRepositoryPort } from '../../../ports/players/player.repository.port.js';
import { ClockPort } from '../../../ports/shared/clock.port.js';
import { GrantDailyFreeRidesCommand, type GrantDailyFreeRidesResultDto } from './grant-daily-free-rides.command.js';

/** The midnight job: +1 free ride for every player (up to their own cap). Safe to run any number of times a day or from several instances – a player gets a day's credit once. */
@CommandHandler(GrantDailyFreeRidesCommand)
export class GrantDailyFreeRidesHandler implements ICommandHandler<GrantDailyFreeRidesCommand, GrantDailyFreeRidesResultDto> {
  constructor(
    private readonly players: PlayerRepositoryPort,
    private readonly clock: ClockPort,
  ) {}

  async execute(): Promise<GrantDailyFreeRidesResultDto> {
    const day = utcDay(this.clock.now());
    return { day, players: await this.players.grantDailyFreeRides(day) };
  }
}
