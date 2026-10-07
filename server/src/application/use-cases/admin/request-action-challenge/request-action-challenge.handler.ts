import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { AdminProofService } from '../../../services/admin-proof.service.js';
import type { ChallengeDto } from '../../auth/request-challenge/request-challenge.command.js';
import { RequestActionChallengeCommand } from './request-action-challenge.command.js';

/** Step 1 of a signed admin change: the server's text describing it, for the admin's wallet to sign (5 minutes, single use, one pending per admin). */
@CommandHandler(RequestActionChallengeCommand)
export class RequestActionChallengeHandler implements ICommandHandler<RequestActionChallengeCommand, ChallengeDto> {
  constructor(private readonly proofs: AdminProofService) {}

  async execute({ admin, intent }: RequestActionChallengeCommand): Promise<ChallengeDto> {
    return { message: await this.proofs.issue(admin, intent) };
  }
}
