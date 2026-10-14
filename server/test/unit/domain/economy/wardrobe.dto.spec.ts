import { COSMETIC_SLOTS, defaultCosmetic, defaultLoadout } from '../../../../src/domain/economy/cosmetics.js';
import { toWardrobeDto } from '../../../../src/domain/economy/wardrobe.dto.js';

const owned = (extra: Partial<Record<string, string[]>> = {}) => Object.fromEntries(COSMETIC_SLOTS.map((slot) => [slot, [defaultCosmetic(slot), ...(extra[slot] ?? [])]]));

describe('toWardrobeDto', () => {
  it('a newcomer owns and wears the classics', () => {
    expect(toWardrobeDto([], {})).toEqual({ equipped: defaultLoadout(), unlocked: owned() });
  });

  it('lists the default first, then what was unlocked, per slot, in the order it was, and wears what was equipped', () => {
    const dto = toWardrobeDto([{ slot: 'wheel', item: 'crimson' }, { slot: 'truck_color', item: 'blue' }, { slot: 'wheel', item: 'gold' }], { wheel: 'gold', truck_color: 'blue' });
    expect(dto.unlocked).toEqual(owned({ wheel: ['crimson', 'gold'], truck_color: ['blue'] }));
    expect(dto.equipped).toEqual({ ...defaultLoadout(), wheel: 'gold', truck_color: 'blue' });
  });

  it('never shows something the wallet does not own as worn (a stale equip row falls back to the default)', () => {
    expect(toWardrobeDto([], { wheel: 'gold', gearbox: 'nonsense' }).equipped).toEqual(defaultLoadout());
  });
});
