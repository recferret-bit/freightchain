import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import type { VerdictDto } from '../../../../domain/verdict/verdict.dto.js';
import { AdminProofService } from '../../../services/admin-proof.service.js';
import { VerdictService } from '../../../services/verdict.service.js';
import { OverrideVerdictCommand } from './override-verdict.command.js';

/** Accept (verified) or reject a ride from the review queue – signed by the admin's wallet for exactly this decision. Audited with the signed text; later re-judging leaves the decision alone. */
@CommandHandler(OverrideVerdictCommand)
export class OverrideVerdictHandler implements ICommandHandler<OverrideVerdictCommand, VerdictDto> {
  constructor(
    private readonly verdicts: VerdictService,
    private readonly proofs: AdminProofService,
  ) {}

  async execute({ admin, rideId, decision, note, requestId, signature }: OverrideVerdictCommand): Promise<VerdictDto> {
    const proof = await this.proofs.prove(admin, { action: 'override', rideId, decision, note }, signature);
    return (await this.verdicts.override(rideId, decision, admin, note, requestId, proof)).toDto();
  }
}
