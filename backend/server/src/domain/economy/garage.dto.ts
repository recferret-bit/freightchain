import { COSMETIC_ITEMS, COSMETIC_SLOTS, defaultCosmetic, unlockableCount, type CosmeticSlot, type Loadout } from './cosmetics.js';
import { toWardrobeDto } from './wardrobe.dto.js';

/** One part of the catalog as a player sees it in the Garage. `unlockedAt` / `code` say how an owned part was earned (null for the default everybody has). */
export interface GaragePartDto {
  id: string;
  isDefault: boolean;
  owned: boolean;
  worn: boolean;
  unlockedAt: number | null;
  code: string | null;
  name: string;
  description: string;
  /** Decimal TEN4. Null for a slot default, and when the catalog copy has no row for this part. */
  price: string | null;
}

export interface GarageSlotDto {
  slot: CosmeticSlot;
  parts: GaragePartDto[];
  /** unlockable parts of this slot the wallet owns / that exist (defaults are not counted: everybody has them) */
  collected: number;
  total: number;
}

/** The Garage: the whole catalog, what is owned and worn, and the collection progress. */
export interface GarageDto {
  equipped: Loadout;
  slots: GarageSlotDto[];
  progress: { collected: number; total: number; percent: number };
}

export interface UnlockInfo { slot: CosmeticSlot; item: string; code: string; at: Date }

export function toGarageDto(unlocked: readonly UnlockInfo[], worn: Partial<Record<CosmeticSlot, string>>, copy?: ReadonlyMap<string, { name: string; description: string; price: string | null }>): GarageDto {
  const { equipped } = toWardrobeDto(unlocked, worn);
  const slots = COSMETIC_SLOTS.map((slot): GarageSlotDto => {
    const parts = COSMETIC_ITEMS[slot].map((id): GaragePartDto => {
      const u = unlocked.find((x) => x.slot === slot && x.item === id);
      const isDefault = id === defaultCosmetic(slot);
      const meta = copy?.get(`${slot}:${id}`);
      return { id, isDefault, owned: isDefault || !!u, worn: equipped[slot] === id, unlockedAt: u?.at.getTime() ?? null, code: u?.code ?? null, name: meta?.name ?? id, description: meta?.description ?? '', price: meta?.price ?? null };
    });
    return { slot, parts, collected: parts.filter((p) => !p.isDefault && p.owned).length, total: unlockableCount(slot) };
  });
  const collected = slots.reduce((n, s) => n + s.collected, 0), total = slots.reduce((n, s) => n + s.total, 0);
  return { equipped, slots, progress: { collected, total, percent: total === 0 ? 0 : Math.floor((collected * 100) / total) } };
}
