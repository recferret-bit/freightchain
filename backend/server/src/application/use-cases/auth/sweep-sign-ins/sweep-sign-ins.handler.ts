import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { DAY_MS } from '../../../../domain/shared/time.js';
import { SignInRepositoryPort } from '../../../ports/auth/sign-in.repository.port.js';
import { RulesConfigPort } from '../../../ports/config/rules-config.port.js';
import { ClockPort } from '../../../ports/shared/clock.port.js';
import { SweepSignInsCommand, type SweepSignInsResultDto } from './sweep-sign-ins.command.js';

/** Delete pseudonymous player sign-ins after at most 90 days; runs at 00:30 UTC. */
@CommandHandler(SweepSignInsCommand)
export class SweepSignInsHandler implements ICommandHandler<SweepSignInsCommand, SweepSignInsResultDto> {
  constructor(
    private readonly signIns: SignInRepositoryPort,
    private readonly rules: RulesConfigPort,
    private readonly clock: ClockPort,
  ) {}

  async execute(): Promise<SweepSignInsResultDto> {
    const configured = this.rules.get().signInRetentionDays;
    const days = configured > 0 ? Math.min(configured, 90) : 90;
    const cutoff = new Date(this.clock.now().getTime() - days * DAY_MS);
    return { cutoff: cutoff.getTime(), deleted: await this.signIns.deleteBefore(cutoff) };
  }
}
