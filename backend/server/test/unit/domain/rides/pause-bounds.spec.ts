import { notePause, pauseBoundFlags, timeDilationFlag, PAUSE_MAX_COUNT, PAUSE_MAX_SECONDS, SLOW_MO_MIN_WALL, SLOW_MO_RATIO } from '../../../../src/domain/rides/pause-bounds.js';

describe('pause bounds', () => {
  it('counts a rising edge and the wall time of paused beats', () => {
    let tally = { count: 0, seconds: 0 };
    tally = notePause(false, true, 2, tally);
    tally = notePause(true, true, 3, tally);
    tally = notePause(true, false, 4, tally);
    tally = notePause(false, true, 1, tally);
    expect(tally).toEqual({ count: 2, seconds: 6 });
  });

  it('flags a fourth pause and five minutes, and never rejects', () => {
    expect(pauseBoundFlags({ count: PAUSE_MAX_COUNT, seconds: PAUSE_MAX_SECONDS })).toEqual([]);
    const over = pauseBoundFlags({ count: PAUSE_MAX_COUNT + 1, seconds: PAUSE_MAX_SECONDS + 1 });
    expect(over.map((r) => r.code)).toEqual(['pause-limit', 'pause-time']);
    expect(over.every((r) => r.severity === 'flag')).toBe(true);
  });

  it('flags a sustained slow ratio and ignores a short or honest one', () => {
    expect(timeDilationFlag(10, SLOW_MO_MIN_WALL - 1, 0)).toEqual([]);
    expect(timeDilationFlag(SLOW_MO_MIN_WALL * SLOW_MO_RATIO, SLOW_MO_MIN_WALL, 0)).toEqual([]);
    const slow = timeDilationFlag(30, 120, 0);
    expect(slow.map((r) => [r.code, r.severity])).toEqual([['time-dilation', 'flag']]);
    expect(timeDilationFlag(60, 120, 60)).toEqual([]);
  });
});
