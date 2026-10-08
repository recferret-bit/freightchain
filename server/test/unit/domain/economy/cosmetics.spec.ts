import { readFileSync } from 'node:fs';
import { COSMETIC_ITEMS, COSMETIC_SLOTS, defaultCosmetic, defaultLoadout, isCosmeticItem, isCosmeticSlot, isUnlockableCosmetic, parseLoadout } from '../../../../src/domain/economy/cosmetics.js';

const clientSource = () => readFileSync(new URL('../../../../../client/js/cosmetics.js', import.meta.url), 'utf8');

describe('the cosmetics catalog', () => {
  it('three slots – the steering wheel, the truck paint, the shifter – each with a default (its first item) and several colours to unlock', () => {
    expect(COSMETIC_SLOTS).toEqual(['wheel', 'truck_color', 'gearbox']);
    for (const slot of COSMETIC_SLOTS) expect(COSMETIC_ITEMS[slot].length, slot).toBeGreaterThan(3);
    expect(defaultLoadout()).toEqual({ wheel: 'classic', truck_color: 'red', gearbox: 'stick' });
  });

  it('knows its slots and items – an item belongs to its slot (a name may repeat across slots: gold wheel, gold shifter)', () => {
    expect(isCosmeticSlot('wheel')).toBe(true);
    expect(isCosmeticSlot('seat')).toBe(false);
    expect(isCosmeticSlot(undefined)).toBe(false);
    expect(isCosmeticItem('wheel', 'gold')).toBe(true);
    expect(isCosmeticItem('gearbox', 'gold')).toBe(true);
    expect(isCosmeticItem('truck_color', 'gold')).toBe(false);
    expect(isCosmeticItem('wheel', 'racing')).toBe(false); // a shifter
    expect(isCosmeticItem('wheel', 7)).toBe(false);
  });

  it('a default is everybody\'s: it is never something a code unlocks', () => {
    for (const slot of COSMETIC_SLOTS) {
      expect(isUnlockableCosmetic(slot, defaultCosmetic(slot)), slot).toBe(false);
      for (const item of COSMETIC_ITEMS[slot].slice(1)) expect(isUnlockableCosmetic(slot, item), `${slot}:${item}`).toBe(true);
    }
  });

  it('item ids are short lower-case words (they go into URLs, JSON, class names, the ride row and the signed admin text)', () => {
    for (const slot of COSMETIC_SLOTS) for (const item of COSMETIC_ITEMS[slot]) expect(item, `${slot}:${item}`).toMatch(/^[a-z][a-z0-9_]{1,15}$/);
  });

  it('a stored loadout is read back whole: known items kept, anything else the default, a non-object is none', () => {
    expect(parseLoadout({ wheel: 'gold', truck_color: 'nonsense', gearbox: 7, seat: 'x' })).toEqual({ wheel: 'gold', truck_color: 'red', gearbox: 'stick' });
    expect(parseLoadout({})).toEqual(defaultLoadout());
    for (const bad of [null, undefined, 'gold', 5, [], ['wheel']]) expect(parseLoadout(bad), String(bad)).toBeNull();
  });

  it('the client mirror (client/js/cosmetics.js) lists exactly the same slots, items and defaults', () => {
    const block = /export const COSMETICS = \{([\s\S]*?)\n\};/.exec(clientSource())?.[1];
    expect(block, 'client/js/cosmetics.js must export COSMETICS').toBeTruthy();
    const mirror = Object.fromEntries([...(block ?? '').matchAll(/(\w+): \[([^\]]*)\]/g)].map(([, slot, items]) => [slot, [...(items ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1])]));
    expect(mirror).toEqual(COSMETIC_ITEMS);
  });

  it('…and every item has a palette there', () => {
    const src = clientSource();
    for (const slot of COSMETIC_SLOTS) {
      const block = new RegExp(`\\n  ${slot}: \\{\\n([\\s\\S]*?)\\n  \\},`).exec(src)?.[1] ?? '';
      for (const item of COSMETIC_ITEMS[slot]) expect(block, `${slot}:${item}`).toMatch(new RegExp(`(^|\\n)    ${item}: \\{`));
    }
  });
});
