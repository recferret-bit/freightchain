import { COSMETIC_SLOTS, defaultCosmetic, type CosmeticSlot, type Loadout } from './cosmetics.js';

/** What a wallet owns and wears. Every slot is always set; `unlocked[slot]` lists the slot's default first, then what codes unlocked (in the order they were). */
export interface WardrobeDto {
  equipped: Loadout;
  unlocked: Record<CosmeticSlot, string[]>;
}

export function toWardrobeDto(unlocked: readonly { slot: CosmeticSlot; item: string }[], worn: Partial<Record<CosmeticSlot, string>>): WardrobeDto {
  const owned = Object.fromEntries(COSMETIC_SLOTS.map((slot) => [slot, [defaultCosmetic(slot), ...unlocked.filter((u) => u.slot === slot).map((u) => u.item)]])) as Record<CosmeticSlot, string[]>;
  const equipped = Object.fromEntries(COSMETIC_SLOTS.map((slot) => {
    const w = worn[slot];
    return [slot, w !== undefined && owned[slot].includes(w) ? w : defaultCosmetic(slot)];
  })) as Loadout;
  return { equipped, unlocked: owned };
}
