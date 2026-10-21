import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { toPromoDto, type PromoDto } from '../../../../domain/economy/promo.dto.js';
import { AdminActionRepositoryPort } from '../../../ports/admin/admin-action.repository.port.js';
import { AnalyticsPort } from '../../../ports/analytics/analytics.port.js';
import { ClockPort } from '../../../ports/shared/clock.port.js';
import { emitAnalytics } from '../../../services/analytics-emit.js';
import { promoCreated } from '../../../services/analytics-events.js';
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
    private readonly analytics: AnalyticsPort,
  ) {}

  async execute({ admin, input, requestId, signature }: CreateAdminPromoCommand): Promise<PromoDto> {
    const proof = await this.proofs.prove(admin, { action: 'promo_create', promo: input }, signature);
    const created = await this.transactions.run(async (tx) => {
      const promo = await this.creation.create(input, tx);
      const now = this.clock.now();
      await this.audit.insert({
        wallet: admin, action: 'promo.create', target: promo.code, role: 'admin',
        beforeState: null, afterState: { code: promo.code, effect: promo.effect },
        detail: { effect: promo.effect, signed: proof }, requestId, at: now,
      }, tx);
      return { dto: toPromoDto(promo, now), snapshot: promo.snapshot(), now };
    });
    const { snapshot: s } = created;
    emitAnalytics(this.analytics, () => promoCreated({ code: s.code, effect: s.effect, maxRedemptions: s.maxRedemptions, perWallet: s.perWallet, startsAt: s.startsAt, expiresAt: s.expiresAt, now: created.now }));
    return created.dto;
  }
}
