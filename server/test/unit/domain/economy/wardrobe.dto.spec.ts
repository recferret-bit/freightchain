import { toWardrobeDto } from '../../../../src/domain/economy/wardrobe.dto.js';

describe('toWardrobeDto', () => {
  it('a newcomer owns and wears the classic cabin', () => {
    expect(toWardrobeDto([], {})).toEqual({ equipped: { cabin: 'classic' }, unlocked: { cabin: ['classic'] } });
  });

  it('lists the default first, then what was unlocked, in the order it was, and wears what was equipped', () => {
    const dto = toWardrobeDto([{ slot: 'cabin', item: 'midnight' }, { slot: 'cabin', item: 'noir' }], { cabin: 'noir' });
    expect(dto.unlocked).toEqual({ cabin: ['classic', 'midnight', 'noir'] });
    expect(dto.equipped).toEqual({ cabin: 'noir' });
  });

  it('never shows something the wallet does not own as worn (a stale equip row falls back to the default)', () => {
    expect(toWardrobeDto([], { cabin: 'noir' }).equipped).toEqual({ cabin: 'classic' });
    expect(toWardrobeDto([{ slot: 'cabin', item: 'forest' }], { cabin: 'nonsense' }).equipped).toEqual({ cabin: 'classic' });
  });
});
