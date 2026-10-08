import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { PromoCode } from '../../../../domain/economy/promo-code.entity.js';
import { ClockPort } from '../../../ports/shared/clock.port.js';
import { AdminProofService } from '../../../services/admin-proof.service.js';
import type { ChallengeDto } from '../../auth/request-challenge/request-challenge.command.js';
import { RequestActionChallengeCommand } from './request-action-challenge.command.js';

/** Step 1 of a signed admin change: the server's text describing it, for the admin's wallet to sign (5 minutes, single use, one pending per admin). */
@CommandHandler(RequestActionChallengeCommand)
export class RequestActionChallengeHandler implements ICommandHandler<RequestActionChallengeCommand, ChallengeDto> {
  constructor(
    private readonly proofs: AdminProofService,
    private readonly clock: ClockPort,
  ) {}

  async execute({ admin, intent }: RequestActionChallengeCommand): Promise<ChallengeDto> {
    if (intent.action === 'promo_create') PromoCode.create({ ...intent.promo, now: this.clock.now() });   // a code the entity would refuse (a long description, an end in the past, a default item) is a 400 NOW, not after the single-use signature is spent
    return { message: await this.proofs.issue(admin, intent) };
  }
}
