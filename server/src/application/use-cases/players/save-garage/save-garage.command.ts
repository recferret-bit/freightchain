import type { CosmeticSlot } from '../../../../domain/economy/cosmetics.js';

/** SAVE in the Garage: the parts the wallet picked, any subset of the slots, applied together or not at all. */
export class SaveGarageCommand {
  constructor(
    public readonly wallet: string,
    public readonly parts: Partial<Record<CosmeticSlot, string>>,
  ) {}
}
