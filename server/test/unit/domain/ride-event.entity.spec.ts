import { RideEvent, cleanText } from '../../../src/domain/live/ride-event.entity.js';
import { EFFECTS, EFFECT_WINDOW_MS, LINE_WINDOW_MS, MESSAGE_MAX_LENGTH } from '../../../src/domain/live/live-rules.js';
import { BadRequestError } from '../../../src/domain/shared/errors.js';

const T = new Date(Date.UTC(2036, 9, 8, 12, 0, 0));
const later = (ms: number) => new Date(T.getTime() + ms);

describe('RideEvent (live feed line)', () => {
  it('cleans spectator text: control / bidi characters out, whitespace collapsed; empty or too long is a 400', () => {
    expect(cleanText('  hi\n\tthere ‮evil\u0007 ')).toBe('hi there evil');
    expect(RideEvent.message({ rideId: 'r', wallet: 'w', text: ' keep\n going ', now: T }).snapshot()).toMatchObject({ kind: 'message', text: 'keep going', effect: null, lamports: 0 });
    expect(() => RideEvent.message({ rideId: 'r', wallet: 'w', text: ' \n ', now: T })).toThrow(BadRequestError);
    expect(() => RideEvent.message({ rideId: 'r', wallet: 'w', text: 'x'.repeat(MESSAGE_MAX_LENGTH + 1), now: T })).toThrow(/at most 140/);
    expect(RideEvent.message({ rideId: 'r', wallet: 'w', text: `${'x'.repeat(MESSAGE_MAX_LENGTH)}   `, now: T }).snapshot().text).toHaveLength(MESSAGE_MAX_LENGTH);
  });

  it('rate-limit windows: a game effect takes the ride-wide fx window, a tip or a line only the wallet’s own short window', () => {
    const fx = RideEvent.donation({ rideId: 'r', wallet: 'w', effect: 'night', now: later(EFFECT_WINDOW_MS + 5) }).snapshot();
    expect(fx).toMatchObject({ slotKey: 'fx', slot: Math.floor((T.getTime() + EFFECT_WINDOW_MS + 5) / EFFECT_WINDOW_MS), lamports: EFFECTS.night.lamports, text: null });
    const tip = RideEvent.donation({ rideId: 'r', wallet: 'w', effect: 'tip', note: ' gg ', now: T }).snapshot();
    expect(tip).toMatchObject({ slotKey: 'tip:w', slot: T.getTime() / LINE_WINDOW_MS, text: 'gg' });
    expect(RideEvent.message({ rideId: 'r', wallet: 'w', text: 'hi', now: T }).slotKey).toBe('msg:w');
    expect(RideEvent.retryAfterMs('fx', later(5000))).toBe(EFFECT_WINDOW_MS - 5000);
    expect(RideEvent.retryAfterMs('msg:w', later(1000))).toBe(LINE_WINDOW_MS - 1000);
    expect(() => RideEvent.donation({ rideId: 'r', wallet: 'w', effect: 'tip', note: 'n'.repeat(81), now: T })).toThrow(/at most 80/);
  });

  it('markApplied: only game effects, first stamp wins, an obstacle needs its lateral place, impossible values are a 400', () => {
    const night = RideEvent.donation({ rideId: 'r', wallet: 'w', effect: 'night', now: T });
    expect(night.needsGame).toBe(true);
    expect(night.markApplied({ t: 12, s: 300, lat: 3 }, later(1))).toBe(true);
    expect(night.applied).toEqual({ at: later(1), t: 12, s: 300, lat: null }); // night has no place across the road
    expect(night.markApplied({ t: 99, s: 900, lat: null }, later(2))).toBe(false);
    expect(night.applied?.t).toBe(12);

    const hole = RideEvent.donation({ rideId: 'r', wallet: 'w', effect: 'sinkhole', now: T });
    expect(() => hole.markApplied({ t: 1, s: 10, lat: null }, T)).toThrow(/across the road/);
    expect(() => hole.markApplied({ t: -1, s: 10, lat: 2 }, T)).toThrow(/impossible/);
    expect(() => hole.markApplied({ t: 1, s: Number.NaN, lat: 2 }, T)).toThrow(/impossible/);
    expect(hole.markApplied({ t: 1, s: 1200, lat: 2.4 }, T)).toBe(true);
    expect(hole.applied?.lat).toBe(2.4);

    expect(() => RideEvent.donation({ rideId: 'r', wallet: 'w', effect: 'tip', now: T }).markApplied({ t: 1, s: 1, lat: null }, T)).toThrow(/nothing to apply/);
    expect(() => RideEvent.message({ rideId: 'r', wallet: 'w', text: 'hi', now: T }).markApplied({ t: 1, s: 1, lat: null }, T)).toThrow(BadRequestError);
  });

  it('an obstacle the driver\'s game found no room for is stamped as missed: no place across the road, not on the road', () => {
    const hole = RideEvent.donation({ rideId: 'r', wallet: 'w', effect: 'trench', now: T });
    expect(hole.missed).toBe(false);
    expect(hole.markApplied({ t: 5, s: 800, lat: 2.4, missed: true }, T)).toBe(true);
    expect(hole.applied).toEqual({ at: T, t: 5, s: 800, lat: null });
    expect(hole.missed).toBe(true);
    const night = RideEvent.donation({ rideId: 'r', wallet: 'w', effect: 'night', now: T });
    night.markApplied({ t: 5, s: 800, lat: null, missed: true }, T);
    expect(night.missed).toBe(false); // only obstacles can be missed
  });

  it('restore / snapshot are copies (no shared stamp object)', () => {
    const e = RideEvent.donation({ rideId: 'r', wallet: 'w', effect: 'day', now: T });
    const snap = e.snapshot();
    e.markApplied({ t: 1, s: 1, lat: null }, T);
    expect(snap.applied).toBeNull();
    const back = RideEvent.restore({ ...e.snapshot(), id: 7 });
    expect(back.id).toBe(7); expect(back.applied).toEqual(e.applied); expect(back.applied).not.toBe(e.applied);
  });
});
