import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { utcDay } from '../../../../domain/shared/time.js';
import { ClockPort } from '../../../ports/shared/clock.port.js';
import { GrantDailyFreeRidesCommand, type GrantDailyFreeRidesResultDto } from './grant-daily-free-rides.command.js';

/** Retired. Training rides are unlimited, so this command grants nobody. The columns and the old rows stay. */
@CommandHandler(GrantDailyFreeRidesCommand)
export class GrantDailyFreeRidesHandler implements ICommandHandler<GrantDailyFreeRidesCommand, GrantDailyFreeRidesResultDto> {
  constructor(private readonly clock: ClockPort) {}

  async execute(): Promise<GrantDailyFreeRidesResultDto> {
    return { day: utcDay(this.clock.now()), players: 0 };
  }
}
