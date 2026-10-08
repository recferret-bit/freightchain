import { readFileSync } from 'node:fs';
import { COSMETIC_ITEMS, COSMETIC_SLOTS, defaultCosmetic, defaultLoadout, isCosmeticItem, isCosmeticSlot, isUnlockableCosmetic } from '../../../../src/domain/economy/cosmetics.js';

const clientSource = () => readFileSync(new URL('../../../../../client/js/cosmetics.js', import.meta.url), 'utf8');

describe('the cosmetics catalog', () => {
  it('one slot today – the cabin – with a default (its first item) and several colour schemes to unlock', () => {
    expect(COSMETIC_SLOTS).toEqual(['cabin']);
    expect(COSMETIC_ITEMS.cabin.length).toBeGreaterThan(3);
    expect(defaultLoadout()).toEqual({ cabin: 'classic' });
  });

  it('knows its slots and items', () => {
    expect(isCosmeticSlot('cabin')).toBe(true);
    expect(isCosmeticSlot('wheel')).toBe(false); // the old per-part slots are gone: a cabin is one scheme
    expect(isCosmeticSlot(undefined)).toBe(false);
    expect(isCosmeticItem('cabin', 'midnight')).toBe(true);
    expect(isCosmeticItem('cabin', 'racing')).toBe(false);
    expect(isCosmeticItem('cabin', 7)).toBe(false);
  });

  it('a default is everybody\'s: it is never something a code unlocks', () => {
    expect(isUnlockableCosmetic('cabin', defaultCosmetic('cabin'))).toBe(false);
    for (const item of COSMETIC_ITEMS.cabin.slice(1)) expect(isUnlockableCosmetic('cabin', item), item).toBe(true);
  });

  it('item ids are short lower-case words (they go into URLs, JSON, class names, the ride row and the signed admin text)', () => {
    for (const slot of COSMETIC_SLOTS) for (const item of COSMETIC_ITEMS[slot]) expect(item, `${slot}:${item}`).toMatch(/^[a-z][a-z0-9_]{1,15}$/);
  });

  it('the client mirror (client/js/cosmetics.js) lists exactly the same slots, items and defaults', () => {
    const block = /export const COSMETICS = \{([\s\S]*?)\n\};/.exec(clientSource())?.[1];
    expect(block, 'client/js/cosmetics.js must export COSMETICS').toBeTruthy();
    const mirror = Object.fromEntries([...(block ?? '').matchAll(/(\w+): \[([^\]]*)\]/g)].map(([, slot, items]) => [slot, [...(items ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1])]));
    expect(mirror).toEqual(COSMETIC_ITEMS);
  });

  it('…and every cabin has a palette there (the same keys as the classic one)', () => {
    const src = clientSource();
    for (const item of COSMETIC_ITEMS.cabin) expect(src, item).toMatch(new RegExp(`\\n    ${item}: \\{\\n      interior:`));
  });
});
