/* The cosmetics catalog: what a promo code can unlock and a player can equip. VISUALS ONLY – no item changes handling, shifting or any rule of the game.
   Mirrored by client/js/cosmetics.js (a leaf module: the landing's dash cards run the cockpit without three.js) – keep the ids and defaults equal;
   test/unit/domain/cosmetics.spec.ts reads that file and fails on drift. To add an item: append it here AND in the client module, then draw it in the
   cockpit (steering wheel / hood / shifter live in client/js/cockpit/rig.js). The first item of a slot is its default: everybody owns it, no code gives it. */
export const COSMETIC_SLOTS = ['wheel', 'truck_color', 'gearbox'] as const;
export type CosmeticSlot = (typeof COSMETIC_SLOTS)[number];

export const COSMETIC_ITEMS: Readonly<Record<CosmeticSlot, readonly string[]>> = {
  /** the steering wheel: rim, spokes, hub */
  wheel: ['classic', 'sport', 'wood', 'gold'],
  /** the hood and fender paint */
  truck_color: ['red', 'blue', 'green', 'black', 'yellow'],
  /** the floor shifter: knob and boot */
  gearbox: ['stick', 'chrome', 'wood', 'racing'],
};

export const isCosmeticSlot = (v: unknown): v is CosmeticSlot => typeof v === 'string' && (COSMETIC_SLOTS as readonly string[]).includes(v);
export const isCosmeticItem = (slot: CosmeticSlot, item: unknown): boolean => typeof item === 'string' && COSMETIC_ITEMS[slot].includes(item);
export const defaultCosmetic = (slot: CosmeticSlot): string => COSMETIC_ITEMS[slot][0] as string;
/** Items a code may unlock: everything but the default. */
export const isUnlockableCosmetic = (slot: CosmeticSlot, item: unknown): boolean => isCosmeticItem(slot, item) && item !== defaultCosmetic(slot);

/** What a wallet wears, every slot always set. */
export type Loadout = Record<CosmeticSlot, string>;
export const defaultLoadout = (): Loadout => ({ wheel: defaultCosmetic('wheel'), truck_color: defaultCosmetic('truck_color'), gearbox: defaultCosmetic('gearbox') });
