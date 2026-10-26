import { JsonLogger } from '../../../../src/infrastructure/logging/json-logger.js';
import { LogRing } from '../../../../src/infrastructure/logging/log-ring.js';
import type { EnvService } from '../../../../src/infrastructure/config/env.service.js';
import { FakeClock } from '../../../support/fake-clock.js';

const setup = (production: boolean) => {
  const lines: string[] = [], clock = new FakeClock(), ring = new LogRing(clock, 10);
  const logger = new JsonLogger(clock, ring, { isProduction: production } as EnvService, (l) => lines.push(l));
  return { logger, lines, ring, clock };
};

describe('JsonLogger', () => {
  it('production: one JSON object per line – time from the clock, level, context, msg', () => {
    const { logger, lines } = setup(true);
    logger.log('server up', 'Bootstrap');
    expect(JSON.parse(lines[0] ?? '')).toEqual({ time: '2036-10-08T12:00:00.000Z', level: 'log', context: 'Bootstrap', msg: 'server up' });
  });

  it('an object message becomes structured fields; its msg stays the message', () => {
    const { logger, lines } = setup(true);
    logger.warn({ event: 'request', msg: 'POST /api/x 404', status: 404, wallet: 'W' }, 'HTTP');
    expect(JSON.parse(lines[0] ?? '')).toMatchObject({ level: 'warn', context: 'HTTP', msg: 'POST /api/x 404', event: 'request', status: 404, wallet: 'W' });
  });

  it("error(message, stack, context) keeps the stack; an Error object logs its message and stack; no context → 'App'", () => {
    const { logger, lines } = setup(true);
    logger.error('boom', 'Error: boom\n    at x', 'Handler');
    expect(JSON.parse(lines[0] ?? '')).toMatchObject({ level: 'error', context: 'Handler', msg: 'boom', stack: 'Error: boom\n    at x' });
    logger.error(new Error('bad'));
    expect(JSON.parse(lines[1] ?? '')).toMatchObject({ context: 'App', msg: 'bad' });
    expect(JSON.parse(lines[1] ?? '').stack).toContain('Error: bad');
  });

  it('outside production: a readable one-liner with the fields appended', () => {
    const { logger, lines } = setup(false);
    logger.log({ event: 'signin', msg: 'signed in W', wallet: 'W' }, 'SignIn');
    expect(lines[0]).toBe('2036-10-08T12:00:00.000Z LOG   [SignIn] signed in W {"event":"signin","wallet":"W"}');
  });

  it('structured fields cannot overwrite the retention timestamp', () => {
    const { logger, lines, clock } = setup(true);
    logger.log({ msg: 'clock-owned', time: '9999-01-01T00:00:00.000Z' });
    expect(JSON.parse(lines[0] ?? '').time).toBe(clock.now().toISOString());
  });

  it('every entry also lands in the ring (newest first)', () => {
    const { logger, ring, clock } = setup(true);
    logger.log('a'); clock.advance(1); logger.debug('b'); logger.verbose('c'); logger.fatal('d');
    expect(ring.recent({ limit: 10 }).map((e) => `${e.level}:${e.msg}`)).toEqual(['fatal:d', 'verbose:c', 'debug:b', 'log:a']);
  });
});
