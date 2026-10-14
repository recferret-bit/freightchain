import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { COSMETIC_SLOTS, defaultCosmetic, isCosmeticItem } from '../../../../domain/economy/cosmetics.js';
import { toGarageDto, type GarageDto } from '../../../../domain/economy/garage.dto.js';
import { formatHonk } from '../../../../domain/honk/tokenomics.js';
import type { HonkPartSeed } from '../../../../domain/honk/parts-catalog.js';
import { BadRequestError, ConflictError, NotFoundError } from '../../../../domain/shared/errors.js';
import { AnalyticsPort } from '../../../ports/analytics/analytics.port.js';
import { HonkRepositoryPort } from '../../../ports/honk/honk.repository.port.js';
import { PlayerRepositoryPort } from '../../../ports/players/player.repository.port.js';
import { CosmeticRepositoryPort } from '../../../ports/players/cosmetic.repository.port.js';
import { ClockPort } from '../../../ports/shared/clock.port.js';
import { TransactionPort } from '../../../ports/shared/transaction.port.js';
import { emitAnalytics } from '../../../services/analytics-emit.js';
import { garageSaved } from '../../../services/analytics-events.js';
import { SaveGarageCommand } from './save-garage.command.js';

const catalogCopy = (parts: readonly HonkPartSeed[]) => new Map(parts.map((p) => [`${p.slot}:${p.item}`, { name: p.name, description: p.description, price: p.price === null ? null : formatHonk(p.price) }]));

/**
 * Saves the player's selection in the Garage into the database (`player.CosmeticEquip`): every part must exist and be owned (a slot's default always is) – checked for ALL
 * of them before anything is written, and the writes share one transaction, so a refused part changes nothing. The next ride is started with this loadout.
 */
@CommandHandler(SaveGarageCommand)
export class SaveGarageHandler implements ICommandHandler<SaveGarageCommand, GarageDto> {
  constructor(
    private readonly cosmetics: CosmeticRepositoryPort,
    private readonly players: PlayerRepositoryPort,
    private readonly transactions: TransactionPort,
    private readonly clock: ClockPort,
    private readonly analytics: AnalyticsPort,
    private readonly honk: HonkRepositoryPort,
  ) {}

  async execute({ wallet, parts }: SaveGarageCommand): Promise<GarageDto> {
    const picks = COSMETIC_SLOTS.flatMap((slot) => (parts[slot] === undefined ? [] : [[slot, parts[slot] as string] as const]));
    if (picks.length === 0) throw new BadRequestError('pick at least one part', 'bad_cosmetic');
    const copy = catalogCopy(await this.honk.listParts());
    const saved = await this.transactions.run(async (tx) => {
      if (!(await this.players.findByWalletForUpdate(wallet, tx))) throw new NotFoundError('player not found');   // the player row lock, like every wallet change
      const unlocked = await this.cosmetics.listUnlocked(wallet, tx);
      for (const [slot, item] of picks) {
        if (!isCosmeticItem(slot, item)) throw new BadRequestError(`no such ${slot}: ${item}`, 'bad_cosmetic');
        if (item !== defaultCosmetic(slot) && !unlocked.some((u) => u.slot === slot && u.item === item)) throw new ConflictError(`you do not own ${slot}: ${item} – burn HONK in the garage to mint it`, 'not_owned');
      }
      for (const [slot, item] of picks) await this.cosmetics.equip(wallet, slot, item, tx);
      return toGarageDto(unlocked, await this.cosmetics.listEquipped(wallet, tx), copy);
    });
    emitAnalytics(this.analytics, () => garageSaved(wallet, saved.equipped, picks.length, this.clock.now()));
    return saved;
  }
}
