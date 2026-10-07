import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import type { VerdictDto } from '../../../../domain/verdict/verdict.dto.js';
import { VerdictService } from '../../../services/verdict.service.js';
import { RejudgeRideCommand } from './rejudge-ride.command.js';

/** Run the checks again for one completed ride at the current rules (after tuning, or when judging failed after /end). Replaces an admin decision too. Audited. */
@CommandHandler(RejudgeRideCommand)
export class RejudgeRideHandler implements ICommandHandler<RejudgeRideCommand, VerdictDto> {
  constructor(private readonly verdicts: VerdictService) {}

  async execute({ admin, rideId, requestId }: RejudgeRideCommand): Promise<VerdictDto> {
    return (await this.verdicts.rejudge(rideId, admin, requestId)).toDto();
  }
}
