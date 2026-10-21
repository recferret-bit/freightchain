import { shiftPastForbidden } from '../../../../src/domain/minigames/clearance.js';

describe('shiftPastForbidden', () => {
  it('walks a distance forward until it is 300m clear of every forbidden span', () => {
    expect(shiftPastForbidden(1000, [{ start: 100, end: 120 }])).toBe(1000);
    expect(shiftPastForbidden(0, [{ start: 100, end: 120 }])).toBeCloseTo(420.001, 5);
    expect(shiftPastForbidden(0, [{ start: 100, end: 120 }, { start: 500, end: 510 }])).toBeCloseTo(810.001, 5);
  });
});
