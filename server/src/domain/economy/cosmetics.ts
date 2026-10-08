/* The cosmetics catalog: what a promo code can unlock and a player can wear. VISUALS ONLY – no item changes handling, shifting or any rule of the game.
   Today there is ONE slot, `cabin`: a colour scheme for the whole inside of the cab (cab interior, hood and fenders, dashboard, steering wheel, shifter). Later an
   NFT will replace / extend these items – the slot model stays so more slots (or items from a collection) can be added without touching the plumbing.
   Mirrored by client/js/cosmetics.js (a leaf module: the landing's dash cards run the cockpit without three.js) – keep the ids and defaults equal;
   test/unit/domain/economy/cosmetics.spec.ts reads that file and fails on drift. To add an item: append it here AND in the client module and give it a palette
   in LOOKS there. The first item of a slot is its default: everybody owns it, no code gives it. */
export const COSMETIC_SLOTS = ['cabin'] as const;
export type CosmeticSlot = (typeof COSMETIC_SLOTS)[number];

export const COSMETIC_ITEMS: Readonly<Record<CosmeticSlot, readonly string[]>> = {
  /** the cab: classic (today's cab), midnight (blue), forest (green), sunset (orange), arctic (ice white), noir (black and gold) */
  cabin: ['classic', 'midnight', 'forest', 'sunset', 'arctic', 'noir'],
};

export const isCosmeticSlot = (v: unknown): v is CosmeticSlot => typeof v === 'string' && (COSMETIC_SLOTS as readonly string[]).includes(v);
export const isCosmeticItem = (slot: CosmeticSlot, item: unknown): boolean => typeof item === 'string' && COSMETIC_ITEMS[slot].includes(item);
export const defaultCosmetic = (slot: CosmeticSlot): string => COSMETIC_ITEMS[slot][0] as string;
/** Items a code may unlock: everything but the default. */
export const isUnlockableCosmetic = (slot: CosmeticSlot, item: unknown): boolean => isCosmeticItem(slot, item) && item !== defaultCosmetic(slot);

/** What a wallet wears, every slot always set. */
export type Loadout = Record<CosmeticSlot, string>;
export const defaultLoadout = (): Loadout => ({ cabin: defaultCosmetic('cabin') });
