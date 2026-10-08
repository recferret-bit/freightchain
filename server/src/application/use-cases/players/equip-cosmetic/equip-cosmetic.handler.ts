import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { defaultCosmetic, isCosmeticItem } from '../../../../domain/economy/cosmetics.js';
import { toWardrobeDto, type WardrobeDto } from '../../../../domain/economy/wardrobe.dto.js';
import { BadRequestError, ConflictError } from '../../../../domain/shared/errors.js';
import { AnalyticsPort } from '../../../ports/analytics/analytics.port.js';
import { ClockPort } from '../../../ports/shared/clock.port.js';
import { emitAnalytics } from '../../../services/analytics-emit.js';
import { cosmeticEquipped } from '../../../services/analytics-events.js';
import { CosmeticRepositoryPort } from '../../../ports/players/cosmetic.repository.port.js';
import { EquipCosmeticCommand } from './equip-cosmetic.command.js';

@CommandHandler(EquipCosmeticCommand)
export class EquipCosmeticHandler implements ICommandHandler<EquipCosmeticCommand, WardrobeDto> {
  constructor(
    private readonly cosmetics: CosmeticRepositoryPort,
    private readonly clock: ClockPort,
    private readonly analytics: AnalyticsPort,
  ) {}

  async execute({ wallet, slot, item }: EquipCosmeticCommand): Promise<WardrobeDto> {
    if (!isCosmeticItem(slot, item)) throw new BadRequestError(`no such ${slot}: ${item}`, 'bad_cosmetic');
    if (item !== defaultCosmetic(slot) && !(await this.cosmetics.has(wallet, slot, item))) throw new ConflictError('you do not own this item – redeem a promo code for it', 'not_owned');
    await this.cosmetics.equip(wallet, slot, item);
    emitAnalytics(this.analytics, () => cosmeticEquipped(wallet, slot, item, item === defaultCosmetic(slot), this.clock.now()));
    return toWardrobeDto(await this.cosmetics.listUnlocked(wallet), await this.cosmetics.listEquipped(wallet));
  }
}
