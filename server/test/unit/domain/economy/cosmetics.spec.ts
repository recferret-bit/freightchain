import { readFileSync } from 'node:fs';
import { COSMETIC_ITEMS, COSMETIC_SLOTS, defaultCosmetic, defaultLoadout, isCosmeticItem, isCosmeticSlot, isUnlockableCosmetic } from '../../../../src/domain/economy/cosmetics.js';

describe('the cosmetics catalog', () => {
  it('three slots, each with a default (its first item) and at least one thing to unlock', () => {
    expect(COSMETIC_SLOTS).toEqual(['wheel', 'truck_color', 'gearbox']);
    for (const slot of COSMETIC_SLOTS) expect(COSMETIC_ITEMS[slot].length, slot).toBeGreaterThan(1);
    expect(defaultLoadout()).toEqual({ wheel: 'classic', truck_color: 'red', gearbox: 'stick' });
  });

  it('knows its slots and items – an item belongs to ONE slot', () => {
    expect(isCosmeticSlot('wheel')).toBe(true);
    expect(isCosmeticSlot('seat')).toBe(false);
    expect(isCosmeticSlot(undefined)).toBe(false);
    expect(isCosmeticItem('wheel', 'sport')).toBe(true);
    expect(isCosmeticItem('wheel', 'racing')).toBe(false); // a gearbox
    expect(isCosmeticItem('wheel', 7)).toBe(false);
  });

  it('a default is everybody\'s: it is never something a code unlocks', () => {
    for (const slot of COSMETIC_SLOTS) {
      expect(isUnlockableCosmetic(slot, defaultCosmetic(slot)), slot).toBe(false);
      for (const item of COSMETIC_ITEMS[slot].slice(1)) expect(isUnlockableCosmetic(slot, item), `${slot}:${item}`).toBe(true);
    }
  });

  it('item ids are short lower-case words (they go into URLs, JSON, class names and the signed admin text)', () => {
    for (const slot of COSMETIC_SLOTS) for (const item of COSMETIC_ITEMS[slot]) expect(item, `${slot}:${item}`).toMatch(/^[a-z][a-z0-9_]{1,15}$/);
  });

  it('the client mirror (client/js/cosmetics.js) lists exactly the same slots, items and defaults', () => {
    const src = readFileSync(new URL('../../../../../client/js/cosmetics.js', import.meta.url), 'utf8');
    const block = /export const COSMETICS = \{([\s\S]*?)\n\};/.exec(src)?.[1];
    expect(block, 'client/js/cosmetics.js must export COSMETICS').toBeTruthy();
    const mirror = Object.fromEntries([...(block ?? '').matchAll(/(\w+): \[([^\]]*)\]/g)].map(([, slot, items]) => [slot, [...(items ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1])]));
    expect(mirror).toEqual(COSMETIC_ITEMS);
  });
});
