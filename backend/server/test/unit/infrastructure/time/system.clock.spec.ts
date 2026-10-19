import { SystemClock } from '../../../../src/infrastructure/time/system.clock.js';

describe('SystemClock', () => {
  it('is the wall clock (the one place allowed to read it)', () => {
    const before = Date.now(), now = new SystemClock().now().getTime(), after = Date.now();
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(after);
  });
});
