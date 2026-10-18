/* The cosmetics catalog: what a player can wear in the cab. New parts are minted by burning TEN4 (docs/honk/SPEC.md); Convoy, Signal and Amber paints are referral gifts; a promo code no longer grants a cosmetic. VISUALS ONLY – no item changes handling, shifting or any rule of the game.
   Slots: the steering `wheel`, the `truck_color`, the `gearbox`, the hanging `dice`, the gauge `needle`s, the hood `ornament`, the `dash`, the `indicator`s and the `phone`.
   A TEN4 burn mints a soulbound entitlement for one of these items. The slot model stays, so more slots or items can be added without touching the plumbing.
   Mirrored by client/js/cosmetics.js for the slots that file draws (a leaf module: the landing's dash cards run the cockpit without three.js) – keep those ids and defaults equal.
   The first item of a slot is its default: everybody owns it, no code gives it. */
export const COSMETIC_SLOTS = ['wheel', 'truck_color', 'gearbox', 'dice', 'needle', 'ornament', 'dash', 'indicator', 'phone'] as const;
export type CosmeticSlot = (typeof COSMETIC_SLOTS)[number];

export const COSMETIC_ITEMS: Readonly<Record<CosmeticSlot, readonly string[]>> = {
  wheel: ['classic', 'crimson', 'ocean', 'moss', 'gold', 'ivory'],
  truck_color: ['red', 'blue', 'green', 'black', 'yellow', 'white', 'convoy', 'signal', 'amber'],
  gearbox: ['stick', 'chrome', 'wood', 'racing', 'gold', 'carbon'],
  dice: ['white', 'red', 'blue', 'gold', 'pink', 'black'],
  needle: ['orange', 'red', 'lime', 'cyan', 'white', 'gold'],
  ornament: ['spear', 'ball', 'star', 'gold', 'bird', 'flag'],
  dash: ['stock', 'wood', 'carbon', 'gold', 'red', 'ivory'],
  indicator: ['amber', 'red', 'green', 'gold', 'ice', 'white'],
  phone: ['black', 'silver', 'gold', 'red', 'blue', 'clear'],
};

export const isCosmeticSlot = (v: unknown): v is CosmeticSlot => typeof v === 'string' && (COSMETIC_SLOTS as readonly string[]).includes(v);
export const isCosmeticItem = (slot: CosmeticSlot, item: unknown): boolean => typeof item === 'string' && COSMETIC_ITEMS[slot].includes(item);
export const defaultCosmetic = (slot: CosmeticSlot): string => COSMETIC_ITEMS[slot][0] as string;
/** Items a code may unlock: everything but the default. */
export const isUnlockableCosmetic = (slot: CosmeticSlot, item: unknown): boolean => isCosmeticItem(slot, item) && item !== defaultCosmetic(slot);

/** What a wallet wears, every slot always set. */
export type Loadout = Record<CosmeticSlot, string>;
export const defaultLoadout = (): Loadout => Object.fromEntries(COSMETIC_SLOTS.map((slot) => [slot, defaultCosmetic(slot)])) as Loadout;

/** How many items of a slot a code can unlock (everything but the default) – the Garage's progression counts these. */
export const unlockableCount = (slot: CosmeticSlot): number => COSMETIC_ITEMS[slot].length - 1;

/** A stored loadout (the JSON column of a ride): known slots with known items, the default for anything else; null when it is not an object at all. */
export function parseLoadout(v: unknown): Loadout | null {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const out = defaultLoadout();
  for (const slot of COSMETIC_SLOTS) if (isCosmeticItem(slot, o[slot])) out[slot] = o[slot] as string;
  return out;
}
