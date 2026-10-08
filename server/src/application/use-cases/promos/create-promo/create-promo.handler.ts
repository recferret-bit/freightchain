import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { toPromoDto, type PromoDto } from '../../../../domain/economy/promo.dto.js';
import { ClockPort } from '../../../ports/shared/clock.port.js';
import { PromoCreationService } from '../../../services/promo-creation.service.js';
import { CreatePromoCommand } from './create-promo.command.js';

/** Admin (CLI): a new promo code (the admin page's signed twin is `CreateAdminPromoCommand`). */
@CommandHandler(CreatePromoCommand)
export class CreatePromoHandler implements ICommandHandler<CreatePromoCommand, PromoDto> {
  constructor(
    private readonly creation: PromoCreationService,
    private readonly clock: ClockPort,
  ) {}

  async execute({ input }: CreatePromoCommand): Promise<PromoDto> {
    return toPromoDto(await this.creation.create(input), this.clock.now());
  }
}
