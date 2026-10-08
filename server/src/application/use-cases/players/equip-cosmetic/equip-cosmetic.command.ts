import type { CosmeticSlot } from '../../../../domain/economy/cosmetics.js';

/** Wear an item in a slot – the wallet must own it (a slot's default is everybody's). */
export class EquipCosmeticCommand {
  constructor(
    public readonly wallet: string,
    public readonly slot: CosmeticSlot,
    public readonly item: string,
  ) {}
}
