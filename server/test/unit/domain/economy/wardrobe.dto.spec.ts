import { toWardrobeDto } from '../../../../src/domain/economy/wardrobe.dto.js';

describe('toWardrobeDto', () => {
  it('a newcomer owns and wears the classics', () => {
    expect(toWardrobeDto([], {})).toEqual({
      equipped: { wheel: 'classic', truck_color: 'red', gearbox: 'stick', dice: 'white', needle: 'orange' },
      unlocked: { wheel: ['classic'], truck_color: ['red'], gearbox: ['stick'], dice: ['white'], needle: ['orange'] },
    });
  });

  it('lists the default first, then what was unlocked, per slot, in the order it was, and wears what was equipped', () => {
    const dto = toWardrobeDto([{ slot: 'wheel', item: 'crimson' }, { slot: 'truck_color', item: 'blue' }, { slot: 'wheel', item: 'gold' }], { wheel: 'gold', truck_color: 'blue' });
    expect(dto.unlocked).toEqual({ wheel: ['classic', 'crimson', 'gold'], truck_color: ['red', 'blue'], gearbox: ['stick'], dice: ['white'], needle: ['orange'] });
    expect(dto.equipped).toEqual({ wheel: 'gold', truck_color: 'blue', gearbox: 'stick', dice: 'white', needle: 'orange' });
  });

  it('never shows something the wallet does not own as worn (a stale equip row falls back to the default)', () => {
    expect(toWardrobeDto([], { wheel: 'gold', gearbox: 'nonsense' }).equipped).toEqual({ wheel: 'classic', truck_color: 'red', gearbox: 'stick', dice: 'white', needle: 'orange' });
  });
});
