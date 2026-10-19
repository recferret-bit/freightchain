import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { PromoCode } from '../../../../domain/economy/promo-code.entity.js';
import { toPromoDto, type PromoDto } from '../../../../domain/economy/promo.dto.js';
import { NotFoundError } from '../../../../domain/shared/errors.js';
import { AdminActionRepositoryPort } from '../../../ports/admin/admin-action.repository.port.js';
import { PromoRepositoryPort } from '../../../ports/economy/promo.repository.port.js';
import { AnalyticsPort } from '../../../ports/analytics/analytics.port.js';
import { ClockPort } from '../../../ports/shared/clock.port.js';
import { emitAnalytics } from '../../../services/analytics-emit.js';
import { promoDisabled } from '../../../services/analytics-events.js';
import { TransactionPort } from '../../../ports/shared/transaction.port.js';
import { AdminProofService } from '../../../services/admin-proof.service.js';
import { DisableAdminPromoCommand } from './disable-admin-promo.command.js';

/** Stop a code from the admin page. What it already granted stays; disabling twice keeps the first date (and is audited again). */
@CommandHandler(DisableAdminPromoCommand)
export class DisableAdminPromoHandler implements ICommandHandler<DisableAdminPromoCommand, PromoDto> {
  constructor(
    private readonly promos: PromoRepositoryPort,
    private readonly proofs: AdminProofService,
    private readonly audit: AdminActionRepositoryPort,
    private readonly transactions: TransactionPort,
    private readonly clock: ClockPort,
    private readonly analytics: AnalyticsPort,
  ) {}

  async execute({ admin, code: typed, requestId, signature }: DisableAdminPromoCommand): Promise<PromoDto> {
    const code = PromoCode.normalize(typed);
    const proof = await this.proofs.prove(admin, { action: 'promo_disable', code }, signature);
    const done = await this.transactions.run(async (tx) => {
      const now = this.clock.now();
      if (!(await this.promos.disable(code, now, tx))) throw new NotFoundError('no such promo code');
      await this.audit.insert({ wallet: admin, action: 'promo.disable', target: code, detail: { signed: proof }, requestId, at: now }, tx);
      return { dto: toPromoDto((await this.promos.findByCode(code, tx)) as PromoCode, now), now };
    });
    emitAnalytics(this.analytics, () => promoDisabled(code, done.dto.effect.kind, done.dto.redeemed, done.now));
    return done.dto;
  }
}
