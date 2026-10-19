import { ClockPort } from '../../src/application/ports/shared/clock.port.js';

/** A Wednesday noon (the weekly round runs Monday → Monday), far enough in the future that cookies and JWTs dated by this clock are never "already expired" for
    the HTTP client's cookie jar, which compares them with the REAL time. */
export const FAKE_CLOCK_START = Date.UTC(2036, 9, 8, 12, 0, 0);

/** Tests drive time: nothing sleeps, nothing reads the wall clock. */
export class FakeClock extends ClockPort {
  ms = FAKE_CLOCK_START;

  now(): Date { return new Date(this.ms); }
  advance(seconds: number): void { this.ms += seconds * 1000; }
}
