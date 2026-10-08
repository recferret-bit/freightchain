/* The cosmetics catalog: what a promo code can unlock and a player can wear in the cab. VISUALS ONLY – no item changes handling, shifting or any rule of the game, and for
   now only COLOURS differ (the shapes are fixed in client/js/cockpit/rig.js). Five slots, each its own kind of promo code: the steering `wheel` (rim, sheen ring, spokes, hub),
   the `truck_color` (the hood and fenders you look over, and the trim of the windscreen frame and dashboard edge) and the `gearbox` (the floor shifter: knob, boot, lever), the `dice` hanging from the mirror and the `needle`s of the big gauges.
   Later an NFT will replace / extend these items – the slot model stays, so more slots or items from a collection can be added without touching the plumbing.
   Mirrored by client/js/cosmetics.js (a leaf module: the landing's dash cards run the cockpit without three.js) – keep the ids and defaults equal;
   test/unit/domain/economy/cosmetics.spec.ts reads that file and fails on drift. To add an item: append it here AND in the client module and give it a palette in LOOKS there.
   The first item of a slot is its default: everybody owns it, no code gives it. */
// the Garage added `dice` (the dice hanging from the mirror) and `needle` (the colour of the gauge needles)
export const COSMETIC_SLOTS = ['wheel', 'truck_color', 'gearbox', 'dice', 'needle'] as const;
export type CosmeticSlot = (typeof COSMETIC_SLOTS)[number];

export const COSMETIC_ITEMS: Readonly<Record<CosmeticSlot, readonly string[]>> = {
  wheel: ['classic', 'crimson', 'ocean', 'moss', 'gold', 'ivory'],
  truck_color: ['red', 'blue', 'green', 'black', 'yellow', 'white'],
  gearbox: ['stick', 'chrome', 'wood', 'racing', 'gold', 'carbon'],
  dice: ['white', 'red', 'blue', 'gold', 'pink', 'black'],
  needle: ['orange', 'red', 'lime', 'cyan', 'white', 'gold'],
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
