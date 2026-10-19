import { nextUtcMidnight, startOfUtcDay, utcDay } from '../../../src/domain/shared/time.js';

describe('UTC day helpers', () => {
  it('startOfUtcDay: 00:00 UTC of the same day (midnight itself included), next to nextUtcMidnight and utcDay', () => {
    const noon = new Date(Date.UTC(2036, 9, 8, 12, 30));
    expect(startOfUtcDay(noon).toISOString()).toBe('2036-10-08T00:00:00.000Z');
    expect(startOfUtcDay(new Date(Date.UTC(2036, 9, 8))).toISOString()).toBe('2036-10-08T00:00:00.000Z');
    expect(startOfUtcDay(new Date(Date.UTC(2036, 9, 8) - 1)).toISOString()).toBe('2036-10-07T00:00:00.000Z');
    expect(nextUtcMidnight(noon).getTime() - startOfUtcDay(noon).getTime()).toBe(86_400_000);
    expect(utcDay(startOfUtcDay(noon))).toBe('2036-10-08');
  });
});
