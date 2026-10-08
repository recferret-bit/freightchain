import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { toPromoDto, type PromoDto } from '../../../../domain/economy/promo.dto.js';
import { AdminActionRepositoryPort } from '../../../ports/admin/admin-action.repository.port.js';
import { ClockPort } from '../../../ports/shared/clock.port.js';
import { TransactionPort } from '../../../ports/shared/transaction.port.js';
import { AdminProofService } from '../../../services/admin-proof.service.js';
import { PromoCreationService } from '../../../services/promo-creation.service.js';
import { CreateAdminPromoCommand } from './create-admin-promo.command.js';

/** A new promo code from the admin page – signed by the admin's wallet for exactly this code; the code and its audit row (with the signed text) are written in ONE transaction. */
@CommandHandler(CreateAdminPromoCommand)
export class CreateAdminPromoHandler implements ICommandHandler<CreateAdminPromoCommand, PromoDto> {
  constructor(
    private readonly creation: PromoCreationService,
    private readonly proofs: AdminProofService,
    private readonly audit: AdminActionRepositoryPort,
    private readonly transactions: TransactionPort,
    private readonly clock: ClockPort,
  ) {}

  async execute({ admin, input, requestId, signature }: CreateAdminPromoCommand): Promise<PromoDto> {
    const proof = await this.proofs.prove(admin, { action: 'promo_create', promo: input }, signature);
    return this.transactions.run(async (tx) => {
      const promo = await this.creation.create(input, tx);
      const now = this.clock.now();
      await this.audit.insert({ wallet: admin, action: 'promo.create', target: promo.code, detail: { effect: promo.effect, signed: proof }, requestId, at: now }, tx);
      return toPromoDto(promo, now);
    });
  }
}
