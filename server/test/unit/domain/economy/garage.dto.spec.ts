import { toGarageDto } from '../../../../src/domain/economy/garage.dto.js';

const T = new Date('2026-10-09T12:00:00.000Z');

describe('toGarageDto', () => {
  it('a newcomer: the whole catalog, every default owned and worn, nothing collected (28 parts to find)', () => {
    const g = toGarageDto([], {});
    expect(g.slots.map((s) => [s.slot, s.parts.length, s.collected, s.total])).toEqual([['wheel', 6, 0, 5], ['truck_color', 9, 0, 8], ['gearbox', 6, 0, 5], ['dice', 6, 0, 5], ['needle', 6, 0, 5]]);
    expect(g.progress).toEqual({ collected: 0, total: 28, percent: 0 });
    expect(g.equipped).toEqual({ wheel: 'classic', truck_color: 'red', gearbox: 'stick', dice: 'white', needle: 'orange' });
    for (const s of g.slots) expect(s.parts[0]).toEqual({ id: s.parts[0]?.id, isDefault: true, owned: true, worn: true, unlockedAt: null, code: null });
  });

  it('owned parts carry the code and the time that earned them; only unlocked non-defaults count; the worn one is flagged', () => {
    const g = toGarageDto([{ slot: 'wheel', item: 'gold', code: 'GOLD', at: T }, { slot: 'dice', item: 'pink', code: 'PINK', at: new Date(T.getTime() + 1000) }], { wheel: 'gold' });
    expect(g.progress).toEqual({ collected: 2, total: 28, percent: 7 });
    const gold = g.slots[0]?.parts.find((p) => p.id === 'gold');
    expect(gold).toEqual({ id: 'gold', isDefault: false, owned: true, worn: true, unlockedAt: T.getTime(), code: 'GOLD' });
    expect(g.slots[0]?.parts[0]).toMatchObject({ id: 'classic', owned: true, worn: false });
    expect(g.slots[3]?.parts.find((p) => p.id === 'pink')).toMatchObject({ owned: true, worn: false, code: 'PINK' });
    expect(g.slots[3]?.parts.find((p) => p.id === 'red')).toMatchObject({ owned: false, worn: false, code: null, unlockedAt: null });
  });

  it('a worn item the wallet does not own falls back to the default; a complete garage is 100 %', () => {
    expect(toGarageDto([], { needle: 'gold' }).equipped.needle).toBe('orange');
    const all = (['wheel', 'truck_color', 'gearbox', 'dice', 'needle'] as const).flatMap((slot) => toGarageDto([], {}).slots.find((s) => s.slot === slot)!.parts.filter((p) => !p.isDefault).map((p) => ({ slot, item: p.id, code: 'X', at: T })));
    const g = toGarageDto(all, {});
    expect(g.progress).toEqual({ collected: 28, total: 28, percent: 100 });
    expect(g.slots.every((s) => s.parts.every((p) => p.owned))).toBe(true);
  });
});
