import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { PromoCode } from '../../../../domain/economy/promo-code.entity.js';
import { toPromoDto } from '../../../../domain/economy/promo.dto.js';
import { NotFoundError } from '../../../../domain/shared/errors.js';
import { PromoRepositoryPort } from '../../../ports/economy/promo.repository.port.js';
import { ClockPort } from '../../../ports/shared/clock.port.js';
import { DisablePromoCommand, type PromoDisabledDto } from './disable-promo.command.js';

/** Admin (CLI): stop a code. Tickets, rides and cosmetics already granted stay; disabling twice keeps the first date. */
@CommandHandler(DisablePromoCommand)
export class DisablePromoHandler implements ICommandHandler<DisablePromoCommand, PromoDisabledDto> {
  constructor(
    private readonly promos: PromoRepositoryPort,
    private readonly clock: ClockPort,
  ) {}

  async execute({ code: typed }: DisablePromoCommand): Promise<PromoDisabledDto> {
    const code = PromoCode.normalize(typed);
    const now = this.clock.now();
    if (!(await this.promos.disable(code, now))) throw new NotFoundError('no such promo code');
    return toPromoDto((await this.promos.findByCode(code)) as PromoCode, now);
  }
}
