import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import type { VerdictDto } from '../../../../domain/verdict/verdict.dto.js';
import { AdminProofService } from '../../../services/admin-proof.service.js';
import { VerdictService } from '../../../services/verdict.service.js';
import { RejudgeRideCommand } from './rejudge-ride.command.js';

/** Run the checks again for one completed ride at the current rules (after tuning, or when judging failed after /end). Replaces an admin decision too.
 *  Signed by the admin's wallet for exactly this ride; audited with the signed text. */
@CommandHandler(RejudgeRideCommand)
export class RejudgeRideHandler implements ICommandHandler<RejudgeRideCommand, VerdictDto> {
  constructor(
    private readonly verdicts: VerdictService,
    private readonly proofs: AdminProofService,
  ) {}

  async execute({ admin, rideId, requestId, signature }: RejudgeRideCommand): Promise<VerdictDto> {
    const proof = await this.proofs.prove(admin, { action: 'rejudge', rideId }, signature);
    return (await this.verdicts.rejudge(rideId, admin, requestId, proof)).toDto();
  }
}
