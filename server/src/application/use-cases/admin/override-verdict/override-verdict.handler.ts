import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import type { VerdictDto } from '../../../../domain/verdict/verdict.dto.js';
import { VerdictService } from '../../../services/verdict.service.js';
import { OverrideVerdictCommand } from './override-verdict.command.js';

/** Accept (verified) or reject a ride from the review queue. Audited; later re-judging leaves the decision alone. */
@CommandHandler(OverrideVerdictCommand)
export class OverrideVerdictHandler implements ICommandHandler<OverrideVerdictCommand, VerdictDto> {
  constructor(private readonly verdicts: VerdictService) {}

  async execute({ admin, rideId, decision, note, requestId }: OverrideVerdictCommand): Promise<VerdictDto> {
    return (await this.verdicts.override(rideId, decision, admin, note, requestId)).toDto();
  }
}
