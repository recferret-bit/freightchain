import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { COSMETIC_SLOTS, defaultCosmetic, isCosmeticItem } from '../../../../domain/economy/cosmetics.js';
import { toGarageDto, type GarageDto } from '../../../../domain/economy/garage.dto.js';
import { BadRequestError, ConflictError } from '../../../../domain/shared/errors.js';
import { AnalyticsPort } from '../../../ports/analytics/analytics.port.js';
import { CosmeticRepositoryPort } from '../../../ports/players/cosmetic.repository.port.js';
import { ClockPort } from '../../../ports/shared/clock.port.js';
import { TransactionPort } from '../../../ports/shared/transaction.port.js';
import { emitAnalytics } from '../../../services/analytics-emit.js';
import { garageSaved } from '../../../services/analytics-events.js';
import { SaveGarageCommand } from './save-garage.command.js';

/**
 * Saves the player's selection in the Garage into the database (`player.CosmeticEquip`): every part must exist and be owned (a slot's default always is) – checked for ALL
 * of them before anything is written, and the writes share one transaction, so a refused part changes nothing. The next ride is started with this loadout.
 */
@CommandHandler(SaveGarageCommand)
export class SaveGarageHandler implements ICommandHandler<SaveGarageCommand, GarageDto> {
  constructor(
    private readonly cosmetics: CosmeticRepositoryPort,
    private readonly transactions: TransactionPort,
    private readonly clock: ClockPort,
    private readonly analytics: AnalyticsPort,
  ) {}

  async execute({ wallet, parts }: SaveGarageCommand): Promise<GarageDto> {
    const picks = COSMETIC_SLOTS.flatMap((slot) => (parts[slot] === undefined ? [] : [[slot, parts[slot] as string] as const]));
    if (picks.length === 0) throw new BadRequestError('pick at least one part', 'bad_cosmetic');
    const saved = await this.transactions.run(async (tx) => {
      const unlocked = await this.cosmetics.listUnlocked(wallet, tx);
      for (const [slot, item] of picks) {
        if (!isCosmeticItem(slot, item)) throw new BadRequestError(`no such ${slot}: ${item}`, 'bad_cosmetic');
        if (item !== defaultCosmetic(slot) && !unlocked.some((u) => u.slot === slot && u.item === item)) throw new ConflictError(`you do not own ${slot}: ${item} – redeem a promo code for it`, 'not_owned');
      }
      for (const [slot, item] of picks) await this.cosmetics.equip(wallet, slot, item, tx);
      return toGarageDto(unlocked, await this.cosmetics.listEquipped(wallet, tx));
    });
    emitAnalytics(this.analytics, () => garageSaved(wallet, saved.equipped, picks.length, this.clock.now()));
    return saved;
  }
}
