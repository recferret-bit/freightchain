import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EnvService } from '../../../src/infrastructure/config/env.service.js';
import { pauseVerdict, slowMotionVerdict } from '../../../src/domain/rides/pause-bounds.js';
import { BadRequestError, NotFoundError } from '../../../src/domain/shared/errors.js';
import { replayDenial } from '../../../src/domain/live/replay-visibility.js';
import { LiveDonationService } from '../../../src/application/live/live-donation.service.js';
import { BurnHonkTimeCommand, BurnHonkTimeHandler } from '../../../src/application/use-cases/honk/burn-honk-time.handler.js';
import { BurnHonkWeatherCommand, BurnHonkWeatherHandler } from '../../../src/application/use-cases/honk/burn-honk-weather.handler.js';

/** EnvService reads process.env at construction. Restore it before the assertion. */
const withEnv = (vars: Record<string, string | undefined>) => {
  const saved = { ...process.env };
  for (const [k, v] of Object.entries(vars)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  try { return new EnvService(); } finally { process.env = saved; }
};

const root = join(import.meta.dirname, '../../../../../');
const docs = {
  product: readFileSync(join(root, 'docs/spec/PRODUCT.md'), 'utf8'),
  status: readFileSync(join(root, 'docs/plan/spec-compliance/STATUS.md'), 'utf8'),
  issue: readFileSync(join(root, 'docs/plan/spec-compliance/issues/SPC-04-replays-streams-donations-and-i18n.md'), 'utf8'),
  coverage: readFileSync(join(root, 'docs/testing/COVERAGE_CONTRACT.md'), 'utf8'),
};
const verdict = readFileSync(join(root, 'backend/server/src/application/services/verdict.service.ts'), 'utf8');

const base = {
  DATABASE_URL: 'postgresql://x/db', NODE_ENV: 'development', JWT_SECRET: undefined, TREASURY_PUBKEY: undefined,
  DEMO_WALLETS: undefined, TRUST_PROXY: undefined, CLIENT_DIR: undefined, COOKIE_DOMAIN: undefined, CORS_ORIGINS: undefined,
  ADMIN_JWT_SECRET: undefined, ADMIN_SESSION_TTL_MINUTES: undefined, PLEDGES_ENABLED: undefined,
};

/** The handlers throw before they touch a dependency, so the unused ports stay unset. */
const unused = undefined as never;
const timeHandler = new BurnHonkTimeHandler(unused, unused, unused, unused, unused, unused, unused, unused);
const weatherHandler = new BurnHonkWeatherHandler(unused, unused, unused, unused, unused, unused, unused, unused);

describe('as-built docs match the shipped defaults', () => {
  const env = withEnv(base);
  const over = { count: 4, seconds: 301 };
  const off = pauseVerdict('off', over);
  const shadow = pauseVerdict('shadow', over);
  const enforce = pauseVerdict('enforce', over);
  const slowOff = slowMotionVerdict('off', 30, 120_000);
  const slowShadow = slowMotionVerdict('shadow', 30, 120_000);
  const slowEnforce = slowMotionVerdict('enforce', 30, 120_000);

  it('admin session, pledges, and RideResult sentences follow the code', () => {
    expect(env.adminSessionTtlMinutes).toBeLessThanOrEqual(60);
    expect(env.pledgesEnabled).toBe(false);
    expect(verdict).toContain('rideResults.upsert');
    const shipped = docs.product + docs.status;
    expect(shipped).toContain(String(env.adminSessionTtlMinutes));
    expect(shipped).toContain('revoked:jti');
    expect(docs.product).toContain('pledges_disabled');
    expect(docs.product).toContain('403');
    expect(docs.product).toContain('stats.RideResult');
    expect(docs.product).not.toContain('e8f338ad');
    for (const banned of ['120 minutes', 'logout does not revoke', 'There is no RideResult', 'there is no RideResult', 'pledges stay on', 'no per-ride']) {
      expect(shipped).not.toContain(banned);
    }
  });

  it('pause and slow-motion status follows pauseVerdict and slowMotionVerdict', () => {
    expect(off).toEqual([]);
    expect(slowOff).toEqual([]);
    expect(shadow.every((reason) => reason.severity === 'flag')).toBe(true);
    expect(slowShadow.every((reason) => reason.severity === 'flag')).toBe(true);
    expect(enforce.every((reason) => reason.severity === 'reject')).toBe(true);
    expect(slowEnforce.every((reason) => reason.severity === 'reject')).toBe(true);
    const text = docs.product + docs.status;
    expect(text).toContain('off` adds no reasons');
    expect(text).toContain('shadow` flags');
    expect(text).toContain('enforce` rejects');
  });

  it('honk time and weather status follows the handler throw', async () => {
    const time = await timeHandler.execute(new BurnHonkTimeCommand('w', 'r', 'day')).then(() => null, (error: unknown) => error);
    const weather = await weatherHandler.execute(new BurnHonkWeatherCommand('w', 'r', 'snow')).then(() => null, (error: unknown) => error);
    expect(time).toBeInstanceOf(NotFoundError);
    expect(weather).toBeInstanceOf(NotFoundError);
    const timeError = time as NotFoundError;
    const weatherError = weather as NotFoundError;
    expect(timeError.statusCode).toBe(weatherError.statusCode);
    expect(timeError.errorCode).toBe(weatherError.errorCode);
    const text = docs.product + docs.status + docs.issue;
    expect(timeError.statusCode).toBe(404);
    expect(text).toContain(String(timeError.statusCode));
    expect(text).toContain(timeError.errorCode);
    expect(text).toContain(timeError.message);
    expect(text).toContain(weatherError.message);
    expect(text).toContain('honk/time');
    expect(text).toContain('honk/weather');
    expect(text).toContain('before any TEN4 debit');
    expect(docs.status).toContain('not a live burn');
    for (const banned of ['are `200` and burn TEN4', 'answer `200`, burn TEN4', 'answer `200`', '10 day/night, 25 snow or clear', 'Burns: 1 chat HONK, 10 day/night']) {
      expect(text).not.toContain(banned);
    }
  });

  it('the coverage contract keeps the 2026-10-23 green gate figures', () => {
    expect(docs.coverage).toContain('11668 objects compared against golden.txt: identical');
    expect(docs.coverage).toContain('20/20');
    expect(docs.coverage).toContain('zero-scenario routes: 0');
    expect(docs.coverage).toContain('single-scenario routes: 0');
    expect(docs.coverage).toContain('178/178');
    for (const banned of ['18/20', '21 `veh|medic`', '21 ambulance', '57 routes', '57-route', 'Three gates are red']) {
      expect(docs.coverage + docs.product).not.toContain(banned);
    }
  });

  it('live watch and donation status follows replayDenial and LiveDonationService', async () => {
    const denial = replayDenial({
      status: 'running', tier: '1h', tutorial: false, assist: false, guest: false,
      wallet: 'driver', poolId: null, payoutAt: null, verdict: null,
    }, 'driver', new Date());
    const donations = new LiveDonationService(unused, unused, unused, unused, unused);
    const refused = await donations.prepare('w', 'r', 'night', null, 'order').then(() => null, (error: unknown) => error);
    expect(denial?.code).toBe('replay_not_available');
    expect(refused).toBeInstanceOf(BadRequestError);
    const donationError = refused as BadRequestError;
    const text = docs.coverage + docs.product;
    expect(text).toContain(denial?.code);
    expect(text).toContain(donationError.errorCode);
    for (const banned of [
      'Watch a running paid ride',
      'Running free ride → `403 free_ride_no_stream`',
      'does not move the road',
      'HTTP routes with no scenario',
      '17 zero-scenario',
      '47 routes have exactly one',
      'both SNS routes have no HTTP scenario',
      'Four honk HTTP routes have no scenario',
      'in the zero-scenario list',
      'have no HTTP scenario',
      'only a cross-origin 403',
      '~25 s behind',
      'close 17 zero-scenario',
    ]) {
      expect(text).not.toContain(banned);
    }
  });
});
