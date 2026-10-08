import { toWardrobeDto } from '../../../../src/domain/economy/wardrobe.dto.js';

describe('toWardrobeDto', () => {
  it('a newcomer owns and wears the defaults', () => {
    expect(toWardrobeDto([], {})).toEqual({
      equipped: { wheel: 'classic', truck_color: 'red', gearbox: 'stick' },
      unlocked: { wheel: ['classic'], truck_color: ['red'], gearbox: ['stick'] },
    });
  });

  it('lists the default first, then what was unlocked, per slot, and wears what was equipped', () => {
    const dto = toWardrobeDto([{ slot: 'wheel', item: 'sport' }, { slot: 'truck_color', item: 'blue' }, { slot: 'wheel', item: 'gold' }], { wheel: 'gold', truck_color: 'blue' });
    expect(dto.unlocked).toEqual({ wheel: ['classic', 'sport', 'gold'], truck_color: ['red', 'blue'], gearbox: ['stick'] });
    expect(dto.equipped).toEqual({ wheel: 'gold', truck_color: 'blue', gearbox: 'stick' });
  });

  it('never shows something the wallet does not own as worn (a stale equip row falls back to the default)', () => {
    expect(toWardrobeDto([], { wheel: 'gold', gearbox: 'nonsense' }).equipped).toEqual({ wheel: 'classic', truck_color: 'red', gearbox: 'stick' });
  });
});
